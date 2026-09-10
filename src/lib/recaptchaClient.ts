/**
 * Getting a reCAPTCHA Enterprise token in the browser.
 *
 * Pure client helper - no server imports, so it is safe in the bundle. The token it returns
 * proves nothing on its own; it is checked by @/lib/recaptcha on the server, and the action
 * passed here must match the action the server expects or the assessment is refused.
 */

import type { RecaptchaAction } from "@/lib/recaptcha";

type Enterprise = {
  ready: (cb: () => void) => void;
  execute: (siteKey: string, opts: { action: string }) => Promise<string>;
};

declare global {
  interface Window {
    grecaptcha?: { enterprise?: Enterprise };
  }
}

export const RECAPTCHA_SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY || "";

/** True when a site key is configured. The server decides whether to enforce. */
export function recaptchaEnabled(): boolean {
  return Boolean(RECAPTCHA_SITE_KEY);
}

/**
 * A token for one action, or "" when reCAPTCHA is not configured or has not loaded.
 *
 * Never throws and never blocks a submission: an empty string is passed to the server, which
 * refuses it only when reCAPTCHA is actually configured there. A third-party script failing
 * to load must not be the thing that stops someone signing up.
 */
export async function getRecaptchaToken(action: RecaptchaAction): Promise<string> {
  if (!recaptchaEnabled()) return "";

  const enterprise = await waitForEnterprise();
  if (!enterprise) return "";

  try {
    return await enterprise.execute(RECAPTCHA_SITE_KEY, { action });
  } catch {
    return "";
  }
}

/** enterprise.js is loaded async, so a fast submit can arrive before it is ready. */
function waitForEnterprise(timeoutMs = 4000): Promise<Enterprise | null> {
  return new Promise(resolve => {
    const started = Date.now();
    const poll = () => {
      const enterprise = window.grecaptcha?.enterprise;
      if (enterprise?.execute) {
        // `ready` guarantees the library has finished initialising before execute is called.
        try {
          enterprise.ready(() => resolve(enterprise));
        } catch {
          resolve(enterprise);
        }
        return;
      }
      if (Date.now() - started > timeoutMs) return resolve(null);
      setTimeout(poll, 100);
    };
    poll();
  });
}
