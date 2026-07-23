/* eslint-disable @typescript-eslint/no-explicit-any */
// cspell:ignore Xpack xpack Dhruv Kaveri Proximo supabase SUPABASE
"use client";

import React, { FormEvent, useEffect, useState } from "react";
import { signUp, signIn, signOut, getUserSession } from "@/app/actions/auth";
import { getBroadcasts, createBroadcast, updateBroadcastStatus, getDownloadUrl, resubmitFiles } from "@/app/actions/broadcasts";
import { getTickets, createTicket, updateTicketStatus } from "@/app/actions/tickets";

type Role = "customer" | "admin";
type Status = "Placed" | "In progress" | "Completed" | "Cancelled" | "On hold" | "Refunded";
type TicketStatus = "Open" | "In progress" | "Resolved" | "Closed";
type Session = { role: Role; name: string; email: string; company?: string };
type OrderHistory = { status: string; reason?: string; created_at: string };
type Order = { id: string; broadcastNo: string; name: string; customer: string; email: string; created: string; contacts: string; status: Status; schedule: string; notes?: string; report?: boolean; audioKey?: string; contactsKey?: string; reportKey?: string; audioFile?: File; contactsFile?: File; holdReason?: string; cancelReason?: string; refundReason?: string; refundAmount?: number; history?: OrderHistory[] };
type Ticket = { id: string; subject: string; customer: string; priority: "Normal" | "High"; status: TicketStatus; message: string; created: string; reply?: string; };

const initialOrders: Order[] = [];
const initialTickets: Ticket[] = [];


function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const p: Record<string, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    radio: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 15h.01M11 15h.01M15 15h2M7 9h10"/></>, users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    help: <><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.6 2.6 0 1 1 4.58 1.68c-1.15 1.06-2.08 1.38-2.08 3.32M12 17h.01"/></>, settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.1 2.1-.06-.06A1.7 1.7 0 0 0 15.76 18a1.7 1.7 0 0 0-1 1.54V20h-3v-.46A1.7 1.7 0 0 0 10.76 18a1.7 1.7 0 0 0-1.88.34l-.06.06-2.1-2.1.06-.06A1.7 1.7 0 0 0 7.12 14a1.7 1.7 0 0 0-1.54-1H5.1v-3h.48A1.7 1.7 0 0 0 7.12 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.1-2.1.06.06A1.7 1.7 0 0 0 10.76 5a1.7 1.7 0 0 0 1-1.54V3h3v.46A1.7 1.7 0 0 0 15.76 5a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.1 2.1-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.54 1h.48v3h-.48A1.7 1.7 0 0 0 19.4 15Z"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>, plus: <><path d="M12 5v14M5 12h14"/></>, chart: <><path d="M4 19V5M4 19h17M8 15v-3M12 15V8M16 15V5M20 15v-7"/></>, clock: <><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></>, arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>, search: <><circle cx="11" cy="11" r="6"/><path d="m20 20-4.2-4.2"/></>, file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></>, more: <><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/></>, close: <><path d="m6 6 12 12M18 6 6 18"/></>, upload: <><path d="M12 16V4M7 9l5-5 5 5M5 20h14"/></>, activity: <><path d="M3 12h4l2-6 4 12 2-6h6"/></>, check: <><path d="m5 12 4 4L19 6"/></>, lock: <><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>, logout: <><path d="M10 17l5-5-5-5M15 12H3M21 19V5a2 2 0 0 0-2-2h-4"/></>, download: <><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></>, eye: <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></>, "eye-off": <><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61M2 2l20 20"/></>, pause: <><path d="M10 4H6v16h4V4ZM18 4h-4v16h4V4Z"/></>
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{p[name]}</svg>;
}
function formatStatus(raw: string): Status | TicketStatus {
  const map: Record<string, string> = {
    'PLACED': 'Placed', 'IN_PROGRESS': 'In progress', 'COMPLETED': 'Completed', 'CANCELLED': 'Cancelled', 'ON_HOLD': 'On hold', 'REFUNDED': 'Refunded',
    'OPEN': 'Open', 'RESOLVED': 'Resolved', 'CLOSED': 'Closed',
  };
  return (map[raw] || raw.charAt(0) + raw.slice(1).toLowerCase()) as Status | TicketStatus;
}

function Badge({ status }: { status: string }) { return <span className={`badge ${status.toLowerCase().replaceAll(" ", "-")}`}><i />{status}</span>; }

