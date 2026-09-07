"use client";

/**
 * Staff directory, for the owner of the console.
 *
 * A staff member operates the panel exactly as the owner does. The one thing they are refused
 * is the activity log - the record of what they did - and this screen, which is how their
 * access is granted and taken away.
 *
 * Every action here is refused server-side for anyone but the owner, so nothing on this page
 * is load-bearing for security. It is the interface to those actions, not the gate.
 */

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/app/_components/ui";
import {
  listStaff,
  createStaff,
  setStaffActive,
  setStaffPassword,
  deleteStaff,
  type StaffMember,
} from "@/app/actions/staff";

export default function StaffManager() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const apply = useCallback((res: { data?: StaffMember[]; error?: string }) => {
    if (res.error) setError(res.error);
    else {
      setStaff(res.data || []);
      setError("");
    }
    setLoading(false);
  }, []);

  /** Refresh after a change. Shows the spinner, which is why it is not what the effect calls. */
  const load = useCallback(async () => {
    setLoading(true);
    apply(await listStaff());
  }, [apply]);

  // The first read deliberately does not go through `load`: that would setState synchronously
  // inside the effect and cascade a render, and `loading` already starts true, so there is
  // nothing for it to set. State is only touched once the request comes back.
  useEffect(() => {
    let alive = true;
    listStaff().then(res => { if (alive) apply(res); }).catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [apply]);

  const flash = (text: string) => { setMsg(text); setTimeout(() => setMsg(""), 3000); };

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    const res = await createStaff(new FormData(e.currentTarget));
    setSaving(false);
    if (res.error) return setError(res.error);
    setShowForm(false);
    flash("Staff account created. Send them the password you set.");
    load();
  };

  const toggleActive = async (member: StaffMember) => {
    setBusyId(member.id);
    const res = await setStaffActive(member.id, !member.is_active);
    setBusyId(null);
    if (res.error) return setError(res.error);
    flash(`${member.email} ${member.is_active ? "disabled" : "enabled"}.`);
    load();
  };

  const resetPassword = async (member: StaffMember) => {
    const next = prompt(`New password for ${member.email} (at least 8 characters):`);
    if (!next) return;
    setBusyId(member.id);
    const res = await setStaffPassword(member.id, next);
    setBusyId(null);
    if (res.error) return setError(res.error);
    flash("Password updated. Send it to them.");
    load();
  };

  const remove = async (member: StaffMember) => {
    // Deliberately a typed confirmation rather than an OK button: this deletes a sign-in
    // someone uses for their job, and the entries they already wrote stay in the log.
    const typed = prompt(`Remove ${member.email}? Type their email to confirm.`);
    if (typed?.trim().toLowerCase() !== member.email.toLowerCase()) return;
    setBusyId(member.id);
    const res = await deleteStaff(member.id);
    setBusyId(null);
    if (res.error) return setError(res.error);
    flash("Staff account removed. Their entries stay in the activity log.");
    load();
  };

  return (
    <section className="panel data-panel">
      {msg && <div className="flash-success">✓ {msg}</div>}
      {error && <div className="form-error">⚠️ {error}</div>}

      <div className="services-toolbar">
        <div className="services-actions">
          <button className="primary" onClick={() => { setShowForm(v => !v); setError(""); }}>
            <Icon name="plus" size={16} /> {showForm ? "Cancel" : "Add staff member"}
          </button>
        </div>
      </div>

      {showForm && (
        <form className="admin-update boxed-form" onSubmit={submit}>
          <label>Full name
            <input name="name" required placeholder="Their name" disabled={saving} />
          </label>
          <label>Email address
            <input name="email" type="email" required placeholder="them@yourcompany.com" disabled={saving} />
          </label>
          <label>Password
            {/* Set here and handed over out of band. Nothing in this application sends email,
                so an invite link would have nowhere to go. */}
            <input name="password" required minLength={8} placeholder="At least 8 characters" disabled={saving} />
          </label>
          <p className="field-hint">
            They sign in at <strong>/admin</strong> with these details and can do everything you
            can, except read the activity log or open this screen.
          </p>
          <button className="primary" disabled={saving}>
            {saving ? "Creating…" : "Create staff account"}
          </button>
        </form>
      )}

      <div className="table-wrap">
        {loading ? (
          <div className="loading-block"><div className="loader" /></div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Password</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {staff.length ? staff.map(m => (
                <tr key={m.id}>
                  <td><strong>{m.full_name || "—"}</strong></td>
                  <td>{m.email}</td>
                  <td>
                    {m.password_plain ? (
                      <span className="password-cell">
                        <span className="mono">{revealed[m.id] ? m.password_plain : "••••••••"}</span>
                        <button
                          type="button"
                          className="icon-btn"
                          title={revealed[m.id] ? "Hide" : "Reveal password"}
                          onClick={() => setRevealed(r => ({ ...r, [m.id]: !r[m.id] }))}
                        >
                          <Icon name="eye" size={14} />
                        </button>
                      </span>
                    ) : <span className="muted-rate">Not captured</span>}
                  </td>
                  <td>
                    <span className={`service-type ${m.is_active ? "per-unit" : ""}`}>
                      {m.is_active ? "Active" : "Disabled"}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="outline small" disabled={busyId === m.id} onClick={() => toggleActive(m)}>
                        <Icon name={m.is_active ? "ban" : "check"} size={14} /> {m.is_active ? "Disable" : "Enable"}
                      </button>
                      <button className="outline small" disabled={busyId === m.id} onClick={() => resetPassword(m)}>
                        <Icon name="key" size={14} /> Reset
                      </button>
                      <button className="icon-btn danger" disabled={busyId === m.id} onClick={() => remove(m)} title="Remove staff account">
                        <Icon name="trash" size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={5} className="empty">No staff accounts yet. You are the only person who can sign in to this console.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
