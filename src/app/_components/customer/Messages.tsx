"use client";

/**
 * The customer's message box.
 *
 * Everything the operator has published, newest first. Anything this customer has not opened
 * before is marked unread, which is what makes the sidebar badge blink; arriving on this
 * screen is what clears it.
 *
 * The receipts are written once, on arrival, for exactly the messages that were unread when
 * the screen opened - captured in a ref rather than read from props, so the list re-rendering
 * as `unread` flips to false cannot re-fire the write, and a message that arrives while the
 * screen is open still counts as unread until it is actually seen.
 */

import { useEffect, useRef } from "react";
import { Icon } from "@/app/_components/ui";
import type { CustomerAnnouncement } from "@/app/actions/announcements";

/** "8 Sep 2026, 4:12 pm" in the operator's timezone, not the browser's UTC offset. */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}

export default function Messages({ announcements, onRead }: {
  announcements: CustomerAnnouncement[];
  onRead: (ids: string[]) => void;
}) {
  const marked = useRef(false);

  useEffect(() => {
    if (marked.current) return;
    const unread = announcements.filter(a => a.unread).map(a => a.id);
    if (!unread.length) return;
    marked.current = true;
    onRead(unread);
  }, [announcements, onRead]);

  return (
    <>
      <section className="panel data-panel">
        {announcements.length ? (
          <ul className="message-list">
            {announcements.map(a => (
              <li key={a.id} className={`message-item ${a.unread ? "unread" : ""}`}>
                <span className="message-mark" aria-hidden="true">
                  <Icon name={a.unread ? "bell" : "check"} size={16} />
                </span>
                <div className="message-body">
                  <div className="message-head">
                    <strong>{a.title}</strong>
                    {a.unread && <span className="message-new">New</span>}
                  </div>
                  {/* Written in a textarea, so the operator's own line breaks are the
                      formatting. Rendered as text - never as markup. */}
                  <p className="message-text">{a.body}</p>
                  <small className="message-meta">
                    {a.from ? `${a.from} · ` : ""}{when(a.created_at)}
                  </small>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="message-empty">
            <Icon name="bell" size={26} />
            <h3>No messages yet</h3>
            <p>Updates from the BulkShout team will appear here.</p>
          </div>
        )}
      </section>
    </>
  );
}
