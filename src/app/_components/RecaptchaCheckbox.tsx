"use client";

/**
 * The "I'm not a robot" widget.
 *
 * Renders itself once the library is up and reports the token through `onToken`. The token is
 * cleared again when it expires (reCAPTCHA tokens are good for two minutes) or when the widget
 * errors, so a form cannot submit a token the customer ticked five minutes ago.
 *
 * `resetSignal` is a counter rather than an imperative handle: bump it after a failed submit
 * and the box unticks, which reCAPTCHA requires - a token is single-use, so leaving it ticked
 * after a rejected sign-in would fail the next attempt for a reason the customer cannot see.
 *
 * Renders nothing when no site key is configured, so an unconfigured deployment shows no
 * empty gap where the widget would be.
 */

import { useEffect, useRef, useState } from "react";
import { RECAPTCHA_SITE_KEY, recaptchaEnabled, waitForEnterprise } from "@/lib/recaptchaClient";

export default function RecaptchaCheckbox({
  onToken,
  onUnavailable,
  resetSignal = 0,
}: {
  onToken: (token: string) => void;
  /**
   * Called when the widget cannot be drawn at all - the script blocked, Google unreachable,
   * the domain not on the key. The form uses it to stop demanding a tick that is impossible
   * to give: a dead third-party iframe must not be the reason a customer cannot sign in. The
   * server still decides, and still refuses an empty token once it is enforcing.
   */
  onUnavailable?: () => void;
  resetSignal?: number;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const widgetId = useRef<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!recaptchaEnabled()) return;
    let cancelled = false;

    (async () => {
      const enterprise = await waitForEnterprise();
      if (cancelled || !enterprise || !holder.current) {
        if (!cancelled && !enterprise) { setFailed(true); onUnavailable?.(); }
        return;
      }
      // Guard against a second render in React strict mode, which would stack two widgets.
      if (widgetId.current !== null || holder.current.childElementCount > 0) return;

      try {
        widgetId.current = enterprise.render(holder.current, {
          sitekey: RECAPTCHA_SITE_KEY,
          callback: (token: string) => onToken(token),
          "expired-callback": () => onToken(""),
          "error-callback": () => onToken(""),
        });
      } catch {
        setFailed(true);
        onUnavailable?.();
      }
    })();

    return () => { cancelled = true; };
    // onToken is intentionally not a dependency: the widget is rendered once, and re-rendering
    // it on every parent update would reset the customer's tick mid-form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (resetSignal === 0 || widgetId.current === null) return;
    try {
      window.grecaptcha?.enterprise?.reset(widgetId.current);
      onToken("");
    } catch {
      /* nothing useful to do; the customer can tick it again */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal]);

  if (!recaptchaEnabled()) return null;

  return (
    <div className="recaptcha-box">
      <div ref={holder} />
      {failed && (
        <p className="recaptcha-failed">
          The security check could not load. Check your connection or any ad blocker, then
          reload the page.
        </p>
      )}
    </div>
  );
}