function mapBroadcast(b: any, index: number) {
  return {
    id: b.reference_no,
    broadcastNo: `BR-${index + 1}`,
    name: b.name,
    customer: b.customer,
    email: b.email,
    created: new Date(b.created_at).toLocaleString(),
    contacts: b.email || 'Unknown',
    status: formatStatus(b.status) as Status,
    schedule: b.scheduled_for ? new Date(b.scheduled_for).toLocaleString() : 'Start on processing',
    notes: b.description,
    audioKey: b.audio_key,
    contactsKey: b.contacts_key,
    reportKey: b.reports?.[0]?.file_key,
    report: b.status === 'COMPLETED' && !!b.reports?.[0]?.file_key,
    holdReason: b.hold_reason || '',
    cancelReason: b.cancel_reason || '',
    refundReason: b.refund_reason || '',
    refundAmount: b.refund_amount,
    history: b.history || [],
  };
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [view, setView] = useState("Overview");
  const [orders, setOrders] = useState<Order[]>(initialOrders);
  const [tickets, setTickets] = useState<Ticket[]>(initialTickets);
  const [toast, setToast] = useState("");
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [showTicket, setShowTicket] = useState(false);
  const [selected, setSelected] = useState<Order | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);

  useEffect(() => {
    let mounted = true;
    
    async function initSession() {
      const { session: serverSession } = await getUserSession();
      if (mounted && serverSession) {
        setSession(serverSession as Session);
        fetchData();
      }
    }
    
    async function fetchData() {
      const { data: bData } = await getBroadcasts();
      if (mounted && bData && bData.length > 0) {
        setOrders(bData.map((b: any, i: number) => mapBroadcast(b, i)));
      }
      
      const { data: tData } = await getTickets();
      if (mounted && tData && tData.length > 0) {
        setTickets(tData.map((t: any) => ({
          id: t.reference_no,
          subject: t.subject,
          customer: t.customer,
          priority: t.priority === 'HIGH' ? 'High' : 'Normal',
          status: formatStatus(t.status) as TicketStatus,
          message: t.message || '',
          created: new Date(t.created_at).toLocaleString(),
          reply: t.reply,
        })));
      }
    }
    
    initSession();
    return () => { mounted = false; };
  }, []);

  const message = (text: string) => { setToast(text); window.setTimeout(() => setToast(""), 3600); };
  const login = (next: Session) => { setSession(next); setView("Overview"); };
  const logout = async () => { 
    if (window.confirm("Are you sure you want to log out?")) {
      try {
        await signOut();
      } catch (e) {
        console.error("Signout error:", e);
      } finally {
        setSession(null); 
        setSelected(null); 
        setSelectedTicket(null);
      }
    }
  };

  const refreshBroadcasts = async () => {
    const { data: bData } = await getBroadcasts();
    if (bData && bData.length > 0) {
      setOrders(bData.map((b: any, i: number) => mapBroadcast(b, i)));
    }
  };

  const addOrder = async (order: Order) => { 
    setShowBroadcast(false); 
    const formData = new FormData();
    formData.append("name", order.name);
    formData.append("schedule", order.schedule);
    formData.append("notes", order.notes || "");
    if (order.audioFile) formData.append("audio", order.audioFile);
    if (order.contactsFile) formData.append("contacts", order.contactsFile);
    
    const { error } = await createBroadcast(formData);
    if (error) {
      message(error);
    } else {
      message("Broadcast request submitted for review.");
      await refreshBroadcasts();
    }
  };

  const addTicket = async (ticket: Ticket) => { 
    setShowTicket(false); 
    const formData = new FormData();
    formData.append("subject", ticket.subject);
    formData.append("priority", ticket.priority);
    formData.append("message", ticket.message);
    const { error } = await createTicket(formData);
    if (error) {
      message(error);
    } else {
      message("Support ticket created. Our team has been notified.");
      const { data: tData } = await getTickets();
      if (tData && tData.length > 0) {
        setTickets(tData.map((t: any) => ({
          id: t.reference_no, subject: t.subject, customer: t.customer, priority: t.priority === 'HIGH' ? 'High' : 'Normal',
          status: formatStatus(t.status) as TicketStatus,
          message: t.message || '', created: new Date(t.created_at).toLocaleString(), reply: t.reply,
        })));
      }
    }
  };

  const updateOrder = async (id: string, status: Status, payload?: { reportFile?: File, holdReason?: string, cancelReason?: string, refundReason?: string, refundAmount?: number }) => { 
    setSelected(null); 
    const dbStatus = status.toUpperCase().replace(' ', '_');
    const formData = new FormData();
    formData.append("id", id);
    formData.append("status", dbStatus);
    if (payload?.reportFile) formData.append("report", payload.reportFile);
    if (payload?.holdReason) formData.append("holdReason", payload.holdReason);
    if (payload?.cancelReason) formData.append("cancelReason", payload.cancelReason);
    if (payload?.refundReason) formData.append("refundReason", payload.refundReason);
    if (payload?.refundAmount) formData.append("refundAmount", payload.refundAmount.toString());

    const { error } = await updateBroadcastStatus(formData);
    if (error) {
      message(error);
    } else {
      message(status === "Completed" ? "Order completed and report shared with customer." : status === "On hold" ? "Order placed on hold. Customer has been notified." : `Order updated to ${status}.`);
      await refreshBroadcasts();
    }
  };

  const handleResubmit = async (id: string, audioFile?: File, contactsFile?: File) => {
    setSelected(null);
    const formData = new FormData();
    formData.append("id", id);
    if (audioFile) formData.append("audio", audioFile);
    if (contactsFile) formData.append("contacts", contactsFile);

    const { error } = await resubmitFiles(formData);
    if (error) {
      message(error);
    } else {
      message("Files resubmitted successfully. Your order has been moved back to Placed.");
      await refreshBroadcasts();
    }
  };

  const updateTicket = async (id: string, status: TicketStatus, reply?: string) => { 
    setSelectedTicket(null); 
    const dbStatus = status.toUpperCase().replace(' ', '_');
    const { error } = await updateTicketStatus(id, dbStatus, reply);
    if (error) {
      message(error);
    } else {
      message(status === "Resolved" ? "Ticket resolved and reply sent." : `Ticket updated to ${status}.`);
      setTickets(tickets.map(t => t.id === id ? { ...t, status, reply: reply || t.reply } : t));
    }
  };
  if (!session) return <Auth onLogin={login} />;
  const nav = session.role === "customer" ? [["Overview", "grid"], ["My broadcasts", "radio"], ["Support centre", "help"], ["Settings", "settings"]] : [["Overview", "grid"], ["Broadcast management", "radio"], ["Customers", "users"], ["Support desk", "help"], ["Activity log", "activity"]];
  return <main className="app-shell"><aside className="sidebar"><div className="brand"><span className="brand-mark"><b>x</b></span><span>Xpack</span></div><div className="workspace"><span className="company-dot">{session.role === "admin" ? "X" : session.name.slice(0, 1)}</span><span>{session.role === "admin" ? "Xpack Operations" : session.company || session.name}</span></div><nav>{nav.map(([label, icon]) => <button key={label} onClick={() => { setView(label); setSelected(null); setSelectedTicket(null); }} className={view === label ? "active" : ""}><Icon name={icon as string}/>{label}</button>)}</nav><div className="sidebar-bottom"><div className="help-card"><span className="help-symbol">?</span><div><strong>Need help?</strong><p>Our team is here for you.</p><button onClick={() => setView(session.role === "admin" ? "Support desk" : "Support centre")}>Open support <Icon name="arrow" size={13}/></button></div></div><div className="user-card"><span className="avatar">{session.name.split(" ").map(x => x[0]).join("").slice(0,2)}</span><div><strong>{session.name}</strong><p>{session.role === "admin" ? "Xpack administrator" : "Customer account"}</p></div><button title="Sign out" onClick={logout}><Icon name="logout"/></button></div></div></aside><section className="content"><header><div className="mobile-brand">Xpack</div><div className="header-actions"><span className="access-label"><Icon name={session.role === "admin" ? "lock" : "users"} size={14}/>{session.role === "admin" ? "Admin access" : "Customer portal"}</span><button className="notification"><Icon name="bell"/><em>3</em></button><span className="header-avatar">{session.name.split(" ").map(x => x[0]).join("").slice(0,2)}</span></div></header><div className="page">{session.role === "customer" ? <CustomerPage view={view} orders={orders.filter(o => o.email === session.email)} tickets={tickets.filter(t => t.customer === (session.company || session.name))} setView={setView} create={() => setShowBroadcast(true)} ticket={() => setShowTicket(true)} select={setSelected} selectTicket={setSelectedTicket} session={session} /> : <AdminPage view={view} orders={orders} tickets={tickets} setView={setView} select={setSelected} selectTicket={setSelectedTicket} />}</div></section>{showBroadcast && <BroadcastModal onClose={() => setShowBroadcast(false)} onSubmit={addOrder} session={session}/>} {showTicket && <TicketModal onClose={() => setShowTicket(false)} onSubmit={addTicket} session={session}/>} {selected && <OrderModal order={selected} admin={session.role === "admin"} onClose={() => setSelected(null)} onUpdate={updateOrder} onResubmit={handleResubmit}/>} {selectedTicket && <TicketViewModal ticket={selectedTicket} admin={session.role === "admin"} onClose={() => setSelectedTicket(null)} onUpdate={updateTicket}/>} {toast && <div className="toast"><span><Icon name="check" size={16}/></span>{toast}</div>}</main>;
}

