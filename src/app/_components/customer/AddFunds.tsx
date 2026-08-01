/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { FormEvent, useCallback, useEffect, useState } from "react";
import { Icon, Badge, Heading, PanelTop } from "@/app/_components/ui";
import { getPaymentMethod, getMyTopupRequests, submitTopupRequest } from "@/app/actions/topups";

const money = (value: any) => `₹${Number(value || 0).toFixed(2)}`;

/**
 * Customer wallet top-up: pay to a static UPI QR, then claim the payment with its UTR.
 * The wallet only moves once the backend (or an admin) has matched that UTR to a real
 * bank credit, so nothing here optimistically updates the balance.
 */
export default function AddFunds({
  balance,
  transactions,
  onCredited,
}: {
  balance: number;
  transactions: any[];
  onCredited: () => void;
}) {
  const [method, setMethod] = useState<any>(null);
  const [methodError, setMethodError] = useState("");
  const [loading, setLoading] = useState(true);

  const [requests, setRequests] = useState<any[]>([]);
  const [amount, setAmount] = useState("");
  const [utr, setUtr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [copied, setCopied] = useState(false);

  const loadRequests = useCallback(async () => {
    setRequests(await getMyTopupRequests());
  }, []);

  useEffect(() => {
    (async () => {
      const res = await getPaymentMethod();
      if (res?.error) setMethodError(res.error);
      if (res?.data) setMethod(res.data);
      await loadRequests();
      setLoading(false);
    })();
  }, [loadRequests]);

  const copyVpa = async () => {
    if (!method?.upi_vpa) return;
    try {
      await navigator.clipboard.writeText(method.upi_vpa);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Could not copy automatically — please select and copy the UPI ID manually.");
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSuccess("");

    const cleanedUtr = utr.replace(/[\s-]/g, "");
    if (!/^\d{12}$/.test(cleanedUtr)) {
      return setError("The UTR must be exactly 12 digits. Copy it from your UPI app's transaction details.");
    }
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return setError("Enter the amount you paid.");
    }

    setSubmitting(true);
    const formData = new FormData();
    formData.set("amount", String(numericAmount));
    formData.set("utr", cleanedUtr);

    const res = await submitTopupRequest(formData);
    setSubmitting(false);

    if (res?.error) return setError(res.error);

    setSuccess(res?.message || "Top-up submitted.");
    setAmount("");
    setUtr("");
    await loadRequests();
    // An auto-verified top-up credits immediately, so refresh the header balance.
    if (res?.status === "APPROVED") onCredited();
  };

  const pending = requests.filter((r) => r.status === "PENDING");

  return (
    <>
      <Heading eyebrow="WALLET" title="Add funds" text="Pay to our UPI QR, then submit the UTR to have your wallet credited." />

      <div className="dashboard-grid">
        <section className="panel balance-panel">
          <div className="balance-orb"><Icon name="indian-rupee" size={32} /></div>
          <p className="eyebrow">CURRENT BALANCE</p>
          <h2 className="balance-amount">{money(balance)}</h2>
          <p className="text-muted balance-note">
            Your wallet is debited the service price the moment a broadcast is created, and credited back
            automatically on cancellations and refunds.
          </p>
          {pending.length > 0 && (
            <div className="pending-strip">
              <Icon name="clock" size={15} />
              <span>
                {pending.length} top-up{pending.length > 1 ? "s" : ""} awaiting verification
                {" · "}{money(pending.reduce((sum, r) => sum + Number(r.amount || 0), 0))}
              </span>
            </div>
          )}
        </section>

        <aside className="panel pay-panel">
          <PanelTop title="Pay via UPI" text="Scan with any UPI app, then claim the payment below." />

          {loading ? (
            <div className="loading-block"><div className="loader" /></div>
          ) : !method || !method.is_enabled ? (
            <div className="detail-note">
              <strong>Top-ups are temporarily unavailable</strong>
              <p>{methodError || "Our payment method is being updated. Please raise a support ticket to add funds."}</p>
            </div>
          ) : (
            <div className="upi-box">
              {method.qr_url ? (
                <div className="qr-frame">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={method.qr_url} alt="UPI QR code for wallet top-up" />
                </div>
              ) : (
                <div className="qr-frame empty-qr"><Icon name="qr" size={36} /><small>QR unavailable</small></div>
              )}

              {method.upi_vpa && (
                <button type="button" className="vpa-chip" onClick={copyVpa}>
                  <span>
                    <small>UPI ID</small>
                    <strong>{method.upi_vpa}</strong>
                  </span>
                  <Icon name={copied ? "check" : "copy"} size={16} />
                </button>
              )}

              {method.upi_payee_name && <p className="payee-line">Payee: <strong>{method.upi_payee_name}</strong></p>}

              <p className="limit-line">
                Accepted amounts: {money(method.min_amount)} – {money(method.max_amount)}
              </p>
            </div>
          )}
        </aside>
      </div>

      {method?.is_enabled && (
        <section className="panel">
          <PanelTop title="Claim your payment" text="Enter exactly what you paid and the 12-digit UTR from your UPI app." />

          <div className="topup-layout">
            <ol className="topup-steps">
              <li><span>1</span><div><strong>Scan &amp; pay</strong><p>Open any UPI app, scan the QR, and pay the amount you want in your wallet.</p></div></li>
              <li><span>2</span><div><strong>Copy the UTR</strong><p>Open the completed payment in your UPI app and copy the 12-digit UTR / transaction reference.</p></div></li>
              <li><span>3</span><div><strong>Submit below</strong><p>We match the UTR against our bank statement and credit your wallet once it is confirmed.</p></div></li>
            </ol>

            <form className="admin-update boxed-form topup-form" onSubmit={submit}>
              <label>Amount paid (₹)
                <input
                  type="number"
                  step="0.01"
                  min={Number(method.min_amount)}
                  max={Number(method.max_amount)}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={String(Number(method.min_amount))}
                  required
                />
              </label>

              <label>12-digit UTR / transaction reference
                <input
                  className="mono"
                  inputMode="numeric"
                  maxLength={17}
                  value={utr}
                  onChange={(e) => setUtr(e.target.value)}
                  placeholder="e.g. 412345678901"
                  required
                />
              </label>

              {error && <div className="form-error">{error}</div>}
              {success && <div className="form-success">✓ {success}</div>}

              <button className="primary" disabled={submitting}>
                {submitting ? "Submitting…" : "Submit for verification"} <Icon name="arrow" size={16} />
              </button>

              <p className="fine-print">
                Submit a UTR only once. Repeated invalid submissions are rate limited and logged.
              </p>
            </form>
          </div>

          {method.instructions && (
            <div className="detail-note info instructions-note">
              <strong>How it works</strong>
              <p>{method.instructions}</p>
            </div>
          )}
        </section>
      )}

      <section className="panel data-panel">
        <PanelTop title="Your top-up requests" text="Status of every UTR you have submitted." />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Reference</th>
                <th>Submitted</th>
                <th>Amount</th>
                <th>UTR</th>
                <th>Status</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {requests.length ? requests.map((r) => (
                <tr key={r.id}>
                  <td className="sno-col"><strong>{r.reference_no}</strong></td>
                  <td className="muted-cell">{new Date(r.created_at).toLocaleString()}</td>
                  <td><strong className="amount">{money(r.amount)}</strong></td>
                  <td><code className="utr-cell">{r.utr_number}</code></td>
                  <td>
                    <Badge status={r.status === "PENDING" ? "Placed" : r.status === "APPROVED" ? "Completed" : "Cancelled"} />
                  </td>
                  <td className="muted-cell">{r.rejection_reason || r.admin_note || (r.status === "PENDING" ? "Awaiting verification" : "—")}</td>
                </tr>
              )) : (
                <tr><td colSpan={6} className="empty">You have not submitted any top-up requests yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel data-panel funds-history">
        <PanelTop title="Wallet transaction history" text="Every debit and credit on your wallet." />
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Date</th><th>Type</th><th>Amount</th><th>Reference</th><th>Status</th></tr>
            </thead>
            <tbody>
              {transactions?.length ? transactions.map((t: any) => (
                <tr key={t.id}>
                  <td className="muted-cell">{new Date(t.created_at).toLocaleString()}</td>
                  <td><span className={`txn-tag ${t.type === "CREDIT" ? "credit" : "debit"}`}>{t.type}</span></td>
                  <td><strong className="amount">{money(t.amount)}</strong></td>
                  <td className="muted-cell">{t.order_id || "-"}</td>
                  <td><Badge status={t.status === "SUCCESS" ? "Completed" : t.status} /></td>
                </tr>
              )) : (
                <tr><td colSpan={5} className="empty">No transactions found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
