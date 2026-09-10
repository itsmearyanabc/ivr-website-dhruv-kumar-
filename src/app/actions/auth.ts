'use server'
import { createClient, createAdminClient, createServiceRoleClient } from '@/lib/supabase/server'
import { logActivity } from '@/lib/activity'
import { hasPasswordColumn } from '@/lib/supabase/schema'
import { resolveIsAdmin } from '@/lib/session'
import { guardRecaptcha } from "@/lib/recaptcha"

/**
 * Whether the caller is an administrator.
 *
 * The work is in `@/lib/session`, memoised for the length of one server request: this is
 * called by nearly every action, usually alongside a second `auth.getUser()` in the action
 * body, and each of those was its own network round trip to the Supabase auth server.
 */
export async function checkIsAdmin() {
  return resolveIsAdmin()
}

export async function signUp(formData: FormData) {
  // Before anything else, and before any write. signUp is a public endpoint, so the
  // arithmetic question on the form is not a gate - only this is.
  const refused = await guardRecaptcha(String(formData.get("recaptchaToken") || ""), 'signup')
  if (refused) return { error: refused.error }

  const email = String(formData.get("email") || "").trim().toLowerCase()
  const password = String(formData.get("password") || "")
  const name = String(formData.get("name") || "")
  const company = String(formData.get("company") || "")
  const phone = String(formData.get("phone") || "")

  const confirm = String(formData.get("confirm") || "")

  const supabase = await createClient()

  if (!email || !password || !name || !phone) {
    return { error: 'Please fill out all required fields including phone number.' }
  }
  
  if (password !== confirm) {
    return { error: 'Passwords do not match.' }
  }


  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        name,
        company,
        phone,
        password_plain: password,
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

    // The profile trigger copies password_plain across on databases where the migration has
    // run; writing it here too covers the case where the trigger predates that change.
    if (await hasPasswordColumn()) {
      const service = await createServiceRoleClient()
      await service
        .from('users')
        .update({ password_plain: password, password_updated_at: new Date().toISOString() })
        .eq('id', data.user.id)
    }

    await logActivity({
      userId: data.user.id,
      userEmail: email,
      userName: company || name,
      actionType: 'USER_REGISTERED',
      entityType: 'USER',
      entityId: data.user.id,
      description: `${name} (${email}) created a customer account.`,
    })
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

/**
 * Signs in a staff member at the operations console.
 *
 * Authenticates first and checks the role afterwards, deliberately: asking the database "is
 * this address staff?" before verifying the password would answer that question for anyone
 * who typed an address, and a wrong password and a customer's address would then give
 * different errors. Both come back as the same refusal.
 *
 * A disabled staff account is refused here as well as at the session check, so revoking
 * access takes effect on the next attempt rather than the next page load.
 */
async function signInStaff(email: string, password: string): Promise<
  { ok: true; name: string } | { ok: false; error: string }
> {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error || !data.user) {
    return { ok: false, error: 'Incorrect administrator username or password.' }
  }

  const service = await createServiceRoleClient()
  const { data: profile } = await service
    .from('users')
    .select('role, is_active, full_name')
    .eq('id', data.user.id)
    .single()

  if (profile?.role !== 'STAFF') {
    // Not staff: undo the session this attempt just created, so a customer who typed their
    // own details into the console is not left quietly signed in behind the refusal.
    await supabase.auth.signOut()
    return { ok: false, error: 'Incorrect administrator username or password.' }
  }

  if (profile.is_active === false) {
    await supabase.auth.signOut()
    return { ok: false, error: 'This staff account has been disabled. Ask the account owner to re-enable it.' }
  }

  return { ok: true, name: profile.full_name || email }
}

