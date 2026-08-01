"use client";

import React from "react";

/**
 * Shared presentational primitives used by both the customer panel and the admin console.
 * Extracted from PortalApp so the admin screens can reuse them without duplicating markup.
 */

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const p: Record<string, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    radio: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 15h.01M11 15h.01M15 15h2M7 9h10"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    help: <><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.6 2.6 0 1 1 4.58 1.68c-1.15 1.06-2.08 1.38-2.08 3.32M12 17h.01"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.1 2.1-.06-.06A1.7 1.7 0 0 0 15.76 18a1.7 1.7 0 0 0-1 1.54V20h-3v-.46A1.7 1.7 0 0 0 10.76 18a1.7 1.7 0 0 0-1.88.34l-.06.06-2.1-2.1.06-.06A1.7 1.7 0 0 0 7.12 14a1.7 1.7 0 0 0-1.54-1H5.1v-3h.48A1.7 1.7 0 0 0 7.12 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.1-2.1.06.06A1.7 1.7 0 0 0 10.76 5a1.7 1.7 0 0 0 1-1.54V3h3v.46A1.7 1.7 0 0 0 15.76 5a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.1 2.1-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.54 1h.48v3h-.48A1.7 1.7 0 0 0 19.4 15Z"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    chart: <><path d="M4 19V5M4 19h17M8 15v-3M12 15V8M16 15V5M20 15v-7"/></>,
    clock: <><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    search: <><circle cx="11" cy="11" r="6"/><path d="m20 20-4.2-4.2"/></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/></>,
    close: <><path d="m6 6 12 12M18 6 6 18"/></>,
    upload: <><path d="M12 16V4M7 9l5-5 5-5M5 20h14"/></>,
    activity: <><path d="M3 12h4l2-6 4 12 2-6h6"/></>,
    check: <><path d="m5 12 4 4L19 6"/></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
    logout: <><path d="M10 17l5-5-5-5M15 12H3M21 19V5a2 2 0 0 0-2-2h-4"/></>,
    download: <><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></>,
    eye: <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></>,
    "eye-off": <><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61M2 2l20 20"/></>,
    pause: <><path d="M10 4H6v16h4V4ZM18 4h-4v16h4V4Z"/></>,
    "dollar-sign": <><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></>,
    "indian-rupee": <><path d="M6 3h12"/><path d="M6 8h12"/><path d="m6 13 8.5 8"/><path d="M6 13h3"/><path d="M9 13c6.667 0 6.667-10 0-10"/></>,
    mic: <><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></>,
    layers: <><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></>,
    trash: <><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></>,
    menu: <><path d="M3 12h18M3 6h18M3 18h18"/></>,
    chevron: <><path d="m6 9 6 6 6-6"/></>,
    wallet: <><path d="M3 7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M16 12h.01M3 9h18"/></>,
    qr: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM19 19h2v2h-2z"/></>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></>,
    refresh: <><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></>,
    ban: <><circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/></>,
    copy: <><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{p[name]}</svg>;
}

export function formatStatus(raw: string): string {
  const map: Record<string, string> = {
    'PLACED': 'Placed', 'IN_PROGRESS': 'In progress', 'COMPLETED': 'Completed', 'PARTIAL': 'Completed', 'CANCELLED': 'Cancelled', 'ON_HOLD': 'On hold', 'REFUNDED': 'Refunded',
    'OPEN': 'Open', 'RESOLVED': 'Resolved', 'CLOSED': 'Closed',
    'PENDING': 'Pending', 'APPROVED': 'Approved', 'REJECTED': 'Rejected',
  };
  return map[raw] || raw.charAt(0) + raw.slice(1).toLowerCase();
}

export function Badge({ status }: { status: string }) {
  return <span className={`badge ${status.toLowerCase().replaceAll(" ", "-")}`}><i />{status}</span>;
}

export function Heading({ eyebrow, title, text, action, onAction }: { eyebrow: string; title: string; text: string; action?: string; onAction?: () => void }) {
  return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{text}</p></div>{action && <button className="primary" onClick={onAction}><Icon name="plus"/>{action}</button>}</div>;
}

export function PanelTop({ title, text, action, onAction }: { title: string; text: string; action?: string; onAction?: () => void }) {
  return <div className="panel-top"><div><h2>{title}</h2><p>{text}</p></div>{action && <button className="text-button" onClick={onAction}>{action}<Icon name="arrow" size={15}/></button>}</div>;
}

export function Metric({ icon, label, value, detail, warning, success }: { icon: string; label: string; value: number | string; detail: string; warning?: boolean; success?: boolean }) {
  return <article className="metric panel"><div className={`metric-icon ${warning ? "orange" : success ? "green" : "red"}`}><Icon name={icon} size={20}/></div><div className="metric-body"><p>{label}</p><h2>{value}</h2><small className={warning ? "warning-text" : success ? "success-text" : ""}>{detail}</small></div></article>;
}

export function Timeline({ color, title, text, time }: { color: string; title: string; text: string; time: string }) {
  return <div className="timeline-item"><span className={`timeline-dot ${color}`}><Icon name={color === "green" ? "chart" : color === "red" ? "help" : "activity"} size={13}/></span><div><strong>{title}</strong><p>{text}</p><small>{time}</small></div></div>;
}
