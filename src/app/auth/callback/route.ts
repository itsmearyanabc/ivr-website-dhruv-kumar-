import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')

  // The customer closed Google's window, or refused. Not a failure worth a stack trace -
  // send them back to the card they came from.
  if (error) {
    return NextResponse.redirect(new URL('/signin?oauth=cancelled', url.origin))
  }

  if (!code) {
    return NextResponse.redirect(new URL('/signin?oauth=failed', url.origin))
  }

  const supabase = await createClient()
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

  if (exchangeError) {
    console.error('[oauth] code exchange failed:', exchangeError.message)
    return NextResponse.redirect(new URL('/signin?oauth=failed', url.origin))
  }

  // Straight to the panel. `origin` rather than a configured base URL so this keeps working on
  // whichever host it is served from, and a redirect can never be pointed off-site.
  return NextResponse.redirect(new URL('/', url.origin))
}