function Auth({ onLogin }: { onLogin: (s: Session) => void }) {
  const [mode, setMode] = useState<"login" | "signup" | "admin" | "forgot">("login");
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [captchaQ, setCaptchaQ] = useState({ n1: 4, n2: 7 }); // Default initial mock question
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [lockoutCount, setLockoutCount] = useState(0);
  const [lockoutUntil, setLockoutUntil] = useState<Date | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(0);

  const resetCaptcha = () => {
    setCaptchaQ({ n1: Math.floor(Math.random() * 10) + 1, n2: Math.floor(Math.random() * 10) + 1 });
    setCaptchaAnswer("");
  };

  useEffect(() => {
    // eslint-disable-next-line react-compiler/react-compiler
    resetCaptcha();
  }, []);

  const changeMode = (newMode: typeof mode) => {
    setMode(newMode);
    setError("");
    resetCaptcha();
  };

  useEffect(() => {
    if (!lockoutUntil) return;
    const interval = setInterval(() => {
      const remaining = Math.ceil((lockoutUntil.getTime() - Date.now()) / 1000);
      if (remaining <= 0) {
        setLockoutUntil(null);
        setTimeRemaining(0);
        setError("");
        clearInterval(interval);
      } else {
        setTimeRemaining(remaining);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [lockoutUntil]);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (lockoutUntil && Date.now() < lockoutUntil.getTime()) {
      return setError(`Too many failed attempts. Try again in ${timeRemaining} seconds.`);
    }

    const data = new FormData(e.currentTarget);
    const email = String(data.get("email") || "").trim().toLowerCase();
    
    if (mode !== "forgot") {
      if (parseInt(captchaAnswer) !== captchaQ.n1 + captchaQ.n2) {
        resetCaptcha();
        return setError(`Please solve the CAPTCHA correctly.`);
      }
    }

    const handleFailure = (msg: string) => {
      const newAttempts = attempts + 1;
      if (newAttempts >= 5) {
        const nextLockoutCount = lockoutCount + 1;
        let penaltyMinutes = 1;
        if (nextLockoutCount === 2) penaltyMinutes = 5;
        else if (nextLockoutCount > 2) penaltyMinutes = 5 + (nextLockoutCount - 2);
        
        setLockoutCount(nextLockoutCount);
        setLockoutUntil(new Date(Date.now() + penaltyMinutes * 60000));
        setAttempts(0);
        setError(`Too many failed attempts. Account locked for ${penaltyMinutes} minute(s).`);
      } else {
        setAttempts(newAttempts);
        setError(`${msg} (${5 - newAttempts} attempts remaining)`);
      }
      resetCaptcha();
    };

    if (mode === "admin" || mode === "login") {
      const result = await signIn(data, mode === "admin");
      if (result.error) {
        return handleFailure(result.error);
      }
      setAttempts(0); setLockoutCount(0); setLockoutUntil(null);
      onLogin({ 
        role: mode === "admin" ? "admin" : "customer", 
        name: result.user?.name || (mode === "admin" ? "Admin" : "User"), 
        email, 
        company: result.user?.company || "" 
      });
      return;
    }
    
    if (mode === "forgot") {
      setError("If that email exists, a password reset link has been queued.");
      return;
    }

    if (mode === "signup") {
      const result = await signUp(data);
      if (result.error) {
        resetCaptcha();
        return setError(result.error);
      }
      setAttempts(0); setLockoutCount(0); setLockoutUntil(null);
      onLogin({ role: "customer", name: String(data.get("name")), email, company: String(data.get("company")) });
      return;
    }
  };

  const title = mode === "admin" ? "Administrator sign in" : mode === "signup" ? "Create your Xpack account" : mode === "forgot" ? "Reset your password" : "Welcome back";
  const isLocked = lockoutUntil !== null;

  return <main className="auth-shell"><section className="auth-brand"><div className="brand"><span className="brand-mark"><b>x</b></span><span>Xpack</span></div><div><p className="eyebrow">IVR BROADCAST MANAGEMENT</p><h1>Every broadcast,<br/>clear and under control.</h1><p>Place orders, securely share files, track processing, and receive campaign reports in one focused workspace.</p></div><div className="auth-points"><span><Icon name="check"/>Secure file management</span><span><Icon name="check"/>Live order notifications</span><span><Icon name="check"/>Dedicated support desk</span></div></section><section className="auth-panel"><form className="auth-card" onSubmit={submit}><div className="auth-heading"><p className="eyebrow">{mode === "admin" ? "RESTRICTED AREA" : "XPACK PORTAL"}</p><h2>{title}</h2><p>{mode === "admin" ? "Use your authorized Xpack Operations credentials." : mode === "signup" ? "Set up your customer workspace in under a minute." : mode === "forgot" ? "We will email a secure reset link to you." : "Sign in to manage your broadcasts."}</p></div>{mode === "signup" && <><label>Full name<input name="name" required placeholder="Your full name" disabled={isLocked}/></label><label>Company name <span>(optional)</span><input name="company" placeholder="Your company" disabled={isLocked}/></label><label>Phone number<input name="phone" required placeholder="+91 00000 00000" disabled={isLocked}/></label></>}<label>Email address<input name="email" type="email" required placeholder="you@company.com" defaultValue={mode === "admin" ? "admin@xpack.in" : undefined} disabled={isLocked}/></label>{mode !== "forgot" && <label>Password<div style={{position: 'relative'}}><input name="password" type={showPassword ? "text" : "password"} required minLength={8} placeholder="••••••••" defaultValue={mode === "admin" ? "" : undefined} style={{paddingRight: '36px'}} disabled={isLocked}/><button type="button" onClick={() => setShowPassword(!showPassword)} style={{position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: '4px'}} disabled={isLocked}><Icon name={showPassword ? "eye-off" : "eye"} size={16}/></button></div></label>}{mode === "signup" && <label>Confirm password<input name="confirm" type="password" required minLength={8} placeholder="••••••••" disabled={isLocked}/></label>}{mode !== "forgot" && <label>Security Check: What is {captchaQ.n1} + {captchaQ.n2}?<input type="number" required placeholder="Your answer" value={captchaAnswer} onChange={e => setCaptchaAnswer(e.target.value)} disabled={isLocked}/></label>}{mode === "login" && <div className="auth-options"><label className="check"><input type="checkbox" defaultChecked disabled={isLocked}/> Remember me</label><button type="button" onClick={() => changeMode("forgot")} disabled={isLocked}>Forgot password?</button></div>}{error && <p className="auth-error">{error}</p>}<button className="primary auth-submit" disabled={isLocked}>{mode === "signup" ? "Create account" : mode === "forgot" ? "Send reset link" : isLocked ? `Locked (${timeRemaining}s)` : "Sign in"}<Icon name="arrow" size={16}/></button>{mode === "admin" ? <button type="button" className="plain-link" onClick={() => changeMode("login")} disabled={isLocked}>Back to customer sign in</button> : <><p className="auth-switch">{mode === "signup" ? "Already have an account?" : "New to Xpack?"} <button type="button" onClick={() => changeMode(mode === "signup" ? "login" : "signup")} disabled={isLocked}>{mode === "signup" ? "Sign in" : "Create an account"}</button></p><button type="button" className="admin-entry" onClick={() => changeMode("admin")} disabled={isLocked}><Icon name="lock" size={14}/>Administrator sign in</button></>}</form></section></main>;
}

function CustomerPage({ view, orders, tickets, setView, create, ticket, select, selectTicket, session }: { view: string; orders: Order[]; tickets: Ticket[]; setView: (v: string) => void; create: () => void; ticket: () => void; select: (o: Order) => void; selectTicket: (t: Ticket) => void; session: Session }) {
  if (view === "My broadcasts") return <><Heading eyebrow="CUSTOMER PORTAL" title="My broadcasts" text="Every IVR broadcast request in one place." action="New broadcast" onAction={create}/><section className="panel data-panel"><OrderTable orders={orders} onSelect={select}/></section></>;
  if (view === "Support centre") return <><Heading eyebrow="SUPPORT CENTRE" title="How can we help?" text="Create a ticket and keep every conversation in one thread." action="New ticket" onAction={ticket}/><section className="support-layout"><section className="panel data-panel"><TicketTable tickets={tickets} onSelect={selectTicket}/></section><aside className="panel support-aside"><Icon name="help" size={26}/><h2>Priority support</h2><p>Our operations team typically responds within one business day.</p><button className="outline" onClick={ticket}>Raise a ticket</button></aside></section></>;
  if (view === "Settings") return <><Heading eyebrow="ACCOUNT SETTINGS" title="Profile and preferences" text="Keep your account and notification preferences up to date."/><section className="panel settings-panel"><div className="setting-section"><h2>Profile information</h2><p>These details appear on your broadcast requests.</p><div className="form-grid"><label>Full name<input defaultValue={session.name}/></label><label>Company<input defaultValue={session.company}/></label><label>Email address<input defaultValue={session.email}/></label><label>Phone number<input placeholder="Add a phone number"/></label></div><button className="primary" onClick={() => alert("Profile changes are saved in the production database once connected.")}>Save changes</button></div><div className="setting-section"><h2>Notification preferences</h2><p>Receive an email when a broadcast changes status or a report is ready.</p><label className="toggle-row">Email status updates<input type="checkbox" defaultChecked/></label></div></section></>;
  
  const placed = orders.filter((o: Order) => o.status === "Placed").length, progressing = orders.filter((o: Order) => o.status === "In progress").length, completed = orders.filter((o: Order) => o.status === "Completed").length;

  // Generate dynamic customer events
  const parseDate = (dStr: string) => {
    const d = new Date(dStr);
    return isNaN(d.getTime()) ? new Date() : d;
  };
  const events: Array<{ title: string; text: string; time: string; dateObj: Date; color: string }> = [];
  orders.forEach(o => {
    events.push({
      title: "Broadcast submitted",
      text: `${o.name} is awaiting review.`,
      time: o.created,
      dateObj: parseDate(o.created),
      color: "blue"
    });
    if (o.status === "Completed") {
      events.push({
        title: "Report is ready",
        text: `${o.name} report was uploaded.`,
        time: o.created,
        dateObj: parseDate(o.created),
        color: "green"
      });
    }
  });
  tickets.forEach(t => {
    events.push({
      title: "Support ticket opened",
      text: `Your request "${t.subject}" has been assigned to the team.`,
      time: t.created,
      dateObj: parseDate(t.created),
      color: "red"
    });
  });
  events.sort((a, b) => b.dateObj.getTime() - a.dateObj.getTime());

  return <><Heading eyebrow="CUSTOMER PORTAL" title={`Good morning, ${session.name.split(" ")[0]}`} text="Here's what's happening with your broadcasts." action="New broadcast" onAction={create}/><div className="metric-grid"><Metric icon="radio" label="Total broadcasts" value={orders.length} detail="All time"/><Metric icon="clock" label="Pending orders" value={placed} detail="Awaiting review" warning/><Metric icon="activity" label="In progress" value={progressing} detail="Being processed"/><Metric icon="chart" label="Completed" value={completed} detail="Reports ready" success/></div><div className="dashboard-grid"><section className="panel"><PanelTop title="Recent broadcasts" text="Your latest broadcast requests." action="View all" onAction={() => setView("My broadcasts")}/><OrderTable orders={orders.slice(0, 4)} onSelect={select}/></section><aside className="activity-panel panel"><PanelTop title="Recent activity" text="Across your account."/><div className="timeline">{events.length > 0 ? events.slice(0, 3).map((ev, i) => <Timeline key={i} color={ev.color} title={ev.title} text={ev.text} time={ev.time} />) : <p className="text-muted" style={{ padding: '24px 0', textAlign: 'center' }}>No recent activity.</p>}</div><button className="outline full" onClick={() => setView("Support centre")}>Open support centre</button></aside></div><section className="quick-section"><div><p className="eyebrow">QUICK ACTIONS</p><h2>Manage your broadcasts with ease</h2><p>Everything needed for a successful IVR campaign.</p></div><div className="quick-actions"><button onClick={create}><span className="icon-box blue"><Icon name="plus"/></span><span><strong>Create a broadcast</strong><small>Upload audio and contact list</small></span><Icon name="arrow" size={18}/></button><button onClick={() => setView("My broadcasts")}><span className="icon-box green"><Icon name="file"/></span><span><strong>View campaign reports</strong><small>Download completed results</small></span><Icon name="arrow" size={18}/></button></div></section></>;
}

function AdminPage({ view, orders, tickets, setView, select, selectTicket }: { view: string; orders: Order[]; tickets: Ticket[]; setView: (v: string) => void; select: (o: Order) => void; selectTicket: (t: Ticket) => void }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const [actFilterDate, setActFilterDate] = useState("");

  const parseDate = (dStr: string) => {
    const d = new Date(dStr);
    return isNaN(d.getTime()) ? new Date() : d;
  };

  if (view === "Broadcast management") {
    // Apply search filter
    let filtered = orders;
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(o =>
        o.name.toLowerCase().includes(term) ||
        o.customer.toLowerCase().includes(term) ||
        o.id.toLowerCase().includes(term) ||
        o.email.toLowerCase().includes(term) ||
        o.broadcastNo.toLowerCase().includes(term)
      );
    }
    // Apply status filter
    if (statusFilter !== "All statuses") {
      filtered = filtered.filter(o => o.status === statusFilter);
    }

    return <><Heading eyebrow="ADMIN PORTAL" title="Broadcast management" text="Review requests, access assets, and manage fulfillment."/><section className="panel data-panel"><div className="table-tools"><div className="search"><Icon name="search" size={16}/><input placeholder="Search order, customer, or reference" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}/></div><select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option>All statuses</option><option>Placed</option><option>In progress</option><option>Completed</option><option>Cancelled</option><option>On hold</option></select></div><OrderTable orders={filtered} admin onSelect={select} onViewCustomer={(email) => { setView("Customers"); }}/></section></>;
  }
  if (view === "Customers") return <><Heading eyebrow="ADMIN PORTAL" title="Customer directory" text="Review customers, their activity, and account standing."/><section className="panel data-panel"><table><thead><tr><th>Customer</th><th>Email</th><th>Orders</th><th>Last activity</th><th>Account</th></tr></thead><tbody>{[...new Map<string, Order>(orders.map((o: Order): [string, Order] => [o.email, o])).values()].map((o: Order) => <tr key={o.email}><td><strong>{o.customer}</strong></td><td>{o.email}</td><td>{orders.filter((x: Order) => x.email === o.email).length}</td><td>{o.created}</td><td><Badge status="Active"/></td></tr>)}</tbody></table></section></>;
  if (view === "Support desk") return <><Heading eyebrow="ADMIN PORTAL" title="Support desk" text="Prioritize, reply to, and close customer conversations."/><section className="panel data-panel"><TicketTable tickets={tickets} admin onSelect={selectTicket}/></section></>;
  
  if (view === "Activity log") {
    const events: Array<{ title: string; text: string; time: string; dateObj: Date; color: string }> = [];
    orders.forEach(o => {
      events.push({ title: `${o.broadcastNo} created`, text: `${o.customer} submitted a new broadcast request.`, time: o.created, dateObj: parseDate(o.created), color: "blue" });
      if (o.status === "Completed") events.push({ title: "Report uploaded", text: `Admin completed ${o.broadcastNo} and shared performance report.`, time: o.created, dateObj: parseDate(o.created), color: "green" });
      if (o.history) {
        o.history.forEach((h) => {
          events.push({ title: `Order ${h.status.toLowerCase()}`, text: h.reason || `Status updated for ${o.broadcastNo}`, time: new Date(h.created_at).toLocaleString(), dateObj: new Date(h.created_at), color: h.status === 'REFUNDED' ? 'refunded' : h.status === 'CANCELLED' ? 'red' : 'activity' })
        })
      }
    });
    tickets.forEach(t => events.push({ title: "Support ticket opened", text: `Customer opened ${t.id}.`, time: t.created, dateObj: parseDate(t.created), color: "blue" }));
    
    events.sort((a, b) => b.dateObj.getTime() - a.dateObj.getTime());
    
    // Group events by date string
    const filteredEvents = actFilterDate ? events.filter(e => e.dateObj.toISOString().split('T')[0] === actFilterDate) : events;
    const grouped: Record<string, typeof events> = {};
    filteredEvents.forEach(e => {
      const dStr = e.dateObj.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      if (!grouped[dStr]) grouped[dStr] = [];
      grouped[dStr].push(e);
    });

    // Chart metrics
    const customersTotal = new Set(orders.map(o => o.email)).size;
    const statuses = { placed: 0, progress: 0, hold: 0, completed: 0, cancelled: 0 };
    let totalRefunds = 0;
    orders.forEach(o => {
      if (o.status === "Placed") statuses.placed++;
      else if (o.status === "In progress") statuses.progress++;
      else if (o.status === "On hold") statuses.hold++;
      else if (o.status === "Completed") statuses.completed++;
      else if (o.status === "Cancelled") statuses.cancelled++;
      if (o.refundAmount) totalRefunds += Number(o.refundAmount);
    });
    const maxVal = Math.max(...Object.values(statuses), 1);

    return <><Heading eyebrow="ADMIN PORTAL" title="Activity dashboard" text="Audit trail and operational metrics."/><div className="activity-dashboard"><div className="chart-card"><h3>Order Distribution</h3><div className="bar-chart"><div className="bar-wrap"><div className="bar" style={{height: `${(statuses.placed/maxVal)*100}%`}}></div><span className="bar-val">{statuses.placed}</span><span className="bar-label">Placed</span></div><div className="bar-wrap"><div className="bar" style={{height: `${(statuses.progress/maxVal)*100}%`, background: '#fff3df'}}></div><span className="bar-val">{statuses.progress}</span><span className="bar-label">In progress</span></div><div className="bar-wrap"><div className="bar" style={{height: `${(statuses.hold/maxVal)*100}%`, background: '#fef3c7'}}></div><span className="bar-val">{statuses.hold}</span><span className="bar-label">On hold</span></div><div className="bar-wrap"><div className="bar" style={{height: `${(statuses.completed/maxVal)*100}%`, background: '#e8f7ef'}}></div><span className="bar-val">{statuses.completed}</span><span className="bar-label">Completed</span></div><div className="bar-wrap"><div className="bar" style={{height: `${(statuses.cancelled/maxVal)*100}%`, background: '#fff0f2'}}></div><span className="bar-val">{statuses.cancelled}</span><span className="bar-label">Cancelled</span></div></div></div><div style={{display:'flex',flexDirection:'column',gap:'20px'}}><div className="chart-card"><h3>Total Customers</h3><p className="chart-total">{customersTotal}</p><p className="chart-sub">Registered accounts</p></div><div className="chart-card"><h3>Total Refunds</h3><p className="chart-total" style={{color:'#86198f'}}>${totalRefunds.toFixed(2)}</p><p className="chart-sub">Issued to customers</p></div></div></div><section className="panel activity-log"><div className="activity-filters"><label style={{fontSize:'12px',fontWeight:700,color:'#64748b'}}>Filter by date</label><input type="date" className="date-filter" value={actFilterDate} onChange={e => setActFilterDate(e.target.value)}/>{actFilterDate && <button className="text-button" onClick={() => setActFilterDate("")}>Clear filter</button>}</div>{Object.keys(grouped).length > 0 ? Object.entries(grouped).map(([date, evs]) => <div key={date} className="event-group"><h4 className="event-group-date">{date}</h4>{evs.map((ev, i) => <Timeline key={i} color={ev.color} title={ev.title} text={ev.text} time={ev.time} />)}</div>) : <p className="text-muted" style={{ padding: '24px', textAlign: 'center' }}>No activities recorded for this period.</p>}</section></>;
  }

  const pending = orders.filter((o: Order) => o.status === "Placed").length, active = orders.filter((o: Order) => o.status === "In progress").length, done = orders.filter((o: Order) => o.status === "Completed").length;
  const onHoldCount = orders.filter((o: Order) => o.status === "On hold").length;
  const urgentTickets = tickets.filter((t: Ticket) => t.status !== "Resolved" && t.status !== "Closed" && t.priority === "High").length;

  return <><Heading eyebrow="ADMIN PORTAL" title="Operations overview" text="A live view of your broadcast operations."/><div className="metric-grid"><Metric icon="users" label="Total customers" value={new Set(orders.map((o: Order) => o.email)).size} detail="Across all accounts"/><Metric icon="clock" label="Pending orders" value={pending} detail="Orders waiting for review" warning/><Metric icon="activity" label="In progress" value={active} detail="Currently processing"/><Metric icon="chart" label="Completed" value={done} detail="Reports delivered" success/></div><div className="dashboard-grid"><section className="panel urgent"><PanelTop title="Orders needing action" text="New requests and orders that need attention." action="Manage orders" onAction={() => setView("Broadcast management")}/><div className="urgent-list">{orders.filter((o: Order) => o.status !== "Completed").slice(0,3).map((o: Order, i: number) => <div className="urgent-row" key={o.id}><span className={`priority ${i === 0 ? "new" : "due-soon"}`}>{i === 0 ? "New" : "Due soon"}</span><div><strong>{o.broadcastNo} · {o.customer}</strong><p>{o.contacts} · {o.created}</p></div><button className="outline small" onClick={() => select(o)}>Review <Icon name="arrow" size={14}/></button></div>)}</div></section><aside className="panel queue"><PanelTop title="Support queue" text="Current ticket workload." action="Open desk" onAction={() => setView("Support desk")}/><div className="queue-stats"><div><b>{tickets.filter((t: Ticket) => t.status === "Open").length}</b><span>Open</span></div><div><b>{tickets.filter((t: Ticket) => t.status === "In progress").length}</b><span>In progress</span></div><div><b>{tickets.filter((t: Ticket) => t.status === "Resolved").length}</b><span>Resolved</span></div></div>{urgentTickets > 0 ? <div className="sla"><span className="icon-box red"><Icon name="clock"/></span><div><strong>{urgentTickets} tickets nearing SLA</strong><p>High priority tickets require immediate response.</p></div></div> : <div className="sla" style={{ borderColor: '#e2e8f0', background: '#f8fafc' }}><span className="icon-box green"><Icon name="check"/></span><div><strong>All caught up!</strong><p>No high-priority tickets pending.</p></div></div>}</aside></div><section className="panel operations"><PanelTop title="Today's processing pipeline" text="Broadcast order health by status."/><div className="pipeline"><div><span className="pipe-number blue-fill">{pending}</span><strong>Placed</strong><p>Awaiting review</p></div><span className="pipe-line"/><div><span className="pipe-number yellow-fill">{active}</span><strong>In progress</strong><p>On IVR system</p></div><span className="pipe-line"/><div><span className="pipe-number green-fill">{done}</span><strong>Completed</strong><p>Reports delivered</p></div>{onHoldCount > 0 && <><span className="pipe-line"/><div><span className="pipe-number" style={{background:'#fef3c7',color:'#92400e'}}>{onHoldCount}</span><strong>On hold</strong><p>Awaiting fix</p></div></>}</div></section></>;
}

function Heading({ eyebrow, title, text, action, onAction }: { eyebrow: string; title: string; text: string; action?: string; onAction?: () => void }) { return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{text}</p></div>{action && <button className="primary" onClick={onAction}><Icon name="plus"/>{action}</button>}</div>; }
function PanelTop({ title, text, action, onAction }: { title: string; text: string; action?: string; onAction?: () => void }) { return <div className="panel-top"><div><h2>{title}</h2><p>{text}</p></div>{action && <button className="text-button" onClick={onAction}>{action}<Icon name="arrow" size={15}/></button>}</div>; }
function Metric({ icon, label, value, detail, warning, success }: { icon: string; label: string; value: number | string; detail: string; warning?: boolean; success?: boolean }) { return <article className="metric panel"><div className={`metric-icon ${warning ? "orange" : success ? "green" : "blue"}`}><Icon name={icon}/></div><p>{label}</p><h2>{value}</h2><small className={warning ? "warning-text" : success ? "success-text" : ""}>{detail}</small></article>; }
function Timeline({ color, title, text, time }: { color: string; title: string; text: string; time: string }) { return <div className="timeline-item"><span className={`timeline-dot ${color}`}><Icon name={color === "green" ? "chart" : color === "red" ? "help" : "activity"} size={13}/></span><div><strong>{title}</strong><p>{text}</p><small>{time}</small></div></div>; }
function OrderTable({ orders, onSelect, admin = false, onViewCustomer }: { orders: Order[]; onSelect: (o: Order) => void; admin?: boolean; onViewCustomer?: (email: string) => void }) { return <div className="table-wrap"><table><thead><tr><th style={{width:'70px',textAlign:'center'}}>S.No.</th><th>Broadcast</th>{admin && <th>Customer</th>}<th>Created</th><th>Contacts</th><th>Status</th><th>Action</th></tr></thead><tbody>{orders.length ? orders.map((o, idx) => <tr key={o.id}><td className="sno-col">{o.broadcastNo}</td><td><strong>{o.name}</strong><small>{o.id}</small></td>{admin && <td>{onViewCustomer ? <button className="customer-link" onClick={() => onViewCustomer(o.email)}>{o.customer}</button> : o.customer}</td>}<td>{o.created}</td><td>{o.contacts}</td><td><Badge status={o.status}/></td><td><button className="text-button row-text" onClick={() => onSelect(o)}>View</button></td></tr>) : <tr><td colSpan={admin ? 7 : 6} className="empty">No broadcast requests yet.</td></tr>}</tbody></table></div>; }
function TicketTable({ tickets, admin = false, onSelect }: { tickets: Ticket[]; admin?: boolean; onSelect: (t: Ticket) => void }) { return <div className="table-wrap"><table><thead><tr><th>Ticket</th>{admin && <th>Customer</th>}<th>Priority</th><th>Status</th><th>Created</th><th>Action</th></tr></thead><tbody>{tickets.length ? tickets.map(t => <tr key={t.id}><td><strong>{t.subject}</strong><small>{t.id} · {t.message.length > 30 ? t.message.slice(0, 27) + "..." : t.message}</small></td>{admin && <td>{t.customer}</td>}<td><span className={t.priority === "High" ? "priority overdue" : "priority new"}>{t.priority}</span></td><td><Badge status={t.status}/></td><td>{t.created}</td><td><button className="text-button row-text" onClick={() => onSelect(t)}>View</button></td></tr>) : <tr><td colSpan={admin ? 6 : 5} className="empty">No support tickets found.</td></tr>}</tbody></table></div>; }
function BroadcastModal({ onClose, onSubmit, session }: { onClose: () => void; onSubmit: (o: Order) => void; session: Session }) { const [audioFile, setAudioFile] = useState<File | null>(null); const [contactsFile, setContactsFile] = useState<File | null>(null); const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const data = new FormData(e.currentTarget); const audio = data.get("audio") as File, contacts = data.get("contacts") as File; if (!audio?.name || !contacts?.name) return alert("Please attach both the audio file and contact list."); onSubmit({ id: `BR-${1050 + Math.floor(Math.random() * 850)}`, broadcastNo: '', name: String(data.get("name")), customer: session.company || session.name, email: session.email, created: "Just now", contacts: "Pending validation", status: "Placed", schedule: String(data.get("schedule")), notes: String(data.get("notes") || ""), audioFile: audio, contactsFile: contacts }); }; return <div className="modal-backdrop" role="dialog" aria-modal="true"><form className="modal" onSubmit={submit}><div className="modal-head"><div><p className="eyebrow">NEW REQUEST</p><h2>Create a broadcast</h2><p>Upload your campaign assets for the Xpack operations team.</p></div><button type="button" className="close" onClick={onClose}><Icon name="close"/></button></div><label>Broadcast name<input name="name" required placeholder="e.g. August renewal reminder"/></label><div className="form-grid"><label>Audio file <span className="dropzone">{audioFile ? <><Icon name="check"/><b>{audioFile.name}</b><small>Ready to upload</small></> : <><Icon name="upload"/><b>Upload audio file</b><small>Maximum 25 MB</small></>}<input name="audio" type="file" required onChange={e => setAudioFile(e.target.files?.[0] || null)}/></span></label><label>Contact list <span className="dropzone">{contactsFile ? <><Icon name="check"/><b>{contactsFile.name}</b><small>Ready to upload</small></> : <><Icon name="upload"/><b>Upload contact list</b><small>Maximum 50 MB</small></>}<input name="contacts" type="file" required onChange={e => setContactsFile(e.target.files?.[0] || null)}/></span></label></div><label>Schedule<select name="schedule"><option>Start on processing</option><option>Schedule for later</option></select></label><label>Instructions <textarea name="notes" placeholder="Any instructions for our operations team?" rows={3}/></label><div className="modal-footer"><button type="button" className="outline" onClick={onClose}>Cancel</button><button className="primary">Submit broadcast <Icon name="arrow" size={16}/></button></div></form></div>; }
function TicketModal({ onClose, onSubmit, session }: { onClose: () => void; onSubmit: (t: Ticket) => void; session: Session }) { const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const d = new FormData(e.currentTarget); onSubmit({ id: `TK-${209 + Math.floor(Math.random() * 90)}`, subject: String(d.get("subject")), customer: session.company || session.name, priority: String(d.get("priority")) as "Normal" | "High", status: "Open", message: String(d.get("message")), created: "Just now" }); }; return <div className="modal-backdrop" role="dialog" aria-modal="true"><form className="modal compact-modal" onSubmit={submit}><div className="modal-head"><div><p className="eyebrow">SUPPORT</p><h2>New support ticket</h2><p>Describe your issue and we'll get back to you.</p></div><button type="button" className="close" onClick={onClose}><Icon name="close"/></button></div><label>Subject<input name="subject" required placeholder="How can we help?"/></label><label>Priority<select name="priority"><option>Normal</option><option>High</option></select></label><label>Message<textarea name="message" required rows={5} placeholder="Give us the details…"/></label><div className="modal-footer"><button type="button" className="outline" onClick={onClose}>Cancel</button><button className="primary">Create ticket <Icon name="arrow" size={16}/></button></div></form></div>; }

