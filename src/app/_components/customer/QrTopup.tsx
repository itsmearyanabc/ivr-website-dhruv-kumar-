"use client";

/**
 * Paying into the wallet with a per-payment Paytm QR.
 *
 * Nothing here decides whether money arrived. The QR is made on the server for the amount
 * entered, and this screen only keeps asking the server to check it with Paytm. The order is
 * remembered in this browser, so a customer who pays and then reloads still gets their credit.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/app/_components/ui";
import { sanitiseDecimalInput } from "@/lib/decimalInput";
import { startQrTopup, checkQrTopup } from "@/app/actions/paytmQr";

type Order = {
  token: string;
  orderId: string;
  amount: number;
  vpa: string;
  uri: string;
  qrDataUrl: string;
  expiresAt: number;
};
type Phase = "idle" | "waiting" | "expired" | "done";
type Outcome = { kind: "success" | "info"; text: string };
type CheckResponse = Awaited<ReturnType<typeof checkQrTopup>>;

const STORAGE_KEY = "bulkshout_qr_order";
const POLL_MS = 5000;
const money = (value: number) => `₹${value.toFixed(2)}`;

function loadOrder(): Order | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Order) : null;
  } catch {
    return null;
  }
}

function saveOrder(order: Order | null) {
  try {
    if (order) localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage blocked: the order simply is not remembered across a reload */
  }
}