export async function signIn(formData: FormData, isAdmin = false) {
  // Credential stuffing is the attack this stops: signIn is a public endpoint, so the
  // per-browser lockout counter in the auth card is not a gate either.
  const refused = await guardRecaptcha(String(formData.get("recaptchaToken") || ""), 'signin')
  if (refused) return { error: refused.error }

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

    // Normalised the same way the submitted address is, a few lines above. The typed value
    // arrives trimmed and lower-cased, so comparing it against the raw environment variable
    // made any capital in ADMIN_EMAIL - or a stray space picked up pasting it into the Render
    // dashboard - reject every attempt, while blaming the password in the message.
    //
    // The password is deliberately NOT normalised: whitespace is part of a credential, and
    // trimming it here would silently accept something other than what was configured.
    const adminEmailLower = adminEmail.trim().toLowerCase()

    // Two kinds of operator sign in here. The owner is the configured pair and is matched
    // against the environment, exactly as before. Anyone else is a staff account: a real row
    // with its own password, so the audit trail can name the person rather than recording
    // every action against one shared login.
    //
    // Staff are verified by signing in for real below - this branch only decides whether to
    // let the attempt continue. The role check happens after authentication, so a customer's
    // correct password still does not open the console.
    const isOwnerAttempt = email === adminEmailLower

    if (isOwnerAttempt && password !== adminPassword) {
      return { error: 'Incorrect administrator username or password.' }
    }

    if (!isOwnerAttempt) {
      const staffOk = await signInStaff(email, password)
      if (!staffOk.ok) return { error: staffOk.error }
      return { data: { role: 'ADMIN' as const, name: staffOk.name, email, company: 'BulkShout Operations' } }
    }

    try {
      const adminSupabase = await createAdminClient()

      // FIX: Paginate through all users instead of limiting to 1000
      // listUsers with perPage:1000 fails if there are more than 1000 users
      const allUsers: Array<{ id: string; email?: string }> = []
      let page = 1
      let hasMore = true
      while (hasMore) {
        const { data: { users: pageUsers }, error: listError } = await adminSupabase.auth.admin.listUsers({ page, perPage: 100 })
        if (listError) {
          console.error('Admin listUsers error:', listError)
          return { error: 'Admin database sync failed. Check your supabase environment variables.' }
        }
        allUsers.push(...pageUsers)
        hasMore = pageUsers.length === 100
        page++
      }

      const matchedUser = allUsers.find(u => u.email?.toLowerCase() === adminEmailLower)

      let userId: string
      if (!matchedUser) {
        // Create Admin user in Auth
        const { data: newUser, error: createError } = await adminSupabase.auth.admin.createUser({
          email: adminEmailLower,
          password: adminPassword,
          email_confirm: true,
          user_metadata: { name: 'Admin', company: 'BulkShout Operations' }
        })

        if (createError || !newUser.user) {
          console.error('Admin createUser error:', createError)
          return { error: 'Failed to create operational Admin account in auth.' }
        }
        userId = newUser.user.id
      } else {
        userId = matchedUser.id
        // FIX: Only sync password when user is first found, not on every login
        // This avoids sending the plaintext password over the wire on every admin login
        // Password sync should be done via a separate admin tool if needed
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
  } else {
    // Trimmed as well as lower-cased, for the same reason as the admin branch: a stray space
    // on the configured address would stop this guard matching and quietly let the
    // administrator sign in through the customer portal instead of being sent to /admin.
    const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    if (adminEmail && email === adminEmail) {
      return { error: 'Please use the Administrator portal to log in.' }
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
  const storedPasswords = await hasPasswordColumn()
  const { data: profile } = await supabaseService
    .from('users')
    .select(`full_name, company_name, role, is_active${storedPasswords ? ', password_plain' : ''}`)
    .eq('id', data.user.id)
    .single<{ full_name: string; company_name: string; role: string; is_active: boolean; password_plain?: string }>()

  // A disabled account was previously still able to sign in - the flag only affected how the
  // row was rendered in the admin directory. Enforce it here, where it actually matters.
  if (profile?.is_active === false) {
    await supabase.auth.signOut()
    return { error: 'This account has been disabled. Please contact support.' }
  }

  // A successful sign-in proves the password, so keep the admin-visible copy in step even if
  // it was changed outside the panel.
  if (storedPasswords && profile?.role !== 'ADMIN' && profile?.password_plain !== password) {
    await supabaseService
      .from('users')
      .update({ password_plain: password, password_updated_at: new Date().toISOString() })
      .eq('id', data.user.id)
  }

  return {
    success: true,
    user: {
      role: profile?.role === 'ADMIN' ? 'admin' : 'customer',
      name: profile?.full_name || 'User',
      company: profile?.company_name || ''
    }
  }
}

export async function signOut() {
  try {
    const supabase = await createClient()
    await supabase.auth.signOut()

    // Signing out during an impersonation must also drop the "return to admin" cookie,
    // otherwise the banner would reappear on the next customer session.
    const { cookies } = await import('next/headers')
    const cookieStore = await cookies()
    cookieStore.delete('xpack_impersonation')
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
      .select('role, full_name, company_name, is_active')
      .eq('id', user.id)
      .single()

    // Disabling an account takes effect on the next page load, not only at the login screen.
    if (profile?.is_active === false) {
      await supabase.auth.signOut()
      return { session: null }
    }

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