function StatusTimeline({ currentStatus }: { currentStatus: Status }) {
  const steps = [
    { label: "Placed", key: "Placed" },
    { label: "In progress", key: "In progress" },
    { label: "Completed", key: "Completed" }
  ];
  
  if (currentStatus === "Cancelled") steps[2] = { label: "Cancelled", key: "Cancelled" };
  if (currentStatus === "Refunded") steps[2] = { label: "Refunded", key: "Refunded" };
  if (currentStatus === "On hold") steps[1] = { label: "On hold", key: "On hold" };

  const getStatusClass = (stepKey: string, current: string) => {
    if (stepKey === current) return `active ${stepKey.toLowerCase().replace(" ", "-")}`;
    if (current === "Completed" || current === "Refunded" || (current === "In progress" && stepKey === "Placed")) return "completed";
    return "";
  };

  return (
    <div className="status-timeline">
      {steps.map((s, i) => (
        <div key={i} className={`status-timeline-node ${getStatusClass(s.key, currentStatus)}`}>
          <div className="status-timeline-dot">
            {getStatusClass(s.key, currentStatus) === "completed" ? <Icon name="check" size={12}/> : <Icon name="radio" size={10}/>}
          </div>
          <span className="status-timeline-label">{s.label}</span>
        </div>
      ))}
    </div>
  );
}

