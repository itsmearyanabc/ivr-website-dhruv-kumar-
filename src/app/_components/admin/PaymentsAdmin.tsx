/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { FormEvent, useCallback, useEffect, useState } from "react";
import { Icon, Badge, Heading, PanelTop } from "@/app/_components/ui";
import { TabStrip } from "@/app/_components/admin/AdminShell";
import {
  getAllTopupRequests,
  approveTopupRequest,
  rejectTopupRequest,
  recheckTopupRequest,
  getPaymentMethodAdmin,
  updatePaymentMethod,
} from "@/app/actions/topups";
import { updatePricePerCall } from "@/app/actions/settings";

const money = (value: any) => `₹${Number(value || 0).toFixed(2)}`;

const VERIFICATION_LABEL: Record<string, string> = {
  NOT_CHECKED: "Manual check",
  MATCHED: "Bank matched",
  AMOUNT_MISMATCH: "Amount mismatch",
  NOT_FOUND: "Not found",
  ERROR: "Lookup failed",
};

const VERIFICATION_TONE: Record<string, string> = {
  NOT_CHECKED: "neutral",
  MATCHED: "good",
  AMOUNT_MISMATCH: "bad",
  NOT_FOUND: "bad",
  ERROR: "warn",
};

// =========================================================================================
// Top-up request queue
// =========================================================================================

const TOPUP_TABS: Array<[string, (r: any) => boolean]> = [
  ["Pending", (r) => r.status === "PENDING"],
  ["Approved", (r) => r.status === "APPROVED"],
  ["Rejected", (r) => r.status === "REJECTED"],
  ["All", () => true],
];

