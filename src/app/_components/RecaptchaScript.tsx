"use client";

/**
 * Loads reCAPTCHA Enterprise, only where a token is actually going to be asked for.
 *
 * Deliberately NOT in the root layout. There it would fetch and run a Google script for every
 * visitor to the landing page - people reading the pricing, the FAQ or the policy pages, none
 * of whom are submitting anything. Mounted beside the forms instead: the auth card and the
 * top-up form. next/script de-duplicates by `src`, so rendering it in both places loads it
 * once.
 *
 * Renders nothing when no site key is configured, so an unconfigured deployment ships no
 * third-party script at all.
 */

import Script from "next/script";
import { RECAPTCHA_SITE_KEY, recaptchaEnabled } from "@/lib/recaptchaClient";

export default function RecaptchaScript() {
  if (!recaptchaEnabled()) return null;

  return (
    <Script
      id="recaptcha-enterprise"
      src={`https://www.google.com/recaptcha/enterprise.js?render=${RECAPTCHA_SITE_KEY}`}
      strategy="afterInteractive"
    />
  );
}
