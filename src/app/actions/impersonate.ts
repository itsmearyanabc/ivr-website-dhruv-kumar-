'use server'

import { createClient, createAdminClient, createServiceRoleClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import crypto from 'crypto'

const IMPERSONATION_COOKIE = 'xpack_impersonation'
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000 // 2 hours

function getSecret() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || 'xpack-impersonation-secret'
}

function signPayload(payload: string) {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('hex')
}

function makeToken(adminId: string, adminEmail: string) {
  const payload = JSON.stringify({ adminId, adminEmail, exp: Date.now() + TOKEN_TTL_MS })
  const encoded = Buffer.from(payload).toString('base64url')
  return `${encoded}.${signPayload(encoded)}`
}

function parseToken(token: string): { adminId: string; adminEmail: string; exp: number } | null {
  try {
    const [encoded, sig] = token.split('.')
    if (!encoded || !sig) return null
    const expected = signPayload(encoded)
    // timing-safe comparison
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString())
    if (!payload.exp || Date.now() > payload.exp) return null
    return payload
  } catch {
    return null
  }
}

async function verifyAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const service = await createServiceRoleClient()
  const { data: profile } = await service
    .from('users')
    .select('role, email')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'ADMIN') return null
  return { id: user.id, email: user.email || '' }
}

/**
 * Start impersonating a customer. Only callable by an ADMIN.
 * Signs the current session into the target user's account and stores a
 * signed, expiring cookie so the admin can return to their own account.
 */
export async function impersonateUser(userId: string) {
  const admin = await verifyAdmin()
  if (!admin) return { error: 'Admin access required.' }

  const service = await createServiceRoleClient()
  const { data: target, error } = await service
    .from('users')
    .select('id, email, role, is_active, full_name, company_name, password_plain')
    .eq('id', userId)
    .single()

  if (error) {
    console.error('impersonateUser query error:', error);
    return { error: 'Failed to fetch user: ' + error.message };
  }
  if (!target) return { error: 'User not found.' }
  if (target.role === 'ADMIN') return { error: 'Cannot impersonate another administrator.' }
  if (target.is_active === false) return { error: 'This account is disabled.' }

  // Store signed impersonation cookie so admin can return
  const cookieStore = await cookies()
  cookieStore.set(IMPERSONATION_COOKIE, makeToken(admin.id, admin.email), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: TOKEN_TTL_MS / 1000,
  })

  // Sign in as the target user. Prefer the stored plain password (kept for
  // admin visibility); fall back to generating a one-time recovery link.
  if (target.password_plain) {
    const supabase = await createClient()
    const { error } = await supabase.auth.signInWithPassword({
      email: target.email,
      password: target.password_plain,
    })
    if (!error) {
      return {
        success: true,
        user: {
          role: 'customer',
          name: target.full_name || 'User',
          email: target.email,
          company: target.company_name || '',
        },
      }
    }
    // Password may have changed since it was stored — fall through to link flow
  }

  // Fallback: generate a recovery link and extract a session from it
  const adminClient = await createAdminClient()
  const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
    type: 'recovery',
    email: target.email,
  })

  if (linkError || !linkData?.properties?.hashed_token) {
    return { error: 'Failed to create impersonation session for this user.' }
  }

  const supabase = await createClient()
  const { error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: 'recovery',
  })

  if (verifyError) {
    return { error: 'Failed to start impersonation session.' }
  }

  return {
    success: true,
    user: {
      role: 'customer',
      name: target.full_name || 'User',
      email: target.email,
      company: target.company_name || '',
    },
  }
}

/** Returns the admin info if the current session is an impersonation, else null. */
export async function getImpersonationState() {
  const cookieStore = await cookies()
  const token = cookieStore.get(IMPERSONATION_COOKIE)?.value
  if (!token) return { impersonating: false }
  const payload = parseToken(token)
  if (!payload) return { impersonating: false }
  return { impersonating: true, adminEmail: payload.adminEmail }
}

/** End impersonation and sign the admin back in. */
export async function stopImpersonation() {
  const cookieStore = await cookies()
  const token = cookieStore.get(IMPERSONATION_COOKIE)?.value
  const payload = token ? parseToken(token) : null

  cookieStore.delete(IMPERSONATION_COOKIE)

  if (!payload) {
    return { error: 'No active impersonation session.' }
  }

  const adminEmail = process.env.ADMIN_EMAIL
  const adminPassword = process.env.ADMIN_PASSWORD
  if (!adminEmail || !adminPassword) {
    return { error: 'Admin credentials are not configured on the server.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: adminEmail,
    password: adminPassword,
  })

  if (error) {
    return { error: 'Failed to restore admin session. Please sign in again.' }
  }

  return { success: true }
}
