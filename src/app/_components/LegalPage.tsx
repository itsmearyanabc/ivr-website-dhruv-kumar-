import Image from "next/image";
import Link from "next/link";
import MetaPixel from "@/app/_components/MetaPixel";
import SiteControl from "@/app/_components/SiteControl";

/**
 * The shell the three policy pages share: terms, refund policy, privacy policy.
 *
 * A server component with no interactivity, so these pages ship no JavaScript of their own -
 * they are documents. The landing header cannot be reused because its buttons drive the auth
 * card through client state; here a link back to the site is the whole navigation.
 *
 * `Fill` marks the details only the business can supply. It renders as a visible highlighted
 * box rather than an inline blank, so a page cannot be published with a placeholder still in
 * it without somebody noticing.
 */
export function Fill({ children }: { children: React.ReactNode }) {
  return <mark className="legal-fill">[{children}]</mark>;
}

export default function LegalPage({
  title,
  updated,
  intro,
  children,
}: {
  title: string;
  /** Takes a node, not a string, so the date can carry a Fill placeholder until it is set. */
  updated: React.ReactNode;
  intro?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="legal-page">
      <MetaPixel />
      <SiteControl />
      <header className="landing-header">
        <div className="landing-header-inner">
          <Link href="/" aria-label="BulkShout home">
            <Image
              className="landing-logo"
              src="/bulkshout-logo.png"
              alt="BulkShout - Say More. Reach Further."
              width={719}
              height={120}
              priority
            />
          </Link>
          <nav className="landing-nav">
            <Link href="/" className="landing-link">Back to site</Link>
          </nav>
        </div>
      </header>

      <article className="legal-body">
        <p className="eyebrow">BULKSHOUT</p>
        <h1>{title}</h1>
        <p className="legal-updated">Last updated: {updated}</p>
        {intro && <p className="legal-intro">{intro}</p>}
        {children}
      </article>

      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <Image
            src="/bulkshout-logo.png"
            alt="BulkShout"
            width={719}
            height={120}
            className="landing-logo footer"
          />
          <nav className="legal-footer-nav">
            <Link href="/terms">Terms &amp; Conditions</Link>
            <Link href="/refund-policy">Refund Policy</Link>
            <Link href="/privacy-policy">Privacy Policy</Link>
          </nav>
          <p>© {new Date().getFullYear()} BulkShout. All rights reserved.</p>
        </div>
      </footer>
    </main>
  );
}
