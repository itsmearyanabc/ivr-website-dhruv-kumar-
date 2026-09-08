"use client";

/**
 * Notifications, from the operator's side: write a message once, and every customer sees it
 * in their message box with a badge that blinks until they open it.
 *
 * A message is published to everyone - there is no per-customer targeting - so the only
 * decisions on this screen are what it says and whether it is still showing. Withdrawing
 * hides it without discarding who had already read it, which is why it is offered instead of
 * deletion for anything that has been out.
 *
 * Every action here is re-checked server-side, so nothing on this page is load-bearing for
 * security. It is the interface to those actions, not the gate.
 */

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/app/_components/ui";
import {
  getAnnouncements,
  createAnnouncement,
  setAnnouncementActive,
  deleteAnnouncement,
} from "@/app/actions/announcements";

type AdminAnnouncement = {
  id: string;
  title: string;
  body: string;
  created_at: string;
  created_by_name: string | null;
  is_active: boolean;
  read_count: number;
};

const TITLE_MAX = 120;
const BODY_MAX = 4000;

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}

export default function Announcements({ onSent }: { onSent?: () => void }) {
  const [items, setItems] = useState<AdminAnnouncement[]>([]);
  const [audience, setAudience] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Set when the database has no announcement tables yet, so the screen can say so. */
  const [needsMigration, setNeedsMigration] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  /** Whatever `getAnnouncements` returned: the list, or the message explaining why not. */
  type LoadResult =
    | { error: string }
    | { data: AdminAnnouncement[]; audience: number; migrationRequired?: boolean };

  const apply = useCallback((res: LoadResult) => {
    if ("error" in res) setError(res.error);
    else {
      setItems(res.data || []);
      setAudience(res.audience || 0);
      setNeedsMigration(Boolean(res.migrationRequired));
      setError("");
    }
    setLoading(false);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    apply(await getAnnouncements());
  }, [apply]);

  // First read does not go through `load`: `loading` already starts true, so there is nothing
  // for it to set, and state is only touched once the request comes back.
  useEffect(() => {
    let alive = true;
    getAnnouncements()
      .then(res => { if (alive) apply(res); })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [apply]);

  const flash = (text: string) => { setMsg(text); setTimeout(() => setMsg(""), 3500); };

  const send = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    const res = await createAnnouncement(title, body);
    setSaving(false);
    if ("error" in res && res.error) return setError(res.error);
    setTitle("");
    setBody("");
    flash(audience ? `Sent to ${audience} customer${audience === 1 ? "" : "s"}.` : "Message published.");
    onSent?.();
    load();
  };

  const toggle = async (a: AdminAnnouncement) => {
    setBusyId(a.id);
    const res = await setAnnouncementActive(a.id, !a.is_active);
    setBusyId(null);
    if ("error" in res && res.error) return setError(res.error);
    flash(a.is_active ? "Message withdrawn." : "Message republished.");
    load();
  };

  const remove = async (a: AdminAnnouncement) => {
    if (!confirm(`Delete "${a.title}"? This also discards who had read it.`)) return;
    setBusyId(a.id);
    const res = await deleteAnnouncement(a.id);
    setBusyId(null);
    if ("error" in res && res.error) return setError(res.error);
    flash("Message deleted.");
    load();
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ADMIN CONSOLE</p>
          <h1>Notifications</h1>
          <p>Send a message to every customer. It appears in their panel and blinks until read.</p>
        </div>
      </div>

      {/* Said on arrival rather than only when a send fails: an operator should not have to
          write a message and press the button to find out the feature is not installed. */}
      {needsMigration && (
        <div className="form-error">
          ⚠️ Announcements are not installed on this database yet. Run{" "}
          <code>supabase/migrations/20260908020000_customer_announcements.sql</code> in the
          Supabase SQL editor, then reload this page.
        </div>
      )}
      {error && <div className="form-error">⚠️ {error}</div>}
      {msg && <div className="flash-success">✓ {msg}</div>}

      <section className="panel notify-compose">
        <div className="panel-top">
          <div>
            <h2>New message</h2>
            <p>{audience ? `Goes to all ${audience} customer${audience === 1 ? "" : "s"}.` : "Goes to every customer."}</p>
          </div>
        </div>
        <form onSubmit={send} className="notify-form">
          <label>
            Title
            <input
              type="text"
              value={title}
              maxLength={TITLE_MAX}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Scheduled maintenance on Sunday"
              required
            />
          </label>
          <label>
            Message
            <textarea
              value={body}
              rows={5}
              maxLength={BODY_MAX}
              onChange={e => setBody(e.target.value)}
              placeholder="What you want every customer to know. Line breaks are kept."
              required
            />
            <small className="notify-count">{body.length} / {BODY_MAX}</small>
          </label>
          <div className="notify-actions">
            <button className="primary" type="submit" disabled={saving || needsMigration || !title.trim() || !body.trim()}>
              <Icon name="bell" size={16}/> {saving ? "Sending…" : "Send to all customers"}
            </button>
          </div>
        </form>
      </section>

      <section className="panel data-panel">
        <div className="panel-top">
          <div>
            <h2>Sent messages</h2>
            <p>Newest first, with how many customers have opened each one.</p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Message</th><th>Sent</th><th>Read</th><th>Status</th><th>Action</th></tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="empty">Loading…</td></tr>
              ) : items.length ? (
                items.map(a => (
                  <tr key={a.id}>
                    <td>
                      <strong>{a.title}</strong>
                      <small className="notify-preview">{a.body}</small>
                    </td>
                    <td>
                      {when(a.created_at)}
                      {a.created_by_name && <small>{a.created_by_name}</small>}
                    </td>
                    <td>{a.read_count}{audience ? ` / ${audience}` : ""}</td>
                    <td>
                      <span className={`badge ${a.is_active ? "enabled" : "disabled"}`}>
                        <i />{a.is_active ? "Published" : "Withdrawn"}
                      </span>
                    </td>
                    <td className="row-actions">
                      <button className="text-button row-text" disabled={busyId === a.id} onClick={() => toggle(a)}>
                        {a.is_active ? "Withdraw" : "Republish"}
                      </button>
                      <button className="text-button row-text danger" disabled={busyId === a.id} onClick={() => remove(a)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={5} className="empty">No messages sent yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
