'use server'
import { createClient } from '@/lib/supabase/server'
import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'

const getSecret = () => new TextEncoder().encode(process.env.SUPABASE_SERVICE_ROLE_KEY || 'default_admin_secret')

export async function checkIsAdmin() {
  const cookieStore = await cookies()
  const token = cookieStore.get('xpack-admin')?.value
  if (!token) return false
  try {
    await jwtVerify(token, getSecret())
    return true
  } catch {
    return false
  }
}

export async function signUp(formData: FormData) {
  const email = String(formData.get("email") || "").trim().toLowerCase()
  const password = String(formData.get("password") || "")
  const name = String(formData.get("name") || "")
  const company = String(formData.get("company") || "")
  const phone = String(formData.get("phone") || "")

  if (!email || !password || !name) {
    return { error: 'Please fill out all required fields.' }
  }

  const supabase = await createClient()

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        name,
        company,
        phone,
      }
    }
  })

  if (error) {
    if (error.message.includes("already registered")) {
       return { error: 'This email is already registered. Try login instead.' }
    }
    return { error: error.message }
  }

  return { success: true }
}

export async function signIn(formData: FormData, isAdmin = false) {
  const email = String(formData.get("email") || "").trim().toLowerCase()
  const password = String(formData.get("password") || "")

  if (!email || !password) {
    return { error: 'Please enter both email and password.' }
  }

  if (isAdmin) {
    const adminEmail = (process.env.ADMIN_EMAIL || 'admin@xpack.in').toLowerCase()
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123'
    
    if (email === adminEmail && password === adminPassword) {
      const token = await new SignJWT({ admin: true })
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime('7d')
        .sign(getSecret())
        
      const cookieStore = await cookies()
      cookieStore.set('xpack-admin', token, { httpOnly: true, secure: true, sameSite: 'strict', maxAge: 60*60*24*7 })
      return { success: true }
    }
    return { error: 'Incorrect administrator username or password.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    return { error: 'Incorrect email or password.' }
  }

  return { success: true }
}

export async function signOut() {
  const cookieStore = await cookies()
  cookieStore.delete('xpack-admin')
  
  const supabase = await createClient()
  await supabase.auth.signOut()
}
