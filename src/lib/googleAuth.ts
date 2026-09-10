/**
 * Starting a Google sign-in from the browser.
 *
 * Not a Server Action: OAuth begins with a full-page redirect to Google, which a form post
 * cannot do. The browser client sends the customer to Google, Google returns them to
 * /auth/callback, and that route exchanges the code for a session.
 *
 * `NEXT_PUBLIC_GOOGLE_AUTH` gates the button, because whether Google works is decided in the
 * Supabase dashboard rather than in this codebase - and a button that always fails is worse
 * than no button. Turn it on only once the provider is enabled there.
 */

import { createClient } from '@/lib/supabase/client'

export function googleAuthEnabled(): boolean {
  return process.env.NEXT_PUBLIC_GOOGLE_AUTH === '1'
}

export async function startGoogleAuth(): Promise<{ error?: string }> {
  try {
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        // Built from the live origin rather than a configured URL, so it is correct on the
        // real domain and on localhost without a second variable to keep in step.
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) return { error: error.message }
    return {}
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Could not start Google sign-in.' }
  }
}
