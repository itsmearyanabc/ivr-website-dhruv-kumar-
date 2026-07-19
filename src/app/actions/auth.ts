'use server'

import { createClient } from '@/lib/supabase/server'

export async function signUp(formData: FormData) {
  const email = String(formData.get("email") || "").trim().toLowerCase()
  const password = String(formData.get("password") || "")
  const confirm = String(formData.get("confirm") || "")
  const name = String(formData.get("name") || "").trim()
  const company = String(formData.get("company") || "").trim()
  const phone = String(formData.get("phone") || "").trim()

  if (!email || !password || !name) {
    return { error: 'Please complete all required fields.' }
  }

  if (password.length < 8) {
    return { error: 'Password must be at least 8 characters long.' }
  }

  if (password !== confirm) {
    return { error: 'Passwords do not match.' }
  }

  const supabase = await createClient()

  // Sign up with Supabase Auth
  const { error } = await supabase.auth.signUp({
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

  const supabase = await createClient()

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    return { error: 'Incorrect email or password.' }
  }

  // If we need to verify admin role, check the public.users table
  if (isAdmin) {
    const { data: userRecord } = await supabase
      .from('users')
      .select('role')
      .eq('id', data.user.id)
      .single()

    if (!userRecord || userRecord.role !== 'ADMIN') {
      await supabase.auth.signOut()
      return { error: 'Incorrect administrator username or password.' }
    }
  }

  return { success: true }
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
}
