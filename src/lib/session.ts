/**
 * Per-request caching for the two lookups almost every server action starts with.
 *
 * `supabase.auth.getUser()` is not a local token decode - it calls the Supabase auth server
 * to validate the JWT, so it is a network round trip every time. Most actions here did it
 * twice: once inside `checkIsAdmin()` to find the caller, and again in the action body to get
 * the same user. Resolving the admin role added a third trip to the `users` table. Six
 * actions fire in parallel when the panel mounts, so an operator was waiting on roughly a
 * dozen avoidable round trips before anything rendered - on a free Render instance talking to
 * a free Supabase project, over the public internet.
 *
 * React's `cache()` memoises for the lifetime of one server request, which is exactly the
 * right scope: a Server Action invocation is one request, so two calls inside it share an
 * answer, while the next request re-validates from scratch. Nothing is cached across users,
 * across requests, or beyond the moment the action returns - so a signed-out or disabled
 * session is never served from a stale entry.
 *
 * Not a `'use server'` module: these are helpers, not endpoints.
 */

import { cache } from 'react'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

/** The signed-in user for this request, or null. At most one auth round trip per request. */
export const getAuthUser = cache(async () => {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    return user ?? null
  } catch {
    return null
  }
})

/**
 * The caller's role for this request, or null when signed out. One lookup per request.
 *
 * Read the two exports below rather than this: which of them a call site wants is the whole
 * question, and naming it at the call site is what stops "is this an admin?" quietly meaning
 * "may this person see the audit trail?".
 */
const resolveRole = cache(async (): Promise<string | null> => {
  try {
    const user = await getAuthUser()
    if (!user) return null

    const supabase = await createServiceRoleClient()
    const { data: profile } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single()

    return profile?.role ?? null
  } catch {
    return null
  }
})

/**
 * Whether this request's caller may operate the panel.
 *
 * True for staff as well as the administrator. Staff run the panel - they fulfil orders,
 * verify top-ups, answer tickets - so every gate that asks "may this person work here?"
 * answers yes for them. The narrower question has its own function below.
 */
export const resolveIsAdmin = cache(async (): Promise<boolean> => {
  const role = await resolveRole()
  return role === 'ADMIN' || role === 'STAFF'
})

/**
 * Whether this request's caller is the owner of the account, not a member of staff.
 *
 * Gates the things staff are hired under rather than trusted with: the activity log, which
 * records what each of them did, and the staff directory itself. A staff member who could
 * add or disable staff could grant themselves cover or lock out the person auditing them, and
 * a staff member who could read the log could check what had been noticed.
 *
 * The super admin is the ADMIN_EMAIL account, matched on the address rather than on a column.
 * That keeps it outside anything the panel can edit: no query, no migration and no mistake in
 * this file can promote someone into it or demote the person holding it, and there is no way
 * to end up locked out of your own console by a bad row.
 */
export const resolveIsSuperAdmin = cache(async (): Promise<boolean> => {
  try {
    const configured = process.env.ADMIN_EMAIL?.trim().toLowerCase()
    if (!configured) return false

    const user = await getAuthUser()
    if (!user?.email) return false
    if (user.email.trim().toLowerCase() !== configured) return false

    // The address alone is not enough: it has to belong to an account the database also
    // considers an administrator, so a customer who managed to register under that address
    // could not inherit the console with it.
    return (await resolveRole()) === 'ADMIN'
  } catch {
    return false
  }
})
