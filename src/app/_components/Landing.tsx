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

/**
 * The differentiator, which is the whole pitch: most panels bill per number uploaded, this
 * one bills per call answered. It sits directly after the hero rather than further down,
 * because it is the reason to keep reading.
 */
/**
 * The three ways a call fails to connect, rotated through the proof heading.
 *
 * The verb rides inside each phrase rather than sitting in the sentence, because the third
 * state is a verb phrase: "a number IS UNREACHABLE" and "a number DOESN'T PICK UP" are both
 * grammatical, while a fixed "is" in the heading would leave "a number is doesn't pick up".
 */
const PROOF_STATES = ["IS SWITCHED-OFF", "IS UNREACHABLE", "DOESN’T PICK UP"];

const PROOF_POINTS = [
  "No wasted budget on dead numbers",
  "A campaign of 10,000 calls means 10,000 chances to reach someone — not 10,000 charges regardless of outcome",
  "Full transparency: your report shows exactly what connected, what didn’t, and what was refunded",
];

/** The two supporting claims, beside the one above. */
const SUPPORTING = [
  {
    icon: "file",
    title: "A report you can actually act on",
    text: "Every broadcast comes with a delivery report the moment it completes — connected calls, failed calls, refund amount, and campaign status, all in one place. No waiting, no follow-up emails needed.",
  },
  {
    icon: "wallet",
    title: "Zero setup fee, zero lock-in",
    text: "No setup charges. A prepaid wallet you top up only when you need to run a campaign, with no auto-deduction, no forced monthly minimums, and no expiry on your balance. Start with as few as 10 calls to test before scaling to lakhs.",
  },
];

/** The order flow, said plainly. Three steps because it genuinely is three. */
const STEPS = [
  { n: "1", title: "Top up your wallet", text: "Pay via UPI, submit the reference, and your balance is credited once it clears." },
  { n: "2", title: "Build your broadcast", text: "Pick a call duration, upload your recording or give us a script, and add your contact list — paste numbers directly or upload a file." },
  { n: "3", title: "We deliver, you track", text: "Your campaign runs automatically. Track it live as it moves from placed to in progress to completed, and download your report — with unanswered calls already refunded — the moment it’s done." },
];

/**
 * The questions people actually type into a search box.
 *
 * One array feeds both the visible list and the FAQPage structured data below it, so the
 * markup Google reads can never drift from the answers on the page - which is the thing that
 * gets rich snippets withdrawn.
 */
const FAQS = [
  {
    q: "Do I get charged for calls that don’t connect?",
    a: "No. BulkShout only charges for calls that are actually answered. Switched-off, unreachable, and unanswered calls are automatically refunded to your wallet as soon as the campaign completes — you don’t need to request anything.",
  },
  {
    q: "Is there a setup fee?",
    a: "No. There’s no setup fee and no hidden charges. You only pay per call, based on the service tier you choose.",
  },
  {
    q: "Can I use my own voice recording, or do you create one for me?",
    a: "Both. You can upload your own recording, or send us a script and we’ll create the voice recording for you at no extra cost.",
  },
  {
    q: "How fast will I get my refund for failed calls?",
    a: "Refunds for unconnected calls are credited to your wallet automatically the moment your campaign is marked complete — no waiting, no request needed.",
  },
  {
    q: "Do you offer both 15-second and 30-second call options?",
    a: "Yes. Choose a 15-second message for short offers and reminders, or a 30-second message when you need more room to explain your offer or invite customers to an event.",
  },
  {
    q: "Does my wallet balance expire?",
    a: "No. Your balance has lifetime validity — top up only when you need to run a campaign, with no forced monthly minimums or auto-deduction.",
  },
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
  categoryName?: string;
};

/** Strips the operator's internal prefix so a badge reads "500 Calls", not "Min: 500 Calls". */
function serviceLabel(name: string): string {
  return name.replace(/^\s*min[:.\s-]+/i, "").trim() || name;
}