export default function QrTopup({ min, max, onSettled }: {
  min: number;
  max: number;
  /** Refresh the balance and the request list once an order is credited or recorded. */
  onSettled: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [order, setOrder] = useState<Order | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const checking = useRef(false);

  const finish = useCallback((next: Phase) => {
    saveOrder(null);
    setOrder(null);
    setPhase(next);
  }, []);

  const apply = useCallback((current: Order, res: CheckResponse, manual: boolean) => {
    if ("error" in res && res.error) {
      setError(res.error);
      finish("idle");
      return;
    }
    if (!("status" in res)) return;

    if (res.status === "CREDITED") {
      setOutcome({ kind: "success", text: `${money(res.amount)} added to your wallet.` });
      finish("done");
      onSettled();
    } else if (res.status === "REVIEW") {
      setOutcome({ kind: "info", text: res.message });
      finish("done");
      onSettled();
    } else if (res.status === "EXPIRED") {
      setError("This QR is more than a day old. If you paid it and were not credited, submit the UTR in the form below.");
      finish("idle");
    } else {
      // Still waiting. On a resumed order this is what puts the QR back on screen.
      setOrder(current);
      setPhase(Date.now() > current.expiresAt ? "expired" : "waiting");
      if (manual) setHint("Paytm has not confirmed it yet. It usually shows up a few seconds after you pay.");
    }
  }, [finish, onSettled]);

  const check = useCallback(async (current: Order, manual = false) => {
    if (checking.current) return;
    checking.current = true;
    if (manual) { setBusy(true); setHint(""); }
    try {
      apply(current, await checkQrTopup(current.token), manual);
    } catch {
      if (manual) setHint("Could not reach the server. Check your connection and try again.");
    } finally {
      checking.current = false;
      if (manual) setBusy(false);
    }
  }, [apply]);

  // An order left open in this browser - the customer paid and reloaded, or came back later -
  // is checked straight away, so the screen opens on the real answer.
  useEffect(() => {
    const saved = loadOrder();
    if (!saved) return;
    let alive = true;
    checkQrTopup(saved.token)
      .then((res) => { if (alive) apply(saved, res, false); })
      .catch(() => { /* unreachable server: the customer can make a new QR or use the UTR form */ });
    return () => { alive = false; };
  }, [apply]);

  // While a QR is on screen, keep asking, and ask again the moment the tab comes back into view
  // (the customer usually leaves it to open their UPI app).
  useEffect(() => {
    if (phase !== "waiting" || !order) return;
    const poll = setInterval(() => void check(order), POLL_MS);
    const clock = setInterval(() => {
      setNow(Date.now());
      if (Date.now() > order.expiresAt) setPhase("expired");
    }, 1000);
    const onVisible = () => { if (document.visibilityState === "visible") void check(order); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [phase, order, check]);

  const start = async () => {
    setError("");
    setHint("");
    setOutcome(null);

    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return setError("Enter the amount you want to add.");
    if (value < min) return setError(`The smallest top-up is ${money(min)}.`);
    if (value > max) return setError(`The largest top-up is ${money(max)}.`);

    setBusy(true);
    const res = await startQrTopup(value);
    setBusy(false);

    if ("error" in res && res.error) return setError(res.error);

    const { token, orderId, amount: toPay, vpa, uri, qrDataUrl, expiresAt } = res as Partial<Order>;
    if (!token || !orderId || !vpa || !uri || !qrDataUrl || toPay == null || expiresAt == null) {
      return setError("Could not make the QR. Please try again.");
    }

    const next: Order = { token, orderId, amount: toPay, vpa, uri, qrDataUrl, expiresAt };
    saveOrder(next);
    setOrder(next);
    setNow(Date.now());
    setPhase("waiting");
  };

  const startOver = () => {
    if (phase === "waiting" && !window.confirm(
      "Only start over if you have NOT paid this QR. A payment to it is credited only while this page keeps checking it.",
    )) return;
    setError("");
    setHint("");
    finish("idle");
  };

  if (phase === "done" && outcome) {
    return (
      <div className="qr-live">
        {outcome.kind === "success"
          ? <div className="form-success">✓ {outcome.text}</div>
          : <div className="detail-note info"><p>{outcome.text}</p></div>}
        <button className="primary" type="button" onClick={() => { setOutcome(null); setAmount(""); setPhase("idle"); }}>
          Add more money <Icon name="arrow" size={16} />
        </button>
      </div>
    );
  }

  if ((phase === "waiting" || phase === "expired") && order) {
    const left = Math.max(0, order.expiresAt - now);
    const clock = `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}`;

    return (
      <div className="qr-live">
        <p className="qr-amount">Pay {money(order.amount)}</p>
        <div className={`qr-frame${phase === "expired" ? " is-expired" : ""}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={order.qrDataUrl} alt={`UPI QR code to pay ${money(order.amount)}`} />
        </div>
        <p className="qr-to">to <strong>{order.vpa}</strong></p>
        <a className="outline qr-app-link" href={order.uri}>Open in UPI app</a>

        {phase === "waiting" ? (
          <p className="qr-status" role="status">
            <span className="qr-pulse" aria-hidden="true" />
            Waiting for your payment. This page checks with Paytm automatically · QR valid for {clock}
          </p>
        ) : (
          <p className="qr-status" role="status">
            This QR has expired. Already paid it? Press Check again &mdash; payments are credited for up to 24 hours.
          </p>
        )}

        {error && <div className="form-error">{error}</div>}
        {hint && <p className="field-hint">{hint}</p>}

        <div className="qr-actions">
          <button type="button" className="primary" onClick={() => void check(order, true)} disabled={busy}>
            {busy ? "Checking…" : phase === "expired" ? "Check again" : "I have paid — check now"}
          </button>
          <button type="button" className="outline" onClick={startOver} disabled={busy}>
            {phase === "expired" ? "Make a new QR" : "Use a different amount"}
          </button>
        </div>
        <p className="fine-print">Order {order.orderId} · pay this QR once, for the amount shown.</p>
      </div>
    );
  }

  return (
    <div className="paytm-box">
      <label>
        Amount to add (₹)
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(sanitiseDecimalInput(e.target.value))}
          placeholder={String(min)}
          disabled={busy}
        />
      </label>

      {error && <div className="form-error">{error}</div>}

      <button className="primary" type="button" onClick={start} disabled={busy}>
        {busy ? "Making your QR…" : "Show QR to pay"} <Icon name="arrow" size={16} />
      </button>

      <p className="field-hint">
        You get a QR for exactly this amount. Pay it with any UPI app and your wallet is credited
        automatically &mdash; no UTR to enter. Accepted: {money(min)} &ndash; {money(max)}.
      </p>
    </div>
  );
}
