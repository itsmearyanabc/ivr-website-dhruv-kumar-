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

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/app/_components/ui";
import { getCategoriesWithServices } from "@/app/actions/categoriesServices";
import { isQuantityPriced, unitRate } from "@/lib/quantity";

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

/**
 * "What would this cost me?", answered on the landing page before anyone signs up.
 *
 * Display only. Nothing here places an order or quotes a price that binds - the figure that
 * moves money is still `resolveServicePrice` on the server, against the specific service a
 * customer picks and any per-customer rate they have. This is the shop window.
 *
 * The rate is the average across the quantity-priced services actually on sale, read through
 * the same public catalogue action the order screen uses, so it tracks the price list instead
 * of being a number typed into the marketing copy and left to rot. Services are priced by the
 * pack here - Rs 500 per 600 calls, Rs 1000 per 1300 - so the averaged per-call rate sits
 * between the cheapest and dearest of them, and is labelled as an average rather than dressed
 * up as a quote.
 */
function CallCalculator() {
  const [rate, setRate] = useState<number | null>(null);
  const [calls, setCalls] = useState(1000);

  useEffect(() => {
    let alive = true;
    getCategoriesWithServices()
      .then(res => {
        if (!alive) return;
        const rates: number[] = [];
        // Typed to just the fields the rate needs, rather than `any`: this walks a payload
        // shaped by the catalogue action, and naming what is read here means a change to that
        // shape shows up as a type error instead of a silently empty average.
        type PricedService = { price: number | string; unit_quantity?: number | null };
        const cats = (res.data || []) as Array<{ services?: PricedService[] }>;
        for (const cat of cats) {
          for (const svc of cat.services || []) {
            // Flat-priced services have no per-call rate to average - a fixed fee per order
            // says nothing about what one more number costs.
            if (isQuantityPriced(svc)) {
              const r = unitRate(svc);
              if (r > 0) rates.push(r);
            }
          }
        }
        if (rates.length) setRate(rates.reduce((a, b) => a + b, 0) / rates.length);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const total = useMemo(() => (rate === null ? null : rate * calls), [rate, calls]);

  /** A name for the size of the campaign. Cosmetic - the rate shown does not change with it. */
  const tier = calls >= 25000 ? "Enterprise" : calls >= 10000 ? "Scale" : calls >= 2500 ? "Growth" : "Starter";

  const money = (n: number) =>
    `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="landing-hero-art">
      <div className="calc-card">
        <div className="calc-head">
          <h3>Estimate your campaign</h3>
          <p>Move the slider to see what a broadcast of that size costs.</p>
        </div>

        <div className="calc-readout">
          <div className="calc-calls">
            <strong>{calls.toLocaleString("en-IN")}</strong>
            <span>calls</span>
          </div>
          <span className="calc-tier">{tier}</span>
        </div>

        <input
          type="range"
          className="calc-slider"
          min={100}
          max={50000}
          step={100}
          value={calls}
          onChange={e => setCalls(Number(e.target.value))}
          aria-label="Number of calls"
        />
        <div className="calc-scale">
          <span>100</span><span>10k</span><span>25k</span><span>50k</span>
        </div>

        <div className="calc-figures">
          <div className="calc-figure">
            <span className="calc-figure-label">Average rate</span>
            <strong>{rate === null ? "—" : `₹${rate.toFixed(2)}`}</strong>
            <small>per call</small>
          </div>
          <div className="calc-figure primary">
            <span className="calc-figure-label">Estimated cost</span>
            <strong>{total === null ? "—" : money(total)}</strong>
            <small>{calls.toLocaleString("en-IN")} calls</small>
          </div>
        </div>

        <p className="calc-note">
          {rate === null
            ? "Loading current rates…"
            : "Averaged across our current services. Your exact rate is shown before you confirm any order."}
        </p>
      </div>
    </div>
  );
}

export default function Landing({ onSignIn, onSignUp }: {
  onSignIn: () => void;
  onSignUp: () => void;
}) {
  return (
    <main className="landing-page">
      <header className="landing-header">
        <div className="landing-header-inner">
          {/* The supplied artwork is painted on a cream ground rather than a transparent
              one, so it is used on the page's light surfaces only. The dark sidebar and the
              auth panel keep the lettermark until there is a knockout version. */}
          <Image
            className="landing-logo"
            src="/bulkshout-logo.png"
            alt="BulkShout - Say More. Reach Further."
            width={2321}
            height={449}
            priority
          />
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

        <CallCalculator />
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
        <Image
          className="landing-logo footer"
          src="/bulkshout-logo.png"
          alt="BulkShout"
          width={2321}
          height={449}
        />
        <p>© {new Date().getFullYear()} BulkShout. IVR voice broadcast services.</p>
      </footer>
    </main>
  );
}
