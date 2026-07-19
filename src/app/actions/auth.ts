'use server'
import { createClient, createAdminClient, createServiceRoleClient } from '@/lib/supabase/server'

export async function checkIsAdmin() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false

    const supabaseAdmin = await createServiceRoleClient()
    const { data: profile } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single()

    return profile?.role === 'ADMIN'
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

  const confirm = String(formData.get("confirm") || "")

  if (!email || !password || !name) {
    return { error: 'Please fill out all required fields.' }
  }
  
  if (password !== confirm) {
    return { error: 'Passwords do not match.' }
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

  if (data.user) {
    const adminSupabase = await createAdminClient()
    const { error: confirmError } = await adminSupabase.auth.admin.updateUserById(data.user.id, { email_confirm: true })
    if (confirmError) {
      console.error('Failed to auto-confirm email:', confirmError)
    }
  }

  // Automatically sign in the user to set session cookies
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password
  })

  if (signInError) {
    console.error('Auto-signin error after signup:', signInError)
    return { error: 'Account created but automatic sign-in failed. Please sign in manually.' }
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

  if (isAdmin) {
    const adminEmail = process.env.ADMIN_EMAIL
    const adminPassword = process.env.ADMIN_PASSWORD
    
    if (!adminEmail || !adminPassword) {
      return { error: 'System configuration error: ADMIN_EMAIL and ADMIN_PASSWORD must be set.' }
    }

    const adminEmailLower = adminEmail.toLowerCase()
    
    if (email !== adminEmail || password !== adminPassword) {
      return { error: 'Incorrect administrator username or password.' }
    }

    try {
      const adminSupabase = await createAdminClient()

      // Look up user by email to get ID
      const { data: { users }, error: listError } = await adminSupabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
      if (listError) {
        console.error('Admin listUsers error:', listError)
        return { error: 'Admin database sync failed. Check your supabase environment variables.' }
      }

      const matchedUser = users.find(u => u.email?.toLowerCase() === adminEmailLower)

      let userId: string
      if (!matchedUser) {
        // Create Admin user in Auth
        const { data: newUser, error: createError } = await adminSupabase.auth.admin.createUser({
          email: adminEmailLower,
          password: adminPassword,
          email_confirm: true,
          user_metadata: { name: 'Admin', company: 'Xpack Operations' }
        })

        if (createError || !newUser.user) {
          console.error('Admin createUser error:', createError)
          return { error: 'Failed to create operational Admin account in auth.' }
        }
        userId = newUser.user.id
      } else {
        userId = matchedUser.id
        // Sync password
        const { error: updateError } = await adminSupabase.auth.admin.updateUserById(userId, {
          email: adminEmailLower,
          password: adminPassword
        })
        if (updateError) {
          console.error('Admin password update error:', updateError)
          return { error: 'Failed to sync operational Admin password.' }
        }
      }

      // Sync role in public.users to ADMIN
      const { error: roleError } = await adminSupabase
        .from('users')
        .update({ role: 'ADMIN' })
        .eq('id', userId)

      if (roleError) {
        console.error('Admin role update error:', roleError)
        return { error: 'Failed to update database Admin role.' }
      }
    } catch (e) {
      console.error('Failed to sync Admin profile:', e)
      return { error: 'Admin database synchronization failed.' }
    }
  }

  // Sign in natively
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    return { error: 'Login Failed: ' + error.message }
  }

  // Fetch profile to return profile data
  const supabaseService = await createServiceRoleClient()
  const { data: profile } = await supabaseService
    .from('users')
    .select('full_name, company_name')
    .eq('id', data.user.id)
    .single()

  return {
    success: true,
    user: {
      name: profile?.full_name || 'User',
      company: profile?.company_name || ''
    }
  }
}

export async function signOut() {
  try {
    const supabase = await createClient()
    await supabase.auth.signOut()
  } catch (error) {
    console.error('SignOut Error:', error)
  }
}

export async function getUserSession() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) return { session: null }

    const supabaseService = await createServiceRoleClient()
    const { data: profile } = await supabaseService
      .from('users')
      .select('role, full_name, company_name')
      .eq('id', user.id)
      .single()

    return {
      session: {
        role: profile?.role === 'ADMIN' ? 'admin' : 'customer',
        name: profile?.full_name || 'User',
        email: user.email || '',
        company: profile?.company_name || ''
      }
    }
  } catch (e) {
    console.error('Session verification error:', e)
    return { session: null }
  }
}
