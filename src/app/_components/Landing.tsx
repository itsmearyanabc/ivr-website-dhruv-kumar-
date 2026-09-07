"use client";

/**
 * The page a signed-out visitor lands on.
 *
 * Until now `/` put the sign-in card in front of anyone who arrived, which is the right thing
 * for an operations console reached from a bookmark and the wrong thing for a product on its
 * own domain: a visitor who has not decided to buy yet is asked for a password before being
 * told what the thing does.
 *
 * So this sits in front of the auth card rather than replacing it. Both header buttons open
 * the same form the site has always used, with the mode preselected, and "Back" returns here.
 * Nothing about signing in or signing up changes - only what is shown before it.
 *
 * The admin console never renders this. `/admin` is a restricted console, not a shopfront,
 * and putting marketing in front of it would only add a click for the operator.
 */

import { Icon } from "@/app/_components/ui";

/** What a customer actually gets, in the order they tend to ask about it. */
const CAPABILITIES = [
  {
    icon: "mic",
    title: "Voice broadcasts at scale",
    text: "Upload a recording or have one generated from your script, attach your contact list, and reach every number on it.",
  },
  {
    icon: "wallet",
    title: "Prepaid wallet, no surprises",
    text: "Top up from any UPI app. Each broadcast is priced per number before you confirm it, and the total is shown to the paisa.",
  },
  {
    icon: "activity",
    title: "Track it while it runs",
    text: "Every campaign moves through placed, in progress and completed, with the reason recorded at each step.",
  },
  {
    icon: "file",
    title: "Reports you can act on",
    text: "A delivery report lands against the order when it closes. Failed calls are refunded to your wallet automatically.",
  },
];

/** The order flow, said plainly. Three steps because it genuinely is three. */
const STEPS = [
  { n: "1", title: "Top up your wallet", text: "Pay by UPI and submit the reference. Your balance is credited once it clears." },
  { n: "2", title: "Build the broadcast", text: "Pick a service, add your audio or script, paste or upload the numbers." },
  { n: "3", title: "Watch it land", text: "Follow the status live and download the report when it is done." },
];

export default function Landing({ onSignIn, onSignUp }: {
  onSignIn: () => void;
  onSignUp: () => void;
}) {
  return (
    <main className="landing-page">
      <header className="landing-header">
        <div className="landing-header-inner">
          <div className="brand">
            <span className="brand-mark"><b>X</b></span>
            <span>XPACK<em>PANEL</em></span>
          </div>
          {/* Both routes into the product sit together in the corner where a visitor looks
              for them, and repeat in the hero for anyone who scrolled straight past. */}
          <nav className="landing-nav">
            <button type="button" className="landing-link" onClick={onSignIn}>Sign in</button>
            <button type="button" className="landing-cta" onClick={onSignUp}>
              Create account <Icon name="arrow" size={15} />
            </button>
          </nav>
        </div>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-copy">
          <p className="eyebrow">IVR BROADCAST PANEL</p>
          <h1>Every broadcast,<br />clear and under control.</h1>
          <p className="landing-lede">
            Send voice campaigns to thousands of numbers from one panel. Prepaid, priced per
            number, and reported on when it lands.
          </p>
          <div className="landing-hero-actions">
            <button type="button" className="landing-cta large" onClick={onSignUp}>
              Create your account <Icon name="arrow" size={16} />
            </button>
            <button type="button" className="landing-ghost" onClick={onSignIn}>
              I already have one
            </button>
          </div>
          <ul className="landing-points">
            <li><Icon name="check" size={15} /> No setup fee</li>
            <li><Icon name="check" size={15} /> Pay per number</li>
            <li><Icon name="check" size={15} /> Failed calls refunded</li>
          </ul>
        </div>

        {/* A flat abstraction of the order screen rather than a screenshot: it cannot go stale
            when the panel changes, and it loads as markup instead of an image. */}
        <div className="landing-hero-art" aria-hidden="true">
          <div className="art-card">
            <div className="art-row"><span className="art-label">Service</span><span className="art-value">100 Calls</span></div>
            <div className="art-row"><span className="art-label">Contacts</span><span className="art-value">1,240</span></div>
            <div className="art-row"><span className="art-label">Rate</span><span className="art-value">₹1.00 / number</span></div>
            <div className="art-divider" />
            <div className="art-row total"><span className="art-label">Total</span><span className="art-value">₹1,240.00</span></div>
            <div className="art-bar"><span style={{ width: "72%" }} /></div>
            <p className="art-note">In progress · 892 of 1,240 delivered</p>
          </div>
        </div>
      </section>

      <section className="landing-section">
        <h2>What you get</h2>
        <div className="landing-grid">
          {CAPABILITIES.map(c => (
            <article key={c.title} className="landing-card">
              <span className="landing-card-icon"><Icon name={c.icon} size={18} /></span>
              <h3>{c.title}</h3>
              <p>{c.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section landing-steps-section">
        <h2>How it works</h2>
        <div className="landing-steps">
          {STEPS.map(s => (
            <article key={s.n} className="landing-step">
              <span className="landing-step-n">{s.n}</span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-closer">
        <h2>Ready to send your first broadcast?</h2>
        <p>Create an account and top up whenever you are ready. Nothing is charged until you place an order.</p>
        <button type="button" className="landing-cta large" onClick={onSignUp}>
          Create your account <Icon name="arrow" size={16} />
        </button>
        <p className="landing-closer-alt">
          Already registered?{" "}
          <button type="button" className="landing-link inline" onClick={onSignIn}>Sign in</button>
        </p>
      </section>

      <footer className="landing-footer">
        <div className="brand small">
          <span className="brand-mark"><b>X</b></span>
          <span>XPACK<em>PANEL</em></span>
        </div>
        <p>© {new Date().getFullYear()} Xpack. IVR voice broadcast services.</p>
      </footer>
    </main>
  );
}