function CallCalculator() {
  const [services, setServices] = useState<PricedService[]>([]);
  const [calls, setCalls] = useState(5000);
  const [calcMode, setCalcMode] = useState<"CALLS" | "SMS">("CALLS");
  const [pointerTilt, setPointerTilt] = useState({ x: 0, y: 0, rotateX: 0, rotateY: 0 });

  useEffect(() => {
    let alive = true;
    getCategoriesWithServices()
      .then(res => {
        if (!alive) return;
        const found: PricedService[] = [];
        const cats = (res.data || []) as Array<{ name?: string, services?: PricedService[] }>;
        for (const cat of cats) {
          for (const svc of cat.services || []) {
            // Flat-priced services are left out: a fixed fee per order cannot be scaled to an
            // arbitrary number of calls, so it has nothing to say on this slider.
            if (isQuantityPriced(svc)) {
              svc.categoryName = cat.name || "";
              found.push(svc);
            }
          }
        }
        setServices(found);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const match = useMemo(() => {
    let best: { svc: PricedService; cost: number } | null = null;
    for (const svc of services) {
      // Filter by the selected mode: SMS services for SMS, everything else for CALLS.
      const isSmsService = svc.categoryName?.toUpperCase().includes("SMS");
      if (calcMode === "SMS" && !isSmsService) continue;
      if (calcMode === "CALLS" && isSmsService) continue;

      const max = svc.max_quantity || Infinity;
      const min = svc.min_quantity || 1;
      if (calls >= min && calls <= max) {
        const cost = quoteTotal(svc, calls);
        if (!best || cost < best.cost) {
          best = { svc, cost };
        }
      }
    }
    return best;
  }, [services, calls, calcMode]);

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
    <div className="landing-hero-art" id="pricing">
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
            <span>{calcMode === 'SMS' ? 'SMS' : 'calls'}</span>
          </div>
          <div className="segmented tight calc-tier">
            <button type="button" className={calcMode === 'SMS' ? 'on' : ''} onClick={() => setCalcMode('SMS')}>SMS</button>
            <button type="button" className={calcMode === 'CALLS' ? 'on' : ''} onClick={() => setCalcMode('CALLS')}>CALLS</button>
          </div>
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
          aria-label={`Number of ${calcMode === 'SMS' ? 'SMS messages' : 'calls'}`}
        />
        <div className="calc-scale">
          <span>1</span><span>100</span><span>10k</span><span>1L</span><span>1Cr</span><span>5Cr</span>
        </div>

        <div className="calc-total">
          <span className="calc-figure-label">Estimated cost</span>
          {/* money(), not toFixed: this is the largest number on the card and toFixed drops
              the grouping, so a three-lakh estimate rendered as ₹300000.00 directly under a
              call count that still read 5,00,00,000. */}
          <strong className="amount">{match ? money(match.cost) : "—"}</strong>
          {match && <span className="rate-breakdown">{calls.toLocaleString("en-IN")} {calcMode === 'SMS' ? 'SMS' : 'calls'} at ₹{unitRate(match.svc).toFixed(2)} each</span>}
          {/* Only rendered when there is something to say. As an unconditional <small> it
              still took its display:block and margin, leaving a strip of dead space under
              every successful quote. */}
          {!match && (
            <small>
              {services.length
                ? "No service covers a campaign this size yet."
                : "Loading current pricing…"}
            </small>
          )}
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
  const [proofIndex, setProofIndex] = useState(0);

  useEffect(() => {
    const rotation = window.setInterval(() => {
      setProofIndex(current => (current + 1) % PROOF_STATES.length);
    }, 1800);
    return () => window.clearInterval(rotation);
  }, []);

  const proofState = PROOF_STATES[proofIndex];

  /** "See live pricing" takes the visitor to the estimator rather than to another page. */
  const showPricing = () => {
    document.getElementById("pricing")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  /**
   * wa.me accepts digits only - no +, spaces or dashes - and silently fails on anything else,
   * so an operator who types "+91 98765 43210" into Site settings would get a floating button
   * that goes nowhere. Stripped here rather than on save, so numbers already stored in any
   * format still work.
   */
  const waNumber = (whatsappNumber || "").replace(/\D/g, "");

  /**
   * FAQPage structured data, so the answers can surface as a rich result.
   *
   * Built from the same FAQS array the section below renders, because markup that claims an
   * answer the page does not show is what gets a rich snippet withdrawn - and hand-maintained
   * JSON-LD drifts from the copy the first time anyone edits a sentence.
   */
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map(item => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };

  return (
    <main className="landing-page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
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
          <p className="eyebrow">BULK VOICE CALL SERVICE — DELHI &amp; INDIA</p>
          <h1>Bulk voice calls that only charge you when someone actually answers</h1>
          <p className="landing-lede">
            BulkShout is a bulk voice call broadcasting service for businesses across Delhi and
            India. Reach thousands of customers with a single recorded message — and pay
            only for the calls that connect. Switched-off and unanswered numbers are refunded
            automatically, no request needed.
          </p>
          <div className="landing-hero-actions">
            <button type="button" className="landing-cta large" onClick={onSignUp}>
              Create your account <Icon name="arrow" size={16} />
            </button>
            <button type="button" className="landing-ghost" onClick={showPricing}>
              See live pricing
            </button>
          </div>
          <ul className="landing-points">
            <li><Icon name="check" size={15} /> No setup fee</li>
            <li><Icon name="check" size={15} /> Pay only for answered calls</li>
            <li><Icon name="check" size={15} /> Refund credited automatically</li>
            <li><Icon name="check" size={15} /> Free AI voice creation</li>
          </ul>
        </div>

        <CallCalculator />
      </section>

      {/* The differentiator, directly after the hero: it is the reason to keep reading, and
          burying it below the feature grid is what every competitor does. */}
      <section className="landing-section landing-proof">
        <div className="landing-proof-lead">
          <h2>
            You don’t pay when a number{" "}
            <span className="proof-word-window" aria-live="polite">
              <span className="proof-word" key={proofState}>{proofState}</span>
              <span className="proof-word-punct">.</span>
            </span>
          </h2>
          <p>
            Most bulk voice call providers in India charge you for every number you upload —
            connected or not. If half your contact list is switched off, unreachable, or
            doesn’t pick up, that’s still money out of your pocket with most panels.
          </p>
          <p>
            BulkShout works differently. <strong>We only charge for calls that are actually
            answered.</strong> Every call that doesn’t connect — switched off,
            unreachable, out of network, no answer — is automatically refunded to your
            wallet the moment your campaign finishes. You don’t have to raise a ticket,
            ask for a refund, or chase support. It just happens.
          </p>
          <ul className="landing-proof-list">
            {PROOF_POINTS.map(point => (
              <li key={point}><Icon name="check" size={16} /><span>{point}</span></li>
            ))}
          </ul>
        </div>

        <div className="landing-grid two">
          {SUPPORTING.map(c => (
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

      {/* Local intent: someone searching "bulk voice call service Delhi" is looking for a
          supplier who says Delhi back to them. */}
      <section className="landing-section landing-local">
        <h2>Bulk voice call service for businesses in Delhi</h2>
        <p>
          BulkShout helps businesses across Delhi and the NCR region — real estate
          developers, clinics, restaurants, retail stores, coaching institutes, and travel
          agencies — reach their customers through automated voice calls without hiring a
          calling team or managing complex software. Whether you’re announcing a new offer,
          sending appointment reminders, or inviting customers to a launch event, BulkShout
          handles script writing, voice creation, and campaign delivery — while making sure
          you’re never charged for a call that didn’t connect.
        </p>
      </section>

      <section className="landing-section landing-faq-section">
        <h2>Frequently asked questions</h2>
        <div className="landing-faq">
          {FAQS.map((item, i) => (
            /* <details> rather than a scripted accordion: it opens without JavaScript, is
               keyboard operable as it stands, and its closed text is still in the document
               for a crawler to read. The first is open so the section does not read as an
               unexplained row of bars. */
            <details key={item.q} className="landing-faq-item" open={i === 0}>
              <summary>{item.q}<Icon name="chevron" size={16} /></summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="landing-closer">
        <h2>Ready to send your first broadcast?</h2>
        <p>
          Create your account, top up whenever you’re ready, and pay only for the calls
          that actually reach someone. Nothing is charged until you place an order.
        </p>
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
          <nav className="legal-footer-nav">
            <a href="/terms">Terms and Conditions</a>
            <a href="/refund-policy">Refund Policy</a>
            <a href="/privacy-policy">Privacy Policy</a>
          </nav>
          <p>© {new Date().getFullYear()} BulkShout. All rights reserved.</p>
        </div>
      </footer>

      {waNumber && (
        <a 
          href={`https://wa.me/${waNumber}`}
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
