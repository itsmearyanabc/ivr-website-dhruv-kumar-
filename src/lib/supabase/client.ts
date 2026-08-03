import { createBrowserClient } from '@supabase/ssr'

/**
 * Browser-side Supabase client.
 *
 * Accepts either env name for the public key. Supabase renamed the anon key to the
 * publishable key, and a deployment that only set NEXT_PUBLIC_SUPABASE_ANON_KEY used to
 * build a client with `undefined` as its key - which fails later, at request time, instead
 * of here where the cause is obvious.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL environment variable is required.')
  if (!key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable is required.'
    )
  }

  return createBrowserClient(url, key)
}
