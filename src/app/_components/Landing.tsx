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
import { CSSProperties, useEffect, useMemo, useState } from "react";
import { Icon } from "@/app/_components/ui";
import { getCategoriesWithServices } from "@/app/actions/categoriesServices";
import { isQuantityPriced, quoteTotal, unitRate } from "@/lib/quantity";

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
 * customer picks and any per-customer rate they have.
 *
 * The price follows the actual services on sale rather than an average of them. For a given
 * number of calls it finds every service that will accept an order that size and takes the
 * cheapest, which is what a customer would rationally choose - so the rate improves as the
 * slider moves up, exactly as the price list intends, instead of sitting at one blended
 * figure that matches nothing on offer. An average was misleading in both directions: it
 * overstated the cost of a large campaign and understated a small one.
 *
 * Read through the same public catalogue action the order screen uses, so it tracks the
 * catalogue instead of being a number typed into marketing copy and left to rot.
 */

/** The range the slider covers. Named so the fill and the scale labels cannot drift from it. */
const CALLS_MIN = 100;
const CALLS_MAX = 50_000_000;
const HERO_WORDS = ["broadcast", "campaign", "order"];

/**
 * Logarithmic slider helpers.
 *
 * A linear slider across 100 → 5 crore is unusable: the first 50k occupies 0.1% of the track.
 * Mapping through log₁₀ spreads the range evenly across orders of magnitude, so 100, 1k, 10k,
 * 1 lakh, 10 lakh, 1 crore and 5 crore each get roughly equal thumb travel.
 */
const LOG_MIN = Math.log10(CALLS_MIN);
const LOG_MAX = Math.log10(CALLS_MAX);
/** Slider position (0-1000) → actual call count. */
function fromSliderPos(pos: number): number {
  const logVal = LOG_MIN + (pos / 1000) * (LOG_MAX - LOG_MIN);
  // Round to nearest 100 so the number never shows odd trailing digits.
  return Math.round(Math.pow(10, logVal) / 100) * 100;
}
/** Actual call count → slider position (0-1000). */
function toSliderPos(calls: number): number {
  const clamped = Math.max(CALLS_MIN, Math.min(CALLS_MAX, calls));
  return ((Math.log10(clamped) - LOG_MIN) / (LOG_MAX - LOG_MIN)) * 1000;
}

type PricedService = {
  name: string;
  price: number | string;
  unit_quantity?: number | null;
  min_quantity?: number | null;
  max_quantity?: number | null;
};

/** Strips the operator's internal prefix so a badge reads "500 Calls", not "Min: 500 Calls". */
function serviceLabel(name: string): string {
  return name.replace(/^\s*min[:.\s-]+/i, "").trim() || name;
}

