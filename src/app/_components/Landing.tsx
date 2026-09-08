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
const CALLS_MIN = 1;
const CALLS_MAX = 50_000_000;
const HERO_WORDS = ["broadcast", "campaign", "order"];

/**
 * Logarithmic slider helpers.
 *
 * A linear slider across 1 → 5 crore is unusable: the first 50k occupies 0.1% of the track.
 * This piece-wise exponential scale ensures the thumb precisely aligns with the visible scale
 * labels while providing a smooth dragging experience through dynamic rounding.
 */
const SCALE_STOPS = [1, 100, 10_000, 100_000, 10_000_000, 50_000_000];

/** Slider position (0-1000) → actual call count. */
function fromSliderPos(pos: number): number {
  if (pos <= 0) return SCALE_STOPS[0];
  if (pos >= 1000) return SCALE_STOPS[SCALE_STOPS.length - 1];
  
  const segmentLen = 1000 / (SCALE_STOPS.length - 1);
  const segment = pos / segmentLen;
  const i = Math.floor(segment);
  const t = segment - i;
  
  const logVal = Math.log10(SCALE_STOPS[i]) * (1 - t) + Math.log10(SCALE_STOPS[i + 1]) * t;
  const val = Math.pow(10, logVal);
  
  // Dynamic rounding for a buttery smooth slider that doesn't jump
  if (val < 10) return Math.round(val);
  if (val < 100) return Math.round(val / 5) * 5;
  if (val < 1000) return Math.round(val / 10) * 10;
  if (val < 10000) return Math.round(val / 100) * 100;
  if (val < 100000) return Math.round(val / 1000) * 1000;
  if (val < 1000000) return Math.round(val / 10000) * 10000;
  return Math.round(val / 100000) * 100000;
}

/** Actual call count → slider position (0-1000). */
function toSliderPos(calls: number): number {
  if (calls <= SCALE_STOPS[0]) return 0;
  if (calls >= SCALE_STOPS[SCALE_STOPS.length - 1]) return 1000;
  
  const segmentLen = 1000 / (SCALE_STOPS.length - 1);
  for (let i = 0; i < SCALE_STOPS.length - 1; i++) {
    if (calls >= SCALE_STOPS[i] && calls <= SCALE_STOPS[i + 1]) {
      const logMin = Math.log10(SCALE_STOPS[i]);
      const logMax = Math.log10(SCALE_STOPS[i + 1]);
      const logVal = Math.log10(calls);
      const t = (logVal - logMin) / (logMax - logMin);
      return (i + t) * segmentLen;
    }
  }
  return 1000;
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
          <span className="calc-tier">CALLS</span>
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
          <span>1</span><span>100</span><span>10k</span><span>1L</span><span>1Cr</span><span>5Cr</span>
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

export default function Landing({ onSignIn, onSignUp, whatsappNumber }: {
  onSignIn: () => void;
  onSignUp: () => void;
  whatsappNumber?: string;
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
            {/* Fixed width, so the line does not reshuffle as the word changes - see
                .hero-word-window. The comma lives inside the window, immediately after the
                word, so it stays against it instead of holding a fixed spot to the right. */}
            <span className="hero-word-window" aria-live="polite">
              <span className="hero-word" key={heroWord}>{heroWord}</span>
              <span className="hero-word-punct">,</span>
            </span>{" "}
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
        <div className="landing-footer-inner">
          {/* The same mark as the header. A "-dark" variant was referenced here but never
              added to public/, so the footer requested a file that 404s and showed nothing
              at all. The footer sits on --surface (white), which is the light ground this
              artwork is already drawn for. */}
          <Image
            src="/bulkshout-logo.png"
            alt="BulkShout"
            width={719}
            height={120}
            className="landing-logo footer"
          />
          <p>© {new Date().getFullYear()} BulkShout. All rights reserved.</p>
        </div>
      </footer>

      {whatsappNumber && (
        <a 
          href={`https://wa.me/${whatsappNumber}`}
          target="_blank" 
          rel="noopener noreferrer" 
          className="whatsapp-widget"
          aria-label="Chat with us on WhatsApp"
        >
          <svg viewBox="0 0 24 24">
            <path d="M12.031 0C5.385 0 0 5.385 0 12.031c0 2.115.548 4.183 1.589 6.002L.15 23.473l5.584-1.464c1.761.946 3.754 1.445 5.797 1.445 6.646 0 12.031-5.385 12.031-12.031S17.677 0 12.031 0zm3.896 17.156c-.168.474-.972.898-1.428.948-.426.046-.983.078-1.571-.115-.357-.118-.841-.284-1.408-.553-2.4-1.139-3.957-3.606-4.077-3.766-.12-.161-.973-1.296-.973-2.469 0-1.174.61-1.751.826-1.986.216-.236.471-.295.628-.295.157 0 .315 0 .445.006.136.006.319-.052.498.38.183.441.628 1.536.684 1.649.056.113.094.246.015.403-.078.158-.118.256-.235.394-.118.138-.246.291-.354.403-.118.125-.241.263-.105.498.138.236.612 1.009 1.314 1.636.905.807 1.666 1.056 1.902 1.168.236.113.376.094.517-.066.142-.161.611-.711.776-.956.166-.245.332-.204.549-.125.216.08 1.375.648 1.611.766.236.118.393.177.45.275.059.098.059.57-.109 1.044z" />
          </svg>
        </a>
      )}
    </main>
  );
}
