import { createClient } from '@/lib/supabase/server'
import { relativeRedirect } from '@/lib/relativeRedirect'

/**
 * Where Google sends the customer back to.
 *
 * OAuth is a redirect flow, not a form post, so it cannot be a Server Action: Google returns
 * the browser to this URL carrying a one-time `code`, which is exchanged here for a session
 * and written into the cookies the rest of the app already reads.
 *
 * The `public.users` row is created by the existing on_auth_user_created trigger, which reads
 * the name out of the provider's metadata. company and phone are nullable, so a Google account
 * with neither still produces a valid row - no migration is needed for this.
 */
export async function GET(request: Request) {
  // Only the query string is read from request.url - its host is Next's listen address, not
  // the customer's (see relativeRedirect).
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')

  // The customer closed Google's window, or refused. Not a failure worth a stack trace -
  // send them back to the card they came from.
  if (error) {
    return relativeRedirect('/signin?oauth=cancelled')
  }

  if (!code) {
    return relativeRedirect('/signin?oauth=failed')
  }

  const supabase = await createClient()
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

  if (exchangeError) {
    console.error('[oauth] code exchange failed:', exchangeError.message)
    return relativeRedirect('/signin?oauth=failed')
  }

  // Straight to the panel, on the same host the session cookies were just written for.
  return relativeRedirect('/')
}
