/**
 * The browser half of reCAPTCHA Enterprise, checkbox ("I'm not a robot") flow.
 *
 * Pure client helper - no server imports, so it is safe in the bundle. The token it hands back
 * proves nothing on its own; it is checked by @/lib/recaptcha on the server.
 *
 * This is the CHECKBOX integration, not the score one. The difference matters in three places:
 * the script is loaded with `render=explicit` rather than `render=<sitekey>`, the token comes
 * from a widget the customer has ticked rather than from `execute()`, and the resulting token
 * carries no action - which is why the server's replay check is conditional on there being one.
 */

type Enterprise = {
  ready: (cb: () => void) => void;
  render: (container: HTMLElement, params: { sitekey: string; callback?: (token: string) => void; 'expired-callback'?: () => void; 'error-callback'?: () => void }) => number;
  getResponse: (widgetId?: number) => string;
  reset: (widgetId?: number) => void;
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
 * Resolves once grecaptcha.enterprise is loaded and initialised, or null on timeout.
 *
 * enterprise.js is loaded async, so a widget can be asked for before the library exists.
 * Returning null rather than throwing keeps a failed third-party script from breaking the
 * form it was meant to protect.
 */
export function waitForEnterprise(timeoutMs = 8000): Promise<Enterprise | null> {
  return new Promise(resolve => {
    if (!recaptchaEnabled()) return resolve(null);
    const started = Date.now();
    const poll = () => {
      const enterprise = window.grecaptcha?.enterprise;
      if (enterprise?.render) {
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