function OrderModal({ order, admin, onClose, onUpdate, onResubmit }: { order: Order; admin: boolean; onClose: () => void; onUpdate: (id: string, s: Status, payload?: { reportFile?: File, holdReason?: string, cancelReason?: string, refundReason?: string, refundAmount?: number }) => void; onResubmit: (id: string, audioFile?: File, contactsFile?: File) => void }) {
  const [status, setStatus] = useState<Status>(order.status);
  const [reportFile, setReportFile] = useState<File | null>(null);
  const [holdReason, setHoldReason] = useState(order.holdReason || "");
  const [cancelReason, setCancelReason] = useState(order.cancelReason || "");
  const [refundReason, setRefundReason] = useState(order.refundReason || "");
  const [refundAmount, setRefundAmount] = useState(order.refundAmount || "");
  const [resubmitAudio, setResubmitAudio] = useState<File | null>(null);
  const [resubmitContacts, setResubmitContacts] = useState<File | null>(null);

  const handleDownload = async (key: string) => {
    const res = await getDownloadUrl(key);
    if (res.url) {
      window.open(res.url, '_blank');
    } else {
      alert("Failed to download file.");
    }
  };

  return <div className="modal-backdrop" role="dialog" aria-modal="true"><div className="modal compact-modal"><div className="modal-head"><div><p className="eyebrow">{order.broadcastNo}</p><h2>{order.name}</h2><p>{order.customer} · {order.contacts}</p></div><button className="close" onClick={onClose}><Icon name="close"/></button></div><StatusTimeline currentStatus={order.status}/><div className="detail-grid"><div><small>Current status</small><Badge status={order.status}/></div><div><small>Schedule</small><strong>{order.schedule}</strong></div><div><small>Audio asset</small>{order.audioKey ? <button className="text-button" onClick={() => handleDownload(order.audioKey!)} title={order.audioKey}><Icon name="download" size={14}/>Download Audio</button> : <span className="text-muted">No file</span>}</div><div><small>Contact list</small>{order.contactsKey ? <button className="text-button" onClick={() => handleDownload(order.contactsKey!)} title={order.contactsKey}><Icon name="download" size={14}/>Download Contacts</button> : <span className="text-muted">No file</span>}</div></div>{order.notes && <div className="detail-note"><strong>Customer instructions</strong><p>{order.notes}</p></div>}{order.report && <div className="report-ready"><Icon name="check"/><div><strong>Performance report ready</strong><p>Report has been uploaded to this order.</p></div><button className="outline" onClick={() => handleDownload(order.reportKey!)}><Icon name="download" size={14}/>Download</button></div>}{/* Show hold reason to customer */}{!admin && order.status === "On hold" && order.holdReason && <div className="hold-reason-box"><Icon name="pause" size={18}/><div><strong>Order on hold — Action required</strong><p>{order.holdReason}</p></div></div>}{/* Cancel & Refund Info for customer */}{!admin && order.status === "Cancelled" && order.cancelReason && <div className="cancel-reason-box"><Icon name="close" size={18}/><div><strong>Order Cancelled</strong><p>{order.cancelReason}</p></div></div>}{!admin && order.status === "Refunded" && <div className="refund-box"><Icon name="check" size={18}/><div><strong>Order Refunded (Amount: ${order.refundAmount})</strong><p>{order.refundReason}</p></div></div>}{/* Customer resubmit section — only when on hold */}{!admin && order.status === "On hold" && <div className="resubmit-section"><h3>Resubmit files to resolve the issue</h3><p style={{fontSize:'12px',color:'#78350f',margin:'0 0 12px'}}>Upload a corrected audio file and/or contact list. Your order will be moved back to &quot;Placed&quot; for review.</p><div className="form-grid"><label>Audio file <span className="dropzone">{resubmitAudio ? <><Icon name="check"/><b>{resubmitAudio.name}</b><small>Ready</small></> : <><Icon name="upload"/><b>Replace audio</b><small>Optional</small></>}<input type="file" onChange={e => setResubmitAudio(e.target.files?.[0] || null)}/></span></label><label>Contact list <span className="dropzone">{resubmitContacts ? <><Icon name="check"/><b>{resubmitContacts.name}</b><small>Ready</small></> : <><Icon name="upload"/><b>Replace contacts</b><small>Optional</small></>}<input type="file" onChange={e => setResubmitContacts(e.target.files?.[0] || null)}/></span></label></div><button className="primary" onClick={() => onResubmit(order.id, resubmitAudio || undefined, resubmitContacts || undefined)} disabled={!resubmitAudio && !resubmitContacts}>Resubmit files <Icon name="arrow" size={16}/></button></div>}{admin && <div className="admin-update"><label>Update order status<select value={status} onChange={e => setStatus(e.target.value as Status)}><option>Placed</option><option>In progress</option><option>Completed</option><option>Cancelled</option><option>On hold</option><option>Refunded</option></select></label>{status === "On hold" && <label>Hold reason<textarea value={holdReason} onChange={e => setHoldReason(e.target.value)} rows={3} placeholder="Describe the issue..."/></label>}{status === "Completed" && <label>Performance report<input type="file" accept=".csv,.pdf,.zip" onChange={e => setReportFile(e.target.files?.[0] || null)}/></label>}{status === "Cancelled" && <label>Cancellation reason<textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)} rows={3} placeholder="Why is this cancelled?"/></label>}{status === "Refunded" && <><label>Refund amount ($)<input type="number" step="0.01" value={refundAmount} onChange={e => setRefundAmount(e.target.value)} placeholder="0.00"/></label><label>Refund reason<textarea value={refundReason} onChange={e => setRefundReason(e.target.value)} rows={2} placeholder="Reason for refund"/></label></>}<button className="primary" onClick={() => onUpdate(order.id, status, { reportFile: reportFile || undefined, holdReason, cancelReason, refundReason, refundAmount: Number(refundAmount) })}>Save update</button></div>}<div className="modal-footer"><button className="outline" onClick={onClose}>Close</button></div></div></div>;
}
function TicketViewModal({ ticket, admin, onClose, onUpdate }: { ticket: Ticket; admin: boolean; onClose: () => void; onUpdate: (id: string, s: TicketStatus, reply?: string) => void }) { const [status, setStatus] = useState<TicketStatus>(ticket.status); const [reply, setReply] = useState<string>(ticket.reply || ""); return <div className="modal-backdrop" role="dialog" aria-modal="true"><div className="modal compact-modal"><div className="modal-head"><div><p className="eyebrow">{ticket.id}</p><h2>{ticket.subject}</h2><p>{ticket.customer} · {ticket.created}</p></div><button className="close" onClick={onClose}><Icon name="close"/></button></div><div className="detail-grid"><div><small>Current status</small><Badge status={ticket.status}/></div><div><small>Priority</small><span className={ticket.priority === "High" ? "priority overdue" : "priority new"}>{ticket.priority}</span></div></div><div className="detail-note"><strong>Customer Message</strong><p>{ticket.message}</p></div>{ticket.reply && !admin && <div className="detail-note" style={{background: '#f0f9ff', borderColor: '#bae6fd'}}><strong>Admin Reply</strong><p>{ticket.reply}</p></div>}{admin && <div className="admin-update"><label>Update ticket status<select value={status} onChange={e => setStatus(e.target.value as TicketStatus)}><option>Open</option><option>In progress</option><option>Resolved</option></select></label><label>Reply to customer<textarea value={reply} onChange={e => setReply(e.target.value)} rows={3} placeholder="Type your response here..."/></label><button className="primary" onClick={() => onUpdate(ticket.id, status, reply)}>Save update</button></div>}<div className="modal-footer"><button className="outline" onClick={onClose}>Close</button></div></div></div>; }
