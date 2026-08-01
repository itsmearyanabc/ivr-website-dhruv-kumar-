"use client";

import React, { useEffect, useRef, useState } from "react";
import { Icon } from "@/app/_components/ui";

/**
 * Admin console chrome: a grouped top navigation bar in place of the customer sidebar.
 *
 * Views are plain strings. A view may carry an argument after a colon ("Settings:payments")
 * so a menu entry can deep-link into a tab without needing extra routing.
 */

export type NavEntry = { label: string; view: string; hint?: string };
export type NavGroup = { label: string; icon: string; view?: string; entries?: NavEntry[] };

export const ADMIN_NAV: NavGroup[] = [
  { label: "Dashboard", icon: "grid", view: "Dashboard" },
  {
    label: "Orders",
    icon: "radio",
    entries: [
      { label: "All broadcasts", view: "Broadcasts", hint: "Every request, all statuses" },
      { label: "Needs action", view: "Broadcasts:pending", hint: "Placed and on-hold work" },
      { label: "Scheduled later", view: "Broadcasts:scheduled", hint: "Future-dated broadcasts" },
    ],
  },
  {
    label: "Customers",
    icon: "users",
    entries: [
      { label: "All customers", view: "Customers", hint: "Directory and wallet balances" },
      { label: "Activity log", view: "Activity log", hint: "Full operational audit trail" },
    ],
  },
  {
    label: "Services",
    icon: "layers",
    entries: [
      { label: "Categories & services", view: "Services", hint: "What customers can order" },
      { label: "Call pricing", view: "Pricing", hint: "Default per-call rate" },
    ],
  },
  {
    label: "Payments",
    icon: "wallet",
    entries: [
      { label: "Top-up requests", view: "Topups", hint: "Verify UTRs and credit wallets" },
      { label: "Wallet transactions", view: "Transactions", hint: "Every credit and debit" },
      { label: "Payment methods", view: "Settings:payments", hint: "UPI QR and verification" },
    ],
  },
  { label: "Support", icon: "help", view: "Support desk" },
  {
    label: "Control panel",
    icon: "settings",
    entries: [
      { label: "Panel settings", view: "Settings:general", hint: "General configuration" },
      { label: "Payment methods", view: "Settings:payments", hint: "UPI QR and verification" },
    ],
  },
];

/** "Settings:payments" -> "Settings". Menu highlighting compares base views only. */
export function baseView(view: string): string {
  return view.split(":")[0];
}

export default function AdminShell({
  view,
  onNavigate,
  userName,
  pendingTopups = 0,
  onLogout,
  children,
}: {
  view: string;
  onNavigate: (view: string) => void;
  userName: string;
  pendingTopups?: number;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);

  // A dropdown that survives a click elsewhere on the page feels broken, so close on any
  // outside pointer down and on Escape.
  useEffect(() => {
    if (!openGroup) return;

    const onPointerDown = (event: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(event.target as Node)) setOpenGroup(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenGroup(null);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openGroup]);

  const go = (target: string) => {
    setOpenGroup(null);
    setMobileOpen(false);
    onNavigate(target);
  };

  const current = baseView(view);
  const isGroupActive = (group: NavGroup) =>
    group.view === current || Boolean(group.entries?.some((entry) => baseView(entry.view) === current));

  return (
    <main className="admin-app">
      <header className="admin-bar">
        <div className="admin-bar-inner">
          <button className="admin-brand" onClick={() => go("Dashboard")}>
            <span className="brand-mark"><b>X</b></span>
            <span>XPACK<em>ADMIN</em></span>
          </button>

          <button
            className="admin-burger"
            aria-label="Toggle navigation"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((open) => !open)}
          >
            <Icon name={mobileOpen ? "close" : "menu"} size={22} />
          </button>

          <div className={`admin-nav ${mobileOpen ? "open" : ""}`} ref={navRef}>
            {ADMIN_NAV.map((group) => {
              const active = isGroupActive(group);

              if (!group.entries) {
                return (
                  <button
                    key={group.label}
                    className={`admin-nav-item ${active ? "on" : ""}`}
                    onClick={() => go(group.view!)}
                  >
                    <Icon name={group.icon} size={16} />
                    {group.label}
                  </button>
                );
              }

              const expanded = openGroup === group.label;
              const badge = group.label === "Payments" ? pendingTopups : 0;

              return (
                <div key={group.label} className={`admin-nav-group ${expanded ? "open" : ""}`}>
                  <button
                    className={`admin-nav-item ${active ? "on" : ""}`}
                    aria-expanded={expanded}
                    aria-haspopup="true"
                    onClick={() => setOpenGroup(expanded ? null : group.label)}
                  >
                    <Icon name={group.icon} size={16} />
                    {group.label}
                    {badge > 0 && <span className="nav-badge">{badge}</span>}
                    <span className="admin-nav-caret"><Icon name="chevron" size={14} /></span>
                  </button>

                  <div className="admin-menu" role="menu">
                    {group.entries.map((entry) => (
                      <button
                        key={entry.view}
                        role="menuitem"
                        className={`admin-menu-item ${view === entry.view ? "on" : ""}`}
                        onClick={() => go(entry.view)}
                      >
                        <strong>
                          {entry.label}
                          {entry.view === "Topups" && pendingTopups > 0 && (
                            <span className="nav-badge">{pendingTopups}</span>
                          )}
                        </strong>
                        {entry.hint && <small>{entry.hint}</small>}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="admin-bar-actions">
            <button
              className={`admin-alert ${pendingTopups > 0 ? "hot" : ""}`}
              title={pendingTopups > 0 ? `${pendingTopups} top-ups awaiting verification` : "No top-ups waiting"}
              onClick={() => go("Topups")}
            >
              <Icon name="bell" size={16} />
              {pendingTopups > 0 && <em>{pendingTopups}</em>}
            </button>
            <span className="access-label"><Icon name="lock" size={13} />Admin</span>
            <div className="header-user">
              <span className="header-avatar">
                {userName.split(" ").map((part) => part[0]).join("").slice(0, 2)}
              </span>
              <span className="header-name">{userName}</span>
            </div>
            <button className="header-logout" onClick={onLogout}>
              <Icon name="logout" size={15} /><span>Logout</span>
            </button>
          </div>
        </div>
      </header>

      <div className="admin-page">{children}</div>
    </main>
  );
}

/** Horizontal tab strip used by the dashboard and the settings screen. */
export function TabStrip({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ key: string; label: string }>;
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="tab-strip" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          role="tab"
          aria-selected={active === tab.key}
          className={`tab-strip-item ${active === tab.key ? "on" : ""}`}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
