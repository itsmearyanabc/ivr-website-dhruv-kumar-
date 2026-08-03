/* eslint-disable @typescript-eslint/no-explicit-any */
'use server'

import { createClient, createAdminClient, createServiceRoleClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import crypto from 'crypto'
import { logActivity } from '@/app/actions/activity'
import { hasPasswordColumn } from '@/lib/supabase/schema'

const IMPERSONATION_COOKIE = 'xpack_impersonation'
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000 // 2 hours

type ImpersonationPayload = {
  adminId: string
  adminEmail: string
  /** The admin's own refresh token, so returning does not depend on knowing their password. */
  adminRefreshToken?: string
  exp: number
}

function getSecret() {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to sign impersonation tokens.')
  return secret
}

function signPayload(payload: string) {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('hex')
}

function makeToken(payload: ImpersonationPayload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${encoded}.${signPayload(encoded)}`
}

function parseToken(token: string): ImpersonationPayload | null {
  try {
    const [encoded, sig] = token.split('.')
    if (!encoded || !sig) return null

    const expected = signPayload(encoded)
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null

    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as ImpersonationPayload
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

  // Capture the admin's own refresh token before the session is replaced, so "Return to
  // admin console" can restore this exact session instead of re-authenticating.
  const { data: { session } } = await supabase.auth.getSession()

  return {
    id: user.id,
    email: user.email || profile.email || '',
    refreshToken: session?.refresh_token,
  }
}

/**
 * Signs the current browser session into a customer's account. ADMIN only.
 *
 * Three ways in, tried in order, because a panel that can only impersonate accounts created
 * after password capture was switched on is not much use:
 *   1. the stored plain password (fast, and always correct for accounts created in-app)
 *   2. a one-time magic link redeemed server-side
 *   3. a one-time recovery link redeemed server-side
 */
export async function impersonateUser(userId: string) {
  const admin = await verifyAdmin()
  if (!admin) return { error: 'Admin access required.' }

  const service = await createServiceRoleClient()
  const storedPasswords = await hasPasswordColumn()
  const { data: target, error } = await service
    .from('users')
    .select(`id, email, role, is_active, full_name, company_name${storedPasswords ? ', password_plain' : ''}`)
    .eq('id', userId)
    .single<{
      id: string
      email: string
      role: string
      is_active: boolean
      full_name: string | null
      company_name: string | null
      password_plain?: string | null
    }>()

  if (error) {
    console.error('impersonateUser lookup error:', error)
    return { error: 'Could not load that customer: ' + error.message }
  }
  if (!target) return { error: 'User not found.' }
  if (target.role === 'ADMIN') return { error: 'Cannot impersonate another administrator.' }
  if (target.is_active === false) return { error: 'This account is disabled. Enable it first, then sign in as the customer.' }
  if (!target.email) return { error: 'This account has no email address on file.' }

  const supabase = await createClient()
  let signedIn = false

  // --- 1. stored password ------------------------------------------------------------
  // Prefer the directory column; fall back to auth metadata so this path still works on a
  // database where the password_sync migration has not been applied yet.
  let knownPassword = target.password_plain || null
  if (!knownPassword) {
    try {
      const adminClient = await createAdminClient()
      const { data: authUser } = await adminClient.auth.admin.getUserById(userId)
      const fromMetadata = (authUser?.user?.user_metadata as any)?.password_plain
      if (fromMetadata) knownPassword = String(fromMetadata)
    } catch (e) {
      console.warn('impersonateUser: could not read auth metadata password.', e)
    }
  }

  if (knownPassword) {
    const { error: passwordError } = await supabase.auth.signInWithPassword({
      email: target.email,
      password: knownPassword,
    })
    if (!passwordError) {
      signedIn = true
    } else {
      // Stored copy is stale (password changed outside the panel). Fall through.
      console.warn('impersonateUser: stored password rejected, falling back to link flow.')
    }
  }

  // --- 2 & 3. one-time link redeemed on the server -----------------------------------
  if (!signedIn) {
    const adminClient = await createAdminClient()

    for (const linkType of ['magiclink', 'recovery'] as const) {
      const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
        type: linkType,
        email: target.email,
      })

      if (linkError || !linkData?.properties?.hashed_token) {
        console.warn(`impersonateUser: ${linkType} link generation failed:`, linkError?.message)
        continue
      }

      const { error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: linkData.properties.hashed_token,
        type: linkType === 'magiclink' ? 'email' : 'recovery',
      })

      if (!verifyError) {
        signedIn = true
        break
      }
      console.warn(`impersonateUser: ${linkType} verification failed:`, verifyError.message)
    }
  }

  if (!signedIn) {
    return {
      error:
        'Could not start a session for this customer. Set a password for them from the customer row, then try again.',
    }
  }

  // Only now is the cookie written - a failed attempt must not leave the console showing a
  // "you are impersonating" banner over the admin's own session.
  const cookieStore = await cookies()
  cookieStore.set(
    IMPERSONATION_COOKIE,
    makeToken({
      adminId: admin.id,
      adminEmail: admin.email,
      adminRefreshToken: admin.refreshToken,
      exp: Date.now() + TOKEN_TTL_MS,
    }),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: TOKEN_TTL_MS / 1000,
    }
  )

  await logActivity({
    userId: admin.id,
    userEmail: admin.email,
    userName: 'Administrator',
    actionType: 'ADMIN_IMPERSONATION_STARTED',
    entityType: 'USER',
    entityId: target.id,
    description: `Administrator signed in as ${target.email}.`,
  })

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

/** Ends impersonation and restores the administrator's own session. */
export async function stopImpersonation() {
  const cookieStore = await cookies()
  const token = cookieStore.get(IMPERSONATION_COOKIE)?.value
  const payload = token ? parseToken(token) : null

  cookieStore.delete(IMPERSONATION_COOKIE)

  if (!payload) return { error: 'No active impersonation session.' }

  const supabase = await createClient()

  // Preferred path: replay the admin's captured refresh token. No password needed, and it
  // restores the exact session the admin was using before the switch.
  if (payload.adminRefreshToken) {
    const { error } = await supabase.auth.refreshSession({ refresh_token: payload.adminRefreshToken })
    if (!error) {
      await logActivity({
        userId: payload.adminId,
        userEmail: payload.adminEmail,
        userName: 'Administrator',
        actionType: 'ADMIN_IMPERSONATION_ENDED',
        entityType: 'USER',
        entityId: payload.adminId,
        description: 'Administrator returned to the operations console.',
      })
      return { success: true }
    }
    console.warn('stopImpersonation: refresh token replay failed, trying credentials.', error.message)
  }

  // Fallback: sign back in with the configured administrator credentials.
  const adminEmail = process.env.ADMIN_EMAIL
  const adminPassword = process.env.ADMIN_PASSWORD
  if (!adminEmail || !adminPassword) {
    await supabase.auth.signOut()
    return { error: 'Your admin session expired. Please sign in to the console again.' }
  }

  const { error } = await supabase.auth.signInWithPassword({
    email: adminEmail,
    password: adminPassword,
  })

  if (error) {
    await supabase.auth.signOut()
    return { error: 'Your admin session expired. Please sign in to the console again.' }
  }

  return { success: true }
}