export function TopupRequestsView({ onCredited }: { onCredited?: () => void }) {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("Pending");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [flash, setFlash] = useState("");

  const load = useCallback(async () => {
    setRequests(await getAllTopupRequests());
    setLoading(false);
  }, []);

  const refresh = async () => {
    setLoading(true);
    await load();
  };

  useEffect(() => {
    (async () => {
      setRequests(await getAllTopupRequests());
      setLoading(false);
    })();
  }, []);

  const notify = (msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(""), 5000);
  };

  const activeTab = TOPUP_TABS.find(([label]) => label === tab) || TOPUP_TABS[0];
  let visible = requests.filter(activeTab[1]);

  if (search.trim()) {
    const term = search.trim().toLowerCase();
    visible = visible.filter((r) =>
      r.utr_number?.includes(term) ||
      r.reference_no?.toLowerCase().includes(term) ||
      r.customer?.toLowerCase().includes(term) ||
      r.email?.toLowerCase().includes(term),
    );
  }

  const pendingValue = requests
    .filter((r) => r.status === "PENDING")
    .reduce((sum, r) => sum + Number(r.amount || 0), 0);

  const creditedToday = requests
    .filter((r) => r.status === "APPROVED" && r.reviewed_at && new Date(r.reviewed_at).toDateString() === new Date().toDateString())
    .reduce((sum, r) => sum + Number(r.credited_amount || r.amount || 0), 0);

  return (
    <>
      <Heading
        eyebrow="PAYMENTS"
        title="Wallet top-up requests"
        text="Match each UTR against your bank statement before crediting a wallet."
      />

      {flash && <div className="flash-success">✓ {flash}</div>}

      <div className="metric-grid three">
        <article className="metric panel">
          <div className="metric-icon orange"><Icon name="clock" size={20} /></div>
          <div className="metric-body">
            <p>Awaiting verification</p>
            <h2>{requests.filter((r) => r.status === "PENDING").length}</h2>
            <small className="warning-text">{money(pendingValue)} in the queue</small>
          </div>
        </article>
        <article className="metric panel">
          <div className="metric-icon green"><Icon name="check" size={20} /></div>
          <div className="metric-body">
            <p>Credited today</p>
            <h2>{money(creditedToday)}</h2>
            <small className="success-text">Approved in the last 24 hours</small>
          </div>
        </article>
        <article className="metric panel">
          <div className="metric-icon red"><Icon name="shield" size={20} /></div>
          <div className="metric-body">
            <p>Rejected all time</p>
            <h2>{requests.filter((r) => r.status === "REJECTED").length}</h2>
            <small>Unverified or duplicate claims</small>
          </div>
        </article>
      </div>

      <section className="panel data-panel">
        <div className="table-tools">
          <div className="search">
            <Icon name="search" size={16} />
            <input
              placeholder="Search UTR, reference, or customer"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button className="outline small" onClick={refresh}>
            <Icon name="refresh" size={14} /> Refresh
          </button>
        </div>

        <div className="status-tabs">
          {TOPUP_TABS.map(([label, match]) => (
            <button
              key={label}
              className={`status-tab ${tab === label ? "on" : ""}`}
              onClick={() => setTab(label)}
            >
              {label}
              <span className="status-tab-count">{requests.filter(match).length}</span>
            </button>
          ))}
        </div>

        <div className="table-wrap">
          {loading ? (
            <div className="loading-block"><div className="loader" /></div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Submitted</th>
                  <th>Customer</th>
                  <th>Amount</th>
                  <th>UTR</th>
                  <th>Verification</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {visible.length ? visible.map((r) => (
                  <tr key={r.id}>
                    <td className="sno-col"><strong>{r.reference_no}</strong></td>
                    <td className="muted-cell">{new Date(r.created_at).toLocaleString()}</td>
                    <td>
                      <strong>{r.customer}</strong>
                      <div className="service-line">{r.email}</div>
                    </td>
                    <td><strong className="amount">{money(r.amount)}</strong></td>
                    <td><code className="utr-cell">{r.utr_number}</code></td>
                    <td>
                      <span className={`verify-tag ${VERIFICATION_TONE[r.verification_state] || "neutral"}`}>
                        {VERIFICATION_LABEL[r.verification_state] || r.verification_state}
                      </span>
                    </td>
                    <td><Badge status={r.status === "PENDING" ? "Placed" : r.status === "APPROVED" ? "Completed" : "Cancelled"} /></td>
                    <td>
                      <button className="outline small" onClick={() => setSelected(r)}>
                        {r.status === "PENDING" ? "Review" : "View"}
                      </button>
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={8} className="empty">No {tab.toLowerCase()} top-up requests.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {selected && (
        <TopupReviewModal
          request={selected}
          onClose={() => setSelected(null)}
          onDone={(msg) => {
            setSelected(null);
            notify(msg);
            load();
            onCredited?.();
          }}
        />
      )}
    </>
  );
}

function TopupReviewModal({
  request,
  onClose,
  onDone,
}: {
  request: any;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState<"idle" | "approving" | "rejecting">("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isPending = request.status === "PENDING";

  const approve = async () => {
    setBusy(true);
    setError("");
    const res = await approveTopupRequest(request.id, note);
    setBusy(false);
    if (res?.error) return setError(res.error);
    onDone(`${money(request.amount)} credited to ${request.customer}.`);
  };

  const reject = async () => {
    if (!reason.trim()) return setError("Enter a reason so the customer knows what went wrong.");
    setBusy(true);
    setError("");
    const res = await rejectTopupRequest(request.id, reason);
    setBusy(false);
    if (res?.error) return setError(res.error);
    onDone(`Request ${request.reference_no} rejected.`);
  };

  const recheck = async () => {
    setBusy(true);
    setError("");
    const res = await recheckTopupRequest(request.id);
    setBusy(false);
    if (res?.error) return setError(res.error);
    onDone(`Re-checked ${request.reference_no}: ${res?.note}`);
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal compact-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <p className="eyebrow">TOP-UP {request.reference_no}</p>
            <h2>{money(request.amount)}</h2>
            <p>{request.customer} · {request.email}</p>
          </div>
          <button className="close" onClick={onClose}><Icon name="close" /></button>
        </div>

        <div className="utr-callout">
          <span className="eyebrow">UTR SUBMITTED BY CUSTOMER</span>
          <strong>{request.utr_number}</strong>
          <p>Find this reference in your bank statement and confirm the credit is {money(request.amount)}.</p>
        </div>

        <div className="detail-grid">
          <div><small>Status</small><Badge status={request.status === "PENDING" ? "Placed" : request.status === "APPROVED" ? "Completed" : "Cancelled"} /></div>
          <div><small>Submitted</small><strong>{new Date(request.created_at).toLocaleString()}</strong></div>
          <div><small>Wallet balance now</small><strong className="amount">{money(request.customer_balance)}</strong></div>
          <div>
            <small>Automated check</small>
            <span className={`verify-tag ${VERIFICATION_TONE[request.verification_state] || "neutral"}`}>
              {VERIFICATION_LABEL[request.verification_state] || request.verification_state}
            </span>
          </div>
        </div>

        {request.verification_note && (
          <div className="detail-note info">
            <strong>Verification result</strong>
            <p>{request.verification_note}</p>
          </div>
        )}

        {request.rejection_reason && (
          <div className="detail-note">
            <strong>Rejection reason</strong>
            <p>{request.rejection_reason}</p>
          </div>
        )}

        {request.admin_note && (
          <div className="detail-note info">
            <strong>Admin note</strong>
            <p>{request.admin_note}</p>
          </div>
        )}

        {error && <div className="form-error">{error}</div>}

        {isPending && mode === "idle" && (
          <div className="review-actions">
            <button className="primary" onClick={() => setMode("approving")}>
              <Icon name="check" size={16} /> Approve &amp; credit {money(request.amount)}
            </button>
            <button className="outline danger" onClick={() => setMode("rejecting")}>
              <Icon name="ban" size={16} /> Reject
            </button>
            {request.verification_mode !== "MANUAL" && (
              <button className="outline" onClick={recheck} disabled={busy}>
                <Icon name="refresh" size={14} /> Re-check bank
              </button>
            )}
          </div>
        )}

        {isPending && mode === "approving" && (
          <div className="confirm-box">
            <h4>Confirm wallet credit</h4>
            <p>
              This adds <strong>{money(request.amount)}</strong> to <strong>{request.customer}</strong>&apos;s wallet
              immediately and cannot be undone from this screen.
            </p>
            <label>Note (optional, stored on the request)
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Verified against HDFC statement" />
            </label>
            <div className="confirm-actions">
              <button className="outline" onClick={() => setMode("idle")} disabled={busy}>Back</button>
              <button className="primary" onClick={approve} disabled={busy}>
                {busy ? "Crediting…" : `Yes, credit ${money(request.amount)}`}
              </button>
            </div>
          </div>
        )}

        {isPending && mode === "rejecting" && (
          <div className="confirm-box">
            <h4>Reject this top-up</h4>
            <p>The customer sees this reason. Rejecting frees the UTR so a genuine typo can be resubmitted.</p>
            <label>Reason
              <textarea
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. No credit found against this UTR in our bank statement."
              />
            </label>
            <div className="confirm-actions">
              <button className="outline" onClick={() => setMode("idle")} disabled={busy}>Back</button>
              <button className="primary" onClick={reject} disabled={busy}>
                {busy ? "Rejecting…" : "Confirm rejection"}
              </button>
            </div>
          </div>
        )}

        <div className="modal-footer"><button className="outline" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

// =========================================================================================
// Settings (General / Payment methods)
// =========================================================================================

export function AdminSettingsView({
  tab,
  onTabChange,
  price,
  onPriceSaved,
  stats,
}: {
  tab: string;
  onTabChange: (tab: string) => void;
  price: string;
  onPriceSaved: (price: string) => void;
  stats: { users: number; broadcasts: number; tickets: number };
}) {
  const active = tab === "payments" ? "payments" : "general";

  return (
    <>
      <Heading eyebrow="CONTROL PANEL" title="Settings" text="Configure how the panel and its payments behave." />
      <TabStrip
        tabs={[
          { key: "general", label: "General" },
          { key: "payments", label: "Payment methods" },
        ]}
        active={active}
        onChange={onTabChange}
      />
      {active === "general"
        ? <GeneralSettings price={price} onPriceSaved={onPriceSaved} stats={stats} />
        : <PaymentMethodSettings />}
    </>
  );
}

function GeneralSettings({
  price,
  onPriceSaved,
  stats,
}: {
  price: string;
  onPriceSaved: (price: string) => void;
  stats: { users: number; broadcasts: number; tickets: number };
}) {
  // Track which incoming price the local edit belongs to, so a refresh from the server
  // reflows into the field without an effect writing state on every render pass.
  const [edit, setEdit] = useState<{ base: string; value: string } | null>(null);
  const localPrice = edit?.base === price ? edit.value : price;
  const setLocalPrice = (value: string) => setEdit({ base: price, value });

  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState("");
  const [error, setError] = useState("");

  const save = async () => {
    setSaving(true);
    setError("");
    const res = await updatePricePerCall(localPrice);
    setSaving(false);
    if (res?.error) return setError(res.error);
    onPriceSaved(localPrice);
    setFlash("Pricing updated.");
    setTimeout(() => setFlash(""), 4000);
  };

  return (
    <>
      {flash && <div className="flash-success">✓ {flash}</div>}
      <div className="dashboard-grid">
        <section className="panel">
          <PanelTop title="Call pricing" text="Fallback per-call rate used when a service has no fixed price." />
          <div className="admin-update boxed-form">
            <label>Price per call (₹)
              <input type="number" step="0.01" value={localPrice} onChange={(e) => setLocalPrice(e.target.value)} />
            </label>
            {error && <div className="form-error">{error}</div>}
            <button className="primary" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save pricing"}
            </button>
          </div>
        </section>

        <aside className="panel">
          <PanelTop title="Panel information" text="A snapshot of what this deployment is running." />
          <div className="info-list">
            <div><span>Registered customers</span><strong>{stats.users}</strong></div>
            <div><span>Broadcasts all time</span><strong>{stats.broadcasts}</strong></div>
            <div><span>Support tickets</span><strong>{stats.tickets}</strong></div>
            <div><span>Wallet currency</span><strong>INR (₹)</strong></div>
          </div>
        </aside>
      </div>
    </>
  );
}

function PaymentMethodSettings() {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [qrFile, setQrFile] = useState<File | null>(null);

  // Controlled fields so the enable/mode interlocks can be reflected live.
  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState("MANUAL");
  const [autoCredit, setAutoCredit] = useState(false);

  const load = useCallback(async () => {
    const res = await getPaymentMethodAdmin();
    if (res?.error) setError(res.error);
    if (res?.data) {
      setConfig(res.data);
      setEnabled(Boolean(res.data.is_enabled));
      setMode(res.data.verification_mode || "MANUAL");
      setAutoCredit(Boolean(res.data.auto_credit_on_match));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => { await load(); })();
  }, [load]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");

    const formData = new FormData(event.currentTarget);
    formData.set("is_enabled", String(enabled));
    formData.set("verification_mode", mode);
    formData.set("auto_credit_on_match", String(autoCredit));
    if (qrFile) formData.set("qr_image", qrFile);

    const res = await updatePaymentMethod(formData);
    setSaving(false);

    if (res?.error) return setError(res.error);
    setQrFile(null);
    setFlash("Payment settings saved.");
    setTimeout(() => setFlash(""), 4000);
    load();
  };

  if (loading) return <div className="loading-block"><div className="loader" /></div>;
  if (!config) return <div className="form-error">{error || "Payment method configuration is unavailable."}</div>;

  return (
    <>
      {flash && <div className="flash-success">✓ {flash}</div>}

      <div className="method-status panel">
        <span className={`method-dot ${enabled ? "on" : ""}`} />
        <div>
          <strong>{enabled ? "UPI top-ups are live" : "UPI top-ups are switched off"}</strong>
          <p>
            {enabled
              ? "Customers can see the QR and submit a UTR from the Add funds screen."
              : "Customers see a message asking them to contact support. Fill in the UPI ID and QR, then enable."}
          </p>
        </div>
        <label className="switch">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span />
        </label>
      </div>

      <form onSubmit={save}>
        <div className="dashboard-grid">
          <section className="panel">
            <PanelTop title="Collection account" text="Where customer payments land. Shown on the top-up screen." />
            <div className="admin-update boxed-form">
              <label>UPI ID (VPA)
                <input name="upi_vpa" defaultValue={config.upi_vpa || ""} placeholder="business@okhdfcbank" />
              </label>
              <label>Payee name
                <input name="upi_payee_name" defaultValue={config.upi_payee_name || ""} placeholder="Xpack Media" />
              </label>
              <label>Static QR image
                <span className="dropzone">
                  {qrFile ? (
                    <><Icon name="check" /><b>{qrFile.name}</b><small>Ready to upload</small></>
                  ) : config.qr_image_key ? (
                    <><Icon name="qr" /><b>Replace current QR</b><small>A QR is already configured</small></>
                  ) : (
                    <><Icon name="upload" /><b>Upload QR image</b><small>PNG or JPG, up to 4 MB</small></>
                  )}
                  <input type="file" accept="image/*" onChange={(e) => setQrFile(e.target.files?.[0] || null)} />
                </span>
              </label>

              {config.qr_url && (
                <div className="qr-preview">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={config.qr_url} alt="Configured UPI QR code" />
                  <small>Current QR shown to customers</small>
                </div>
              )}
            </div>
          </section>

          <section className="panel">
            <PanelTop title="Limits and instructions" text="Bounds every top-up request is validated against." />
            <div className="admin-update boxed-form">
              <div className="form-grid">
                <label>Minimum amount (₹)
                  <input name="min_amount" type="number" step="1" min="1" defaultValue={Number(config.min_amount)} required />
                </label>
                <label>Maximum amount (₹)
                  <input name="max_amount" type="number" step="1" min="1" defaultValue={Number(config.max_amount)} required />
                </label>
              </div>
              <label>Instructions shown to the customer
                <textarea name="instructions" rows={4} defaultValue={config.instructions || ""} />
              </label>
            </div>
          </section>
        </div>

        <section className="panel">
          <PanelTop title="UTR verification" text="How a submitted UTR is checked before the wallet is credited." />
          <div className="admin-update boxed-form">
            <div className="mode-picker">
              <button
                type="button"
                className={`mode-option ${mode === "MANUAL" ? "on" : ""}`}
                onClick={() => { setMode("MANUAL"); setAutoCredit(false); }}
              >
                <Icon name="shield" size={18} />
                <strong>Manual review</strong>
                <small>Every UTR is checked by an admin against the bank statement before crediting. No external account needed.</small>
              </button>
              <button
                type="button"
                className={`mode-option ${mode === "DECENTRO" ? "on" : ""}`}
                onClick={() => setMode("DECENTRO")}
              >
                <Icon name="activity" size={18} />
                <strong>Decentro bank lookup</strong>
                <small>The backend queries your bank statement API for the UTR and amount. Requires DECENTRO_* server credentials.</small>
              </button>
            </div>

            {mode === "DECENTRO" && !config.verifier_configured && (
              <div className="form-error">
                Decentro credentials are not present on the server. Set DECENTRO_CLIENT_ID, DECENTRO_CLIENT_SECRET,
                DECENTRO_MODULE_SECRET, DECENTRO_BASE_URL and DECENTRO_ACCOUNT_NUMBER before saving this mode.
              </div>
            )}

            {mode === "DECENTRO" && (
              <label className="toggle-row">
                Automatically credit the wallet when the bank confirms an exact amount match
                <input type="checkbox" checked={autoCredit} onChange={(e) => setAutoCredit(e.target.checked)} />
              </label>
            )}

            <div className="detail-note info">
              <strong>Why credentials are not on this screen</strong>
              <p>
                This configuration is readable by every signed-in customer so their top-up screen can render the QR.
                API keys therefore live only in server environment variables and are never stored in the database.
              </p>
            </div>

            {error && <div className="form-error">{error}</div>}

            <button className="primary" disabled={saving}>
              {saving ? "Saving…" : "Save payment settings"}
            </button>
          </div>
        </section>
      </form>
    </>
  );
}