function CallCalculator() {
  const [services, setServices] = useState<PricedService[]>([]);
  const [calls, setCalls] = useState(5000);
  const [pointerTilt, setPointerTilt] = useState({ x: 0, y: 0, rotateX: 0, rotateY: 0 });

  useEffect(() => {
    let alive = true;
    getCategoriesWithServices()
      .then(res => {
        if (!alive) return;
        const found: PricedService[] = [];
        const cats = (res.data || []) as Array<{ services?: PricedService[] }>;
        for (const cat of cats) {
          for (const svc of cat.services || []) {
            // Flat-priced services are left out: a fixed fee per order cannot be scaled to an
            // arbitrary number of calls, so it has nothing to say on this slider.
            if (isQuantityPriced(svc)) found.push(svc);
          }
        }
        setServices(found);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  /** The service a customer would pick for this many calls: the cheapest that will take it. */
  const match = useMemo(() => {
    const eligible = services.filter(svc => {
      const min = Number(svc.min_quantity || 0);
      const max = Number(svc.max_quantity || 0);
      if (min > 0 && calls < min) return false;
      if (max > 0 && calls > max) return false;
      return true;
    });
    if (!eligible.length) return null;

    return eligible
      .map(svc => ({ svc, total: quoteTotal(svc, calls), rate: unitRate(svc) }))
      .sort((a, b) => a.total - b.total)[0];
  }, [services, calls]);

  const money = (n: number) =>
    `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const handlePointerMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;
    setPointerTilt({ x: x * 10, y: y * 10, rotateX: y * -2.4, rotateY: x * 2.4 });
  };

  const cardStyle = {
    "--pointer-x": `${pointerTilt.x}px`,
    "--pointer-y": `${pointerTilt.y}px`,
    "--pointer-rotate-x": `${pointerTilt.rotateX}deg`,
    "--pointer-rotate-y": `${pointerTilt.rotateY}deg`,
  } as CSSProperties;

  return (
    <div className="landing-hero-art">
      <div
        className="calc-card"
        style={cardStyle}
        onMouseMove={handlePointerMove}
        onMouseLeave={() => setPointerTilt({ x: 0, y: 0, rotateX: 0, rotateY: 0 })}
      >
        <div className="calc-head">
          <h3>Estimate your campaign</h3>
          <p>Move the slider to see what a broadcast of that size costs.</p>
        </div>

        <div className="calc-readout">
          <div className="calc-calls">
            <strong>{calls.toLocaleString("en-IN")}</strong>
            <span>calls</span>
          </div>
          {/* The badge names the real service the price came from, so the figure below can be
              checked against the catalogue rather than taken on trust. */}
          <span className="calc-tier" title={match ? serviceLabel(match.svc.name) : undefined}>
            {match ? serviceLabel(match.svc.name) : "—"}
          </span>
        </div>

        {/* Logarithmic slider: the track covers 0–1000 internal units, mapped through
            log₁₀ so every order of magnitude gets equal thumb travel. The filled portion
            is painted from the position since a range track cannot be split by CSS alone. */}
        <input
          type="range"
          className="calc-slider"
          min={0}
          max={1000}
          step={1}
          value={toSliderPos(calls)}
          onChange={e => setCalls(fromSliderPos(Number(e.target.value)))}
          style={{ ["--fill" as string]: `${(toSliderPos(calls) / 1000) * 100}%` }}
          aria-label="Number of calls"
        />
        <div className="calc-scale">
          <span>100</span><span>10k</span><span>1L</span><span>10L</span><span>1Cr</span><span>5Cr</span>
        </div>

        <div className="calc-total">
          <span className="calc-figure-label">Estimated cost</span>
          <strong>{match ? money(match.total) : "—"}</strong>
          <small>
            {match
              ? `${calls.toLocaleString("en-IN")} calls at ₹${match.rate.toFixed(2)} each`
              : services.length
                ? "No service covers a campaign this size yet."
                : "Loading current pricing…"}
          </small>
        </div>

        <p className="calc-note">
          {match
            ? `Priced from our "${serviceLabel(match.svc.name)}" service. Your exact total is shown before you confirm any order.`
            : "Your exact total is shown before you confirm any order."}
        </p>
      </div>
    </div>
  );
}

export default function Landing({ onSignIn, onSignUp }: {
  onSignIn: () => void;
  onSignUp: () => void;
}) {
  const [heroWordIndex, setHeroWordIndex] = useState(0);

  useEffect(() => {
    const rotation = window.setInterval(() => {
      setHeroWordIndex((current) => (current + 1) % HERO_WORDS.length);
    }, 1200);
    return () => window.clearInterval(rotation);
  }, []);

  const heroWord = HERO_WORDS[heroWordIndex];

  return (
    <main className="landing-page">
      <header className="landing-header">
        <div className="landing-header-inner">
          {/* The supplied artwork arrived on a cream ground; that ground has been made
              transparent and the file trimmed and resized, 768 KB down to 30 KB. Still light
              surfaces only - the mark is navy on navy against the dark sidebar. */}
          <Image
            className="landing-logo"
            src="/bulkshout-logo.png"
            alt="BulkShout - Say More. Reach Further."
            width={719}
            height={120}
            priority
          />
          {/* Both routes into the product sit together in the corner where a visitor looks
              for them, and repeat in the hero for anyone who scrolled straight past. */}
          <nav className="landing-nav">
            <button type="button" className="landing-link" onClick={onSignIn}>Sign in</button>
            <button type="button" className="landing-cta" onClick={onSignUp}>
              <span className="landing-cta-full">Create account</span>
              <span className="landing-cta-short">Create</span>
              <Icon name="arrow" size={15} />
            </button>
          </nav>
        </div>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-copy">
          <p className="eyebrow">IVR BROADCAST PANEL</p>
          <h1>
            Every{" "}
            <span className="hero-word-window" aria-live="polite">
              <span className="hero-word" key={heroWord}>{heroWord}</span>
            </span>,{" "}
            clear and under control.
          </h1>
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
          width={719}
          height={120}
        />
        <p>© {new Date().getFullYear()} BulkShout. IVR voice broadcast services.</p>
      </footer>
    </main>
  );
}
