"use client";

/**
 * Paying into the wallet through Paytm.
 *
 * Nothing here decides whether money arrived. The button opens Paytm's checkout, and when it
 * closes the server is asked to settle the order - which it does by querying Paytm directly.
 * That is why the "payment cancelled" path still settles: a customer who closes the window
 * after paying must still get their credit, and only Paytm can say which happened.
 */

import { useEffect, useState } from "react";
import { Icon } from "@/app/_components/ui";
import { startPaytmTopup, settlePaytmOrder } from "@/app/actions/paytm";

type Checkout = {
  init: (config: Record<string, unknown>) => Promise<void>;
  invoke: () => void;
};
declare global {
  interface Window { Paytm?: { CheckoutJS?: Checkout & { onLoad: (cb: () => void) => void } } }
}

export default function PaytmTopup({ mid, isProduction, min, max, onCredited }: {
  mid: string;
  isProduction: boolean;
  min: number;
  max: number;
  onCredited: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Paytm serve the checkout from the host the merchant belongs to, and the file is named
  // after the MID, so this URL cannot be a constant.
  useEffect(() => {
    const host = isProduction ? "https://securegw.paytm.in" : "https://securegw-stage.paytm.in";
    const src = `${host}/merchantpgpui/checkoutjs/merchants/${mid}.js`;
    if (document.querySelector(`script[src="${src}"]`)) return;
    const tag = document.createElement("script");
    tag.src = src;
    tag.async = true;
    document.body.appendChild(tag);
  }, [mid, isProduction]);

  const settle = async (orderId: string) => {
    const res = await settlePaytmOrder(orderId);
    setBusy(false);
    if ("error" in res && res.error) return setError(res.error);
    if (!("status" in res)) return;

    if (res.status === "APPROVED") {
      setNotice(`₹${Number(res.amount).toFixed(2)} added to your wallet.`);
      setAmount("");
      onCredited();
    } else if (res.status === "PENDING") {
      setNotice(res.message ?? "Paytm has not confirmed this payment yet.");
    } else {
      setError(res.message ?? "That payment did not go through.");
    }
  };

  const pay = async () => {
    setError("");
    setNotice("");

    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return setError("Enter the amount you want to add.");
    if (value < min) return setError(`The minimum top-up is ₹${min}.`);
    if (value > max) return setError(`The maximum top-up is ₹${max.toLocaleString("en-IN")}.`);

    setBusy(true);
    const started = await startPaytmTopup(value);
    if ("error" in started && started.error) { setBusy(false); return setError(started.error); }
    if (!("txnToken" in started) || !started.txnToken) { setBusy(false); return setError("Could not start the payment."); }

    const checkout = window.Paytm?.CheckoutJS;
    if (!checkout) { setBusy(false); return setError("The payment window could not load. Check any ad blocker and try again."); }

    try {
      await checkout.init({
        root: "",
        flow: "DEFAULT",
        data: {
          orderId: started.orderId,
          token: started.txnToken,
          tokenType: "TXN_TOKEN",
          amount: String(started.amount),
        },
        handler: {
          // Both paths settle. A customer who pays and then closes the window has still paid,
          // and the server asking Paytm is the only way to know.
          notifyMerchant: (eventName: string) => {
            if (eventName === "APP_CLOSED" || eventName === "SESSION_EXPIRED") settle(started.orderId!);
          },
          transactionStatus: () => settle(started.orderId!),
        },
      });
      checkout.invoke();
    } catch {
      setBusy(false);
      setError("The payment window could not open. Please try again.");
    }
  };

  return (
    <div className="paytm-box">
      <label>
        Amount to add
        <input
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder={String(min)}
          disabled={busy}
        />
      </label>

      {error && <div className="form-error">{error}</div>}
      {notice && <div className="form-success">✓ {notice}</div>}

      <button className="primary" type="button" onClick={pay} disabled={busy}>
        {busy ? "Opening payment…" : "Pay by card, UPI or netbanking"} <Icon name="arrow" size={16} />
      </button>

      <p className="field-hint">
        Your wallet is credited as soon as the payment succeeds &mdash; there is nothing to
        submit and nothing to wait for.
        {!isProduction && " (Test mode: no real money is charged.)"}
      </p>
    </div>
  );
}
