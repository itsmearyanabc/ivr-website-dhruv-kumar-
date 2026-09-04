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

/** Whether this request's caller is an administrator. At most one role lookup per request. */
export const resolveIsAdmin = cache(async (): Promise<boolean> => {
  try {
    const user = await getAuthUser()
    if (!user) return false

    const supabase = await createServiceRoleClient()
    const { data: profile } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single()

    return profile?.role === 'ADMIN'
  } catch {
    return false
  }
})
