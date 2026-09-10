import type { Metadata } from "next";
import Script from "next/script";
import { Montserrat } from "next/font/google";
import "./globals.css";

/**
 * Loaded through next/font rather than a stylesheet link, so the files are served from this
 * origin with the CSS inlined and the metrics known at build time - no request to a third
 * party on first paint, and no reflow when the face arrives.
 *
 * Only the three weights the design actually uses: 400 for body copy, 600 for sub-headings,
 * 700 for headlines. Every extra weight is another file on the critical path.
 */
const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "BulkShout | IVR Broadcast Panel",
  description: "Create, track, and manage IVR broadcasts from a single panel.",
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={montserrat.variable}>
      <body>
        {children}
        {/* reCAPTCHA Enterprise, score-based: no puzzle, no checkbox - it scores the session
            and the server decides. Loaded lazily because nothing on first paint needs it and
            the token is only wanted at submit time; getRecaptchaToken waits for it. Rendered
            only when a site key is set, so an unconfigured deployment ships no third-party
            script at all. */}
        {siteKey && (
          <Script
            src={`https://www.google.com/recaptcha/enterprise.js?render=${siteKey}`}
            strategy="lazyOnload"
          />
        )}
      </body>
    </html>
  );
}
