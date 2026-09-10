/**
 * reCAPTCHA Enterprise verification.
 *
 * Deliberately NOT a `'use server'` module, for the same reason as @/lib/activity and
 * @/lib/pricing: every export of one is an endpoint any browser can POST to, and this one
 * takes the token and the expected action as plain arguments. Exported as an action, a caller
 * could ask it to verify whatever it liked and read the verdict back - which is the opposite
 * of a gate.
 *
 * A site key on its own proves nothing. It produces a token in the browser, and a token that
 * is never checked server-side is decoration: anyone can call a Server Action directly without
 * ever loading the page that would have issued one. The check that matters is the assessment
 * below, which asks Google whether this specific token is valid, was issued for this action,
 * and scored above the threshold.
 */

const ASSESSMENT_TIMEOUT_MS = 6000;

/**
 * Google's own default. 1.0 is almost certainly human, 0.0 almost certainly a bot; 0.5 is the
 * documented starting point. Raise it once there is real traffic to look at - the assessment
 * scores are visible in the Cloud console, and tuning blind risks turning away customers.
 */
const SCORE_THRESHOLD = 0.5;

export type RecaptchaAction = 'signup' | 'signin' | 'topup';

export type RecaptchaResult =
  /** Verified, or deliberately not enforced because the feature is not configured. */
  | { ok: true; score?: number; skipped?: boolean }
  /** Refused. `reason` is safe to show a person; `detail` is for the server log only. */
  | { ok: false; reason: string; detail?: string };

/**
 * Whether a refusal actually refuses.
 *
 * 'monitor' assesses every request and logs the verdict, then lets it through regardless.
 * That is how this should be rolled out: a captcha that is wrong about real customers turns
 * away business silently, and the only way to know how real traffic scores is to watch it
 * score real traffic. Once the log shows legitimate sign-ins landing above the threshold,
 * set RECAPTCHA_MODE=enforce.
 *
 * Defaults to monitor deliberately. Enforcing is a decision to make on evidence, not the
 * thing that happens by default the moment an API key is pasted in.
 */
function isEnforcing(): boolean {
  return (process.env.RECAPTCHA_MODE || 'monitor').toLowerCase() === 'enforce';
}

/** True once the project and API key are set. The site key alone is not enough. */
export function isRecaptchaConfigured(): boolean {
  return Boolean(
    process.env.RECAPTCHA_PROJECT_ID &&
    process.env.RECAPTCHA_API_KEY &&
    process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY,
  );
}

/**
 * Ask Google to assess one token.
 *
 * Returns ok:true when unconfigured, so the panel behaves exactly as it does today until all
 * three variables are set - the same shape as the UPI gateway. A half-configured integration
 * must not lock every customer out of signing in.
 */
export async function verifyRecaptcha(
  token: string,
  expectedAction: RecaptchaAction,
): Promise<RecaptchaResult> {
  if (!isRecaptchaConfigured()) return { ok: true, skipped: true };

  if (!token) {
    return { ok: false, reason: 'The security check did not complete. Please reload the page and try again.', detail: 'no token supplied' };
  }

  const project = process.env.RECAPTCHA_PROJECT_ID!;
  const apiKey = process.env.RECAPTCHA_API_KEY!;
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY!;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASSESSMENT_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://recaptchaenterprise.googleapis.com/v1/projects/${encodeURIComponent(project)}/assessments?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: { token, siteKey, expectedAction } }),
        signal: controller.signal,
        cache: 'no-store',
      },
    );

    if (!response.ok) {
      // A misconfigured project or a rejected API key must not become an outage for every
      // customer trying to sign in, so this fails open and shouts in the log instead.
      console.error(`[recaptcha] assessment HTTP ${response.status} - allowing through`);
      return { ok: true, skipped: true };
    }

    const data = await response.json();
    const props = data?.tokenProperties;

    if (!props?.valid) {
      return {
        ok: false,
        reason: 'The security check could not be verified. Please reload the page and try again.',
        detail: `invalid token: ${props?.invalidReason || 'unknown'}`,
      };
    }

    // A token is issued for one action. Without this check a token harvested from the signup
    // form would be replayable against sign-in, or against the top-up form.
    if (props.action !== expectedAction) {
      return {
        ok: false,
        reason: 'The security check did not match this form. Please reload the page and try again.',
        detail: `action mismatch: got ${props.action}, expected ${expectedAction}`,
      };
    }

    const score = Number(data?.riskAnalysis?.score ?? 0);
    if (score < SCORE_THRESHOLD) {
      return {
        ok: false,
        reason: 'This request looked automated and was blocked. If this is a mistake, contact support.',
        detail: `score ${score} below ${SCORE_THRESHOLD}`,
      };
    }

    return { ok: true, score };
  } catch (error: unknown) {
    // Timeout or network failure. Fail open for the same reason as the HTTP branch above:
    // Google being unreachable is not a reason to stop taking customers.
    const aborted = error instanceof Error && error.name === 'AbortError';
    console.error(`[recaptcha] assessment ${aborted ? 'timed out' : 'failed'} - allowing through`);
    return { ok: true, skipped: true };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verify, and log the reason when it refuses.
 *
 * The detail behind a refusal - the score, the invalid reason - stays server-side. Telling a
 * caller which of the checks it failed is telling an attacker what to adjust.
 */
export async function guardRecaptcha(
  token: string,
  action: RecaptchaAction,
): Promise<{ error: string } | null> {
  const result = await verifyRecaptcha(token, action);
  if (result.ok) return null;

  if (!isEnforcing()) {
    console.warn(`[recaptcha][monitor] WOULD REFUSE ${action}: ${result.detail || result.reason} - allowed through because RECAPTCHA_MODE is not 'enforce'`);
    return null;
  }

  console.warn(`[recaptcha] refused ${action}: ${result.detail || result.reason}`);
  return { error: result.reason };
}
