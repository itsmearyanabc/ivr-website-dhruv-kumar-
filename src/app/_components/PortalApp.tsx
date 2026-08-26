/* eslint-disable @typescript-eslint/no-explicit-any */
// cspell:ignore Xpack xpack Dhruv Kaveri Proximo supabase SUPABASE
"use client";

import React, { FormEvent, useCallback, useEffect, useState } from "react";
import { signUp, signIn, signOut, getUserSession } from "@/app/actions/auth";
import { getBroadcasts, createBroadcast, updateBroadcastStatus, getDownloadUrl, resubmitFiles, getBroadcastContacts } from "@/app/actions/broadcasts";
import { getTickets, createTicket, updateTicketStatus } from "@/app/actions/tickets";
import { getSystemSettings, updatePricePerCall } from "@/app/actions/settings";
import { getUserBalance, getUserTransactions, getAllTransactions } from "@/app/actions/transactions";
import { getAllUsers, adminAddFunds, adminSetUserPassword, adminSetUserActive, updateMyProfile, changeMyPassword, requestPasswordHelp } from "@/app/actions/users";
import { impersonateUser, stopImpersonation, getImpersonationState } from "@/app/actions/impersonate";
import { 
  getCategoriesWithServices, 
  getAllCategoriesAndServices, 
  createCategory, 
  deleteCategory, 
  createService,
  deleteService,
  updateCategory,
  updateService,
  getCustomerPricing,
  setCustomerPricing,
  Category,
  Service,
  CustomerServiceRow
} from "@/app/actions/categoriesServices";
import { getTopupPendingCount } from "@/app/actions/topups";
import { Icon, Badge, formatStatus, Heading, PanelTop, Metric, Timeline } from "@/app/_components/ui";
import AdminShell, { baseView, TabStrip } from "@/app/_components/admin/AdminShell";
import { TopupRequestsView, AdminSettingsView } from "@/app/_components/admin/PaymentsAdmin";
import StatisticsGraph from "@/app/_components/admin/StatisticsGraph";
import ActivityLog from "@/app/_components/admin/ActivityLog";
import AddFunds from "@/app/_components/customer/AddFunds";
import { UPLOAD_LIMITS, formatFileSize, describeLimit } from "@/lib/uploads";
import { calculateFailedCallRefund } from "@/lib/refunds";
import {
  countNumbers,
  isQuantityPriced,
  maxQuantityOf,
  minQuantityOf,
  quoteTotal,
  unitRate,
  validateQuantity,
} from "@/lib/quantity";
import { uploadFile, uploadFiles } from "@/lib/uploadClient";

/**
 * `xlsx` is loaded on demand, not imported at the top of the module.
 *
 * It is close to a megabyte of parser, and a static import puts all of it in the first
 * JavaScript every visitor downloads - to sign in, to look at their orders, to add funds -
 * when it is only ever needed by the one customer who attaches a spreadsheet. Deferring it
 * moves that cost to the moment a workbook is actually opened.
 */
async function loadXLSX() {
  return import("xlsx");
}

type Role = "customer" | "admin";
type Status = "Placed" | "In progress" | "Completed" | "Partial" | "Cancelled" | "On hold" | "Refunded";
type TicketStatus = "Open" | "In progress" | "Resolved" | "Closed";
type Session = { role: Role; name: string; email: string; company?: string };
type OrderHistory = { status: string; reason?: string; created_at: string };
type Order = { 
  id: string; 
  broadcastNo: string; 
  name: string; 
  customer: string; 
  email: string; 
  created: string; 
  contacts: string; 
  status: Status; 
  schedule: string; 
  notes?: string; 
  report?: boolean; 
  audioKey?: string; 
  contactsKey?: string; 
  reportKey?: string; 
  audioFile?: File; 
  contactsFile?: File; 
  holdReason?: string; 
  cancelReason?: string; 
  refundReason?: string; 
  refundAmount?: number; 
  history?: OrderHistory[];
  categoryName?: string;
  serviceName?: string;
  voiceType?: 'MALE' | 'FEMALE';
  contactsInputType?: 'FILE' | 'MANUAL';
  manualContacts?: string;
  contactCount?: number;
  charge?: number;
  adminComment?: string;
  partialRefundAmount?: number;
  deliveredCalls?: number;
  failedCalls?: number;
};
type Ticket ={ id: string; subject: string; customer: string; priority: "Normal" | "High"; status: TicketStatus; message: string; created: string; reply?: string; };

const initialOrders: Order[] = [];
const initialTickets: Ticket[] = [];

/**
 * `reports.broadcast_id` carries a UNIQUE constraint, so PostgREST resolves the embed as a
 * to-one relationship and returns a bare object - not the single-element array this used to
 * index into. `reports[0]` was therefore always undefined, which is why a completed order
 * never showed its report to the customer even after the admin uploaded one.
 * Accept either shape so the mapping survives a future relationship change too.
 */
function reportFileKey(reports: any): string | undefined {
  if (!reports) return undefined;
  const row = Array.isArray(reports) ? reports[0] : reports;
  return row?.file_key || undefined;
}

/** What every modal submit handler hands back so the form can stay open and explain itself. */
type SubmitResult = { ok: boolean; error?: string };

/**
 * Upload progress bar. Files go straight to Supabase Storage, so on a slow connection a large
 * file leaves the operator staring at a disabled button for a while - this says what is
 * happening and how far along it is.
 */
function UploadProgress({ percent, label, active }: { percent: number; label: string; active: boolean }) {
  if (!active) return null;
  return (
    <div className="upload-progress" role="status" aria-live="polite">
      <div className="upload-progress-head">
        <span>{label || "Uploading…"}</span>
        <strong>{percent}%</strong>
      </div>
      <div className="upload-progress-track">
        <div className="upload-progress-bar" style={{ width: `${Math.max(4, percent)}%` }} />
      </div>
    </div>
  );
}

/** Module scope on purpose: reading the clock is impure and must not sit in a render path. */
function isInTheFuture(value: string): boolean {
  const parsed = new Date(value).getTime();
  return !isNaN(parsed) && parsed > Date.now();
}


/**
 * Turns a thrown Server Action into something an operator can act on.
 *
 * A Server Action that throws (rather than returning `{ error }`) used to reject silently:
 * the caller had already closed the modal and nothing caught the rejection, so the screen
 * simply never changed. The 413 is called out by name because it is the one an operator can
 * fix themselves by picking a smaller file.
 */
function describeActionError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? "");

  if (/body exceeded|413|payload too large|entity too large/i.test(raw)) {
    return "That file is too large to upload. Please compress it or split it, then try again.";
  }
  if (/fetch failed|networkerror|failed to fetch|load failed/i.test(raw)) {
    return "Lost connection to the server. Check your network and try again — nothing was saved.";
  }
  return raw
    ? `The server rejected this request: ${raw}`
    : "Something went wrong and the change was not saved. Please try again.";
}

function mapBroadcast(b: any, index: number): Order {
  const reportKey = reportFileKey(b.reports);
  return {
    id: b.reference_no,
    broadcastNo: `BR-${index + 1}`,
    name: b.name,
    customer: b.customer,
    email: b.email,
    created: new Date(b.created_at).toLocaleString(),
    contacts: b.contact_count ? `${b.contact_count} contacts` : (b.email || 'Unknown'),
    status: formatStatus(b.status) as Status,
    schedule: b.scheduled_for ? new Date(b.scheduled_for).toLocaleString() : 'Start on processing',
    notes: b.description,
    audioKey: b.audio_key,
    contactsKey: b.contacts_key,
    reportKey,
    report: !!reportKey,
    holdReason: b.hold_reason || '',
    cancelReason: b.cancel_reason || '',
    refundReason: b.refund_reason || '',
    refundAmount: b.refund_amount,
    history: b.history || [],
    categoryName: b.category_name,
    serviceName: b.service_name,
    voiceType: b.voice_type,
    contactsInputType: b.contacts_input_type,
    // Not in the list payload any more - see BROADCAST_LIST_COLUMNS. The order modal fetches
    // it when it opens.
    manualContacts: undefined,
    contactCount: b.contact_count,
    charge: b.charge ? Number(b.charge) : 0,
    adminComment: b.admin_comment,
    partialRefundAmount: b.partial_refund_amount,
    deliveredCalls: b.delivered_calls ?? undefined,
    failedCalls: b.failed_calls ?? undefined
  };
}

/**
 * The thin bar across the top of the panel while something is loading.
 *
 * Every screen here is filled by a server action after the page has already rendered, so
 * without this the panel sits looking finished but empty and the only signal that work is in
 * flight is that the numbers are wrong. Indeterminate on purpose: these are round trips to
 * Supabase, and there is no honest percentage to report.
 *
 * It lingers briefly after the last request finishes so a fast reply still registers as
 * having happened rather than flickering.
 */
function TopProgressBar({ active }: { active: boolean }) {
  // Always mounted, shown by a class. Fading a permanent element out in CSS avoids holding a
  // second copy of `active` in state and setting it from an effect, which would re-render the
  // whole panel twice for every request it is only trying to report on.
  return (
    <div className={`top-progress ${active ? "on" : "off"}`} role="status" aria-live="polite">
      <span className="sr-only">{active ? "Loading" : ""}</span>
    </div>
  );
}

export default function PortalApp({ portal }: { portal: Role }) {
  useEffect(() => {
    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        window.location.reload();
      }
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, []);
  const VIEW_KEY = `xpack_view_${portal}`;
  const [session, setSession] = useState<Session | null>(null);
  const [isSessionLoading, setIsSessionLoading] = useState(true);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [view, setView] = useState(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem(VIEW_KEY) || "Dashboard";
    }
    return "Dashboard";
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(VIEW_KEY, view);
    }
  }, [view, VIEW_KEY]);
  const [orders, setOrders] = useState<Order[]>(initialOrders);
  const [tickets, setTickets] = useState<Ticket[]>(initialTickets);
  const [toast, setToast] = useState("");
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [showTicket, setShowTicket] = useState(false);
  const [selected, setSelected] = useState<Order | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [balance, setBalance] = useState(0);
  const [usersList, setUsersList] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [price, setPrice] = useState("0.25");
  const [pendingTopups, setPendingTopups] = useState(0);

  /**
   * How many server round trips are in flight, so the progress bar can reflect all of them.
   *
   * A counter rather than a boolean: several refreshes overlap routinely - approving a top-up
   * reloads the queue, the customer list and the ledger at once - and a boolean would be
   * switched off by whichever finished first, hiding the bar while the rest were still
   * running.
   */
  const [pending, setPending] = useState(0);
  const track = useCallback(async function <T>(work: Promise<T>): Promise<T> {
    setPending(n => n + 1);
    try {
      return await work;
    } finally {
      setPending(n => n - 1);
    }
  }, []);

  const refreshUsers = async () => {
    const data = await track(getAllUsers());
    if (data) setUsersList(data);
  };

  const refreshBroadcasts = async () => {
    const { data: bData } = await track(getBroadcasts());
    if (bData && bData.length > 0) {
      setOrders(bData.map((b: any, i: number) => mapBroadcast(b, i)));
    } else {
      setOrders([]);
    }
  };

  const refreshBalance = async () => {
    const bal = await track(getUserBalance());
    setBalance(bal);
  };

  const refreshPendingTopups = async () => {
    setPendingTopups(await track(getTopupPendingCount()));
  };

  const fetchData = async (currentSession: Session) => {
    setIsDataLoading(true);
    const [settings, bRes, tRes, usersData, txAdminData, userBal, txUserData, topupCount] = await track(Promise.all([
      getSystemSettings(),
      getBroadcasts(),
      getTickets(),
      currentSession.role === "admin" ? getAllUsers() : Promise.resolve(null),
      currentSession.role === "admin" ? getAllTransactions() : Promise.resolve(null),
      currentSession.role !== "admin" ? getUserBalance() : Promise.resolve(null),
      currentSession.role !== "admin" ? getUserTransactions() : Promise.resolve(null),
      currentSession.role === "admin" ? getTopupPendingCount() : Promise.resolve(0)
    ]));

        if (settings) setPrice(settings.price_per_call);

    if (currentSession.role === "admin") {
      if (usersData) setUsersList(usersData);
      if (txAdminData) setTransactions(txAdminData);
      setPendingTopups(topupCount || 0);
    } else {
      setBalance(userBal || 0);
      if (txUserData) setTransactions(txUserData);
    }

    if (bRes?.data) setOrders(bRes.data.map((b: any, i: number) => mapBroadcast(b, i)));
    if (tRes?.data) setTickets(tRes.data.map((t: any) => ({
      id: t.reference_no,
      subject: t.subject,
      customer: t.customer,
      priority: t.priority === 'HIGH' ? 'High' : 'Normal',
      status: formatStatus(t.status) as TicketStatus,
      message: t.message || '',
      created: new Date(t.created_at).toLocaleString(),
      reply: t.reply,
    })));
    setIsDataLoading(false);
  };

  useEffect(() => {
    let mounted = true;
    
    async function initSession() {
      const { session: serverSession } = await track(getUserSession());
      if (mounted) {
        if (serverSession) {
          setSession(serverSession as Session);
          fetchData(serverSession as Session);
        }
        setIsSessionLoading(false);
      }
    }

    initSession();
    return () => { mounted = false; };
  }, []);

  const login = (s: Session) => { setSession(s); setView("Dashboard"); sessionStorage.setItem(VIEW_KEY, 'Dashboard'); fetchData(s); };
  const logout = async () => { await signOut(); setSession(null); setOrders(initialOrders); setTickets(initialTickets); sessionStorage.removeItem(VIEW_KEY); };
  
  const message = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 4500); };
  
  const addOrder = async (orderPayload: any): Promise<SubmitResult> => {
    const formData = new FormData();
    formData.append("categoryId", orderPayload.categoryId || "");
    formData.append("categoryName", orderPayload.categoryName || "");
    formData.append("serviceId", orderPayload.serviceId || "");
    formData.append("serviceName", orderPayload.serviceName || "");
    formData.append("voiceType", orderPayload.voiceType || "MALE");
    formData.append("notes", orderPayload.notes || "");
    formData.append("contactsInputType", orderPayload.contactsInputType || "FILE");
    formData.append("manualContacts", orderPayload.manualContacts || "");
    formData.append("contactCount", String(orderPayload.contactCount || 0));
    formData.append("charge", String(orderPayload.charge || 0));
    formData.append("schedule", orderPayload.schedule || "Start on processing");
    formData.append("audioInputMethod", orderPayload.audioInputMethod || "FILE");
    formData.append("ttsText", orderPayload.ttsText || "");
    // Files are already in Supabase Storage - only their keys travel through the action.
    formData.append("audioKey", orderPayload.audioKey || "");
    formData.append("contactsKey", orderPayload.contactsKey || "");

    // The modal stays open until the order is actually accepted. Closing first meant a
    // rejected upload left the customer looking at a dashboard with no order and no reason.
    try {
      const { error } = await createBroadcast(formData);
      if (error) return { ok: false, error };
    } catch (e) {
      return { ok: false, error: describeActionError(e) };
    }

    setShowBroadcast(false);
    message("Broadcast request created successfully.");
    await refreshBroadcasts();
    await refreshBalance();
    return { ok: true };
  };

  const addTicket = async (newTicket: Ticket): Promise<SubmitResult> => {
    const formData = new FormData();
    formData.append("subject", newTicket.subject);
    formData.append("priority", newTicket.priority.toUpperCase());
    formData.append("message", newTicket.message);

    let data: any;
    try {
      const res = await createTicket(formData);
      if (res.error) return { ok: false, error: res.error };
      data = res.data;
    } catch (e) {
      return { ok: false, error: describeActionError(e) };
    }

    setShowTicket(false);
    if (data) {
      message("Ticket submitted.");
      setTickets([{
        id: data.reference_no,
        subject: data.subject,
        customer: session?.company || session?.name || 'Customer',
        priority: data.priority === 'HIGH' ? 'High' : 'Normal',
        status: formatStatus(data.status) as TicketStatus,
        message: data.body || newTicket.message,
        created: new Date(data.created_at).toLocaleString()
      }, ...tickets]);
    }
    return { ok: true };
  };

  const updateOrder = async (
    id: string, 
    status: Status, 
    payload?: { 
      reportKey?: string;
      holdReason?: string;
      cancelReason?: string; 
      refundReason?: string; 
      refundAmount?: number;
      partialRefundAmount?: number;
      confirmPartialRefundAmount?: number;
      deliveredCalls?: number;
      failedCalls?: number;
      adminComment?: string;
    }
  ): Promise<SubmitResult> => {
    const dbStatus = status.toUpperCase().replace(' ', '_');
    const formData = new FormData();
    formData.append("id", id);
    formData.append("status", dbStatus);
    if (payload?.reportKey) formData.append("reportKey", payload.reportKey);
    if (payload?.holdReason) formData.append("holdReason", payload.holdReason);
    if (payload?.cancelReason) formData.append("cancelReason", payload.cancelReason);
    if (payload?.refundReason) formData.append("refundReason", payload.refundReason);
    if (payload?.refundAmount) formData.append("refundAmount", payload.refundAmount.toString());
    if (payload?.partialRefundAmount !== undefined) formData.append("partialRefundAmount", payload.partialRefundAmount.toString());
    if (payload?.confirmPartialRefundAmount !== undefined) formData.append("confirmPartialRefundAmount", payload.confirmPartialRefundAmount.toString());
    // Sent as counts, not as an amount: the server derives the refund from these so the
    // figure that moves money is computed in one place.
    if (payload?.deliveredCalls !== undefined) formData.append("deliveredCalls", payload.deliveredCalls.toString());
    if (payload?.failedCalls !== undefined) formData.append("failedCalls", payload.failedCalls.toString());
    if (payload?.adminComment) formData.append("adminComment", payload.adminComment);

    try {
      const { error } = await updateBroadcastStatus(formData);
      if (error) return { ok: false, error };
    } catch (e) {
      return { ok: false, error: describeActionError(e) };
    }

    setSelected(null);
    const uploaded = Boolean(payload?.reportKey);
    message(
      status === "Completed"
        ? uploaded
          ? "Broadcast completed and the report is now available to the customer."
          : "Broadcast marked completed. No report file was attached."
        : status === "On hold"
          ? "Broadcast placed on hold."
          : `Broadcast updated to ${status}.`
    );
    await refreshBroadcasts();
    await refreshBalance();
    return { ok: true };
  };

  const handleResubmit = async (id: string, audioKey?: string, contactsKey?: string): Promise<SubmitResult> => {
    const formData = new FormData();
    formData.append("id", id);
    if (audioKey) formData.append("audioKey", audioKey);
    if (contactsKey) formData.append("contactsKey", contactsKey);

    try {
      const { error } = await resubmitFiles(formData);
      if (error) return { ok: false, error };
    } catch (e) {
      return { ok: false, error: describeActionError(e) };
    }

    setSelected(null);
    message("Files resubmitted successfully. Your broadcast has been moved back to Placed.");
    await refreshBroadcasts();
    return { ok: true };
  };

  const updateTicket = async (id: string, status: TicketStatus, reply?: string): Promise<SubmitResult> => {
    const dbStatus = status.toUpperCase().replace(' ', '_');
    try {
      const { error } = await updateTicketStatus(id, dbStatus, reply);
      if (error) return { ok: false, error };
    } catch (e) {
      return { ok: false, error: describeActionError(e) };
    }

    setSelectedTicket(null);
    message(status === "Resolved" ? "Ticket resolved and reply sent." : `Ticket updated to ${status}.`);
    setTickets(tickets.map(t => t.id === id ? { ...t, status, reply: reply || t.reply } : t));
    return { ok: true };
  };

  if (isSessionLoading) return <div className="boot-screen"><TopProgressBar active /><div className="loader"/><p>Loading your panel…</p></div>;
  if (!session) return <><TopProgressBar active={pending > 0} /><Auth portal={portal} onLogin={login} /></>;
  if (session.role !== portal) return <WrongPortal role={session.role} portal={portal} onSignOut={logout} />;

  const nav: Array<[string, string]> = [["Dashboard", "grid"], ["New broadcast", "plus"], ["My broadcasts", "radio"], ["Add funds", "indian-rupee"], ["Support", "help"], ["Settings", "settings"]];

  const goTo = (label: string) => {
    setIsMobileMenuOpen(false);
    if (label === "New broadcast") { setShowBroadcast(true); return; }
    setView(label);
    setSelected(null);
    setSelectedTicket(null);
    setSelectedCustomer(null);
  };

  const overlays = (
    <>
      <TopProgressBar active={pending > 0} />
      {showBroadcast && <BroadcastModal onClose={() => setShowBroadcast(false)} onSubmit={addOrder} session={session} balance={balance} price={price} />}
      {showTicket && <TicketModal onClose={() => setShowTicket(false)} onSubmit={addTicket} session={session}/>}
      {selected && <OrderModal order={selected} admin={session.role === "admin"} onClose={() => setSelected(null)} onUpdate={updateOrder} onResubmit={handleResubmit}/>}
      {selectedTicket && <TicketViewModal ticket={selectedTicket} admin={session.role === "admin"} onClose={() => setSelectedTicket(null)} onUpdate={updateTicket}/>}
      {selectedCustomer && <CustomerProfileModal customer={selectedCustomer} orders={orders.filter(o => o.email?.toLowerCase() === String(selectedCustomer.email || '').toLowerCase())} onClose={() => setSelectedCustomer(null)} refreshData={refreshUsers}/>}
      {showLogoutConfirm && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal confirm-modal">
            <h2>Confirm logout</h2>
            <p>Are you sure you want to sign out?</p>
            <div className="confirm-actions">
              <button className="outline" onClick={() => setShowLogoutConfirm(false)}>Cancel</button>
              <button className="primary" onClick={() => { setShowLogoutConfirm(false); logout(); }}>Sign out</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="toast"><span><Icon name="check" size={16}/></span>{toast}</div>}
    </>
  );

  // The admin console runs on its own top-navigation chrome. The customer panel keeps the
  // sidebar shell below, unchanged.
  if (session.role === "admin") {
    return (
      <AdminShell
        view={view}
        onNavigate={goTo}
        userName={session.name}
        pendingTopups={pendingTopups}
        onLogout={() => setShowLogoutConfirm(true)}
      >
        <AdminPage
          view={view}
          orders={orders}
          tickets={tickets}
          users={usersList}
          transactions={transactions}
          price={price}
          setPrice={setPrice}
          setView={setView}
          select={setSelected}
          selectTicket={setSelectedTicket}
          onRefreshBroadcasts={refreshBroadcasts}
          isDataLoading={isDataLoading}
          onTopupsChanged={refreshPendingTopups}
          onRefreshUsers={refreshUsers}
          onSelectCustomer={setSelectedCustomer}
        />
        {overlays}
      </AdminShell>
    );
  }

  return (
    <main className="app-shell">
      <ImpersonationBanner />
      <div className={`sidebar-backdrop ${isMobileMenuOpen ? 'mobile-open' : ''}`} onClick={() => setIsMobileMenuOpen(false)}></div>
      <aside className={`sidebar ${isMobileMenuOpen ? 'mobile-open' : ''}`}>
        <div className="brand"><span className="brand-mark"><b>X</b></span><span>XPACK<em>PANEL</em></span></div>
        <div className="workspace"><span className="company-dot">{session.name.slice(0, 1).toUpperCase()}</span><span>{session.company || session.name}</span></div>
        <nav>{nav.map(([label, icon]) => <button key={label} onClick={() => goTo(label)} className={view === label ? "active" : ""}><Icon name={icon}/>{label}</button>)}</nav>
        <div className="sidebar-bottom">
          <div className="help-card">
            <span className="help-symbol">?</span>
            <div><strong>Need help?</strong><p>Our team is here for you.</p><button onClick={() => goTo("Support")}>Open support <Icon name="arrow" size={13}/></button></div>
          </div>
          <div className="user-card">
            <span className="avatar">{session.name.split(" ").map(x => x[0]).join("").slice(0,2)}</span>
            <div><strong>{session.name}</strong><p>Customer account</p></div>
            <button title="Sign out" onClick={() => setShowLogoutConfirm(true)}><Icon name="logout"/></button>
          </div>
        </div>
      </aside>
      <section className="content">
        <header>
          <button className="mobile-menu-btn" onClick={() => setIsMobileMenuOpen(true)}>
            <Icon name="menu" size={24} />
          </button>
          <div className="mobile-brand">XPACK</div>
          <div className="header-actions">
            <button className="balance-chip" onClick={() => goTo("Add funds")} title="Add funds">
              <Icon name="indian-rupee" size={14}/>
              <b>₹{balance.toFixed(2)}</b>
              <span className="balance-chip-plus"><Icon name="plus" size={12}/></span>
            </button>
            <div className="header-user">
              <span className="header-avatar">{session.name.split(" ").map(x => x[0]).join("").slice(0,2)}</span>
              <span className="header-name">{session.name}</span>
            </div>
            <button className="header-logout" onClick={() => setShowLogoutConfirm(true)}><Icon name="logout" size={15}/><span>Logout</span></button>
          </div>
        </header>
        <div className="page">
          {/* getBroadcasts and getTickets already scope to the signed-in user server-side, so
              these are display filters only - matched case-insensitively because an email
              typed with different casing used to hide a customer's own records. */}
          <CustomerPage
            view={view}
            orders={orders.filter(o => String(o.email || '').toLowerCase() === session.email.toLowerCase())}
            tickets={tickets}
            transactions={transactions}
            setView={setView}
            create={() => setShowBroadcast(true)}
            ticket={() => setShowTicket(true)}
            select={setSelected}
            selectTicket={setSelectedTicket}
            session={session}
            balance={balance}
            onCredited={refreshBalance}
            onProfileSaved={({ name, company }) => setSession(s => (s ? { ...s, name, company } : s))}
          />
        </div>
      </section>
      {overlays}
    </main>
  );
}

function ImpersonationBanner() {
  const [impersonating, setImpersonating] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    getImpersonationState().then((state) => {
      if (mounted) setImpersonating(!!state.impersonating);
    });
    return () => { mounted = false; };
  }, []);

  if (!impersonating) return null;

  const handleReturn = async () => {
    setBusy(true);
    const res = await stopImpersonation();
    if (res?.error) {
      alert(res.error);
      setBusy(false);
      return;
    }
    window.location.href = '/admin';
  };

  return (
    <div className="impersonation-banner">
      <Icon name="lock" size={16}/>
      <span>You are viewing this account as an administrator.</span>
      <button onClick={handleReturn} disabled={busy}>
        {busy ? 'Returning…' : 'Return to admin console'}
      </button>
    </div>
  );
}

/**
 * Per-customer pricing and visibility for one customer.
 *
 * A service is global by default: everyone sees it, at one price. This panel carves out
 * exceptions for a single customer - a different price, or hidden from their catalogue
 * entirely. Rows with no exception are shown too, so the operator can see the whole
 * catalogue as this customer sees it without cross-referencing anything.
 */
function CustomerPricingPanel({ customer }: { customer: any }) {
  const [rows, setRows] = useState<CustomerServiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  // Price text is held per row while it is being typed, so one edit does not re-render as
  // the saved value mid-keystroke.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getCustomerPricing(customer.id);
    setLoading(false);
    if (res?.error) return setError(res.error);
    setRows(res.data || []);
    setError("");
  }, [customer.id]);

  useEffect(() => { load(); }, [load]);

  const save = async (row: CustomerServiceRow, price: number | null, isHidden: boolean) => {
    setSavingId(row.service_id);
    setError("");
    const res = await setCustomerPricing(customer.id, row.service_id, price, isHidden);
    setSavingId(null);

    if (res?.error) return setError(res.error);

    // Update in place rather than refetching the whole catalogue - the operator is usually
    // editing several rows in a row and a full reload loses their scroll position.
    setRows(current => current.map(r =>
      r.service_id === row.service_id ? { ...r, override_price: price, is_hidden: isHidden } : r
    ));
    setDrafts(current => {
      const next = { ...current };
      delete next[row.service_id];
      return next;
    });
  };

  const savePrice = (row: CustomerServiceRow) => {
    const raw = (drafts[row.service_id] ?? "").trim();
    if (raw === "") return save(row, null, row.is_hidden);

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return setError(`"${raw}" is not a valid price. Enter a number, or clear the box to use the standard price.`);
    }
    return save(row, parsed, row.is_hidden);
  };

  if (loading) return <div className="pricing-panel"><p className="text-muted">Loading the service catalogue…</p></div>;

  return (
    <div className="pricing-panel">
      <h4>Pricing for this customer</h4>
      <p className="pricing-note">
        Prices are for the quantity shown beside them, not per order. Leave a price empty to
        charge the standard rate. Hiding a service removes it from this
        customer&apos;s order screen entirely. Changes apply to their next order — orders already
        placed keep the price they were charged.
      </p>

      {error && <p className="form-error">{error}</p>}

      {rows.length === 0 ? (
        <p className="text-muted">No services have been created yet.</p>
      ) : (
        <div className="table-wrap pricing-table">
          <table>
            <thead>
              <tr><th>Service</th><th>Standard</th><th>This customer pays</th><th>Visible</th></tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const busy = savingId === row.service_id;
                const draft = drafts[row.service_id] ?? (row.override_price !== null ? String(row.override_price) : "");
                const effective = row.override_price !== null ? row.override_price : row.base_price;

                return (
                  <tr key={row.service_id} className={row.is_hidden ? "row-hidden" : ""}>
                    <td>
                      <strong>{row.service_name}</strong>
                      <small>{row.category_name}{row.service_active ? "" : " · inactive globally"}</small>
                    </td>
                    <td>
                      <span className="text-muted">₹{row.base_price.toFixed(2)}</span>
                      {/* Without the unit an operator cannot tell whether Rs 11 buys one
                          number or a hundred, and would set the custom price on the wrong
                          basis. */}
                      {row.unit_quantity ? (
                        <small className="pricing-effective">per {row.unit_quantity.toLocaleString("en-IN")}</small>
                      ) : null}
                    </td>
                    <td>
                      <div className="pricing-cell">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder={row.base_price.toFixed(2)}
                          value={draft}
                          disabled={busy}
                          onChange={e => setDrafts(d => ({ ...d, [row.service_id]: e.target.value }))}
                          onKeyDown={e => { if (e.key === "Enter") savePrice(row); }}
                        />
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => savePrice(row)}
                        >
                          {busy ? "Saving…" : "Save"}
                        </button>
                      </div>
                      {row.override_price !== null && (
                        <small className="pricing-effective">
                          Custom{row.unit_quantity ? ` per ${row.unit_quantity.toLocaleString("en-IN")}` : ""} · was ₹{row.base_price.toFixed(2)}
                        </small>
                      )}
                      {row.override_price === null && effective !== row.base_price && (
                        <small className="pricing-effective">Standard</small>
                      )}
                    </td>
                    <td>
                      <button
                        className={`text-button ${row.is_hidden ? "row-text-muted" : ""}`}
                        disabled={busy}
                        onClick={() => save(row, row.override_price, !row.is_hidden)}
                      >
                        <Icon name={row.is_hidden ? "close" : "check"} size={14}/>
                        {row.is_hidden ? "Hidden" : "Visible"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CustomerProfileModal({ customer, orders, onClose, refreshData }: { customer: any, orders: Order[], onClose: () => void, refreshData?: () => void }) {
  const [addingFunds, setAddingFunds] = useState(false);
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  // Credits applied in this modal, held locally. Writing straight onto the `customer` prop
  // mutated the row inside the parent's usersList without telling React, so the directory
  // behind the modal showed a stale balance until a full reload.
  const [creditedHere, setCreditedHere] = useState(0);

  const displayedBalance = (Number(customer.balance) || 0) + creditedHere;

  const handleAddFunds = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setError("Please enter a valid positive amount.");
      return;
    }

    if (!window.confirm(`Are you sure you want to add ₹${numAmount} to this account?`)) {
      return;
    }

    setLoading(true);
    const res = await adminAddFunds(customer.id, numAmount);
    setLoading(false);

    if (res?.error) {
      setError(res.error);
    } else {
      setSuccess(`Successfully added ₹${numAmount.toFixed(2)} to ${customer.full_name || customer.company_name}'s wallet!`);
      setAmount("");
      setCreditedHere(credited => credited + numAmount);
      if (refreshData) refreshData();

      setTimeout(() => {
        setAddingFunds(false);
        setSuccess("");
      }, 2000);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal compact-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div><p className="eyebrow">CUSTOMER</p><h2>{customer.full_name || customer.company_name}</h2><p>{customer.email}</p></div>
          <button className="close" onClick={onClose}><Icon name="close"/></button>
        </div>

        <div className="profile-head">
          <span className="profile-avatar">{(customer.full_name?.slice(0,1) || customer.company_name?.slice(0,1) || "C").toUpperCase()}</span>
          <div>
            <strong>{customer.full_name || customer.company_name}</strong>
            <p>{customer.email}</p>
            <Badge status={customer.is_active ? "Active" : "Closed"}/>
          </div>
        </div>

        <div className="profile-stats">
          <div className="chart-card"><h3>Wallet balance</h3><p className="chart-total">₹{displayedBalance.toFixed(2)}</p></div>
          <div className="chart-card"><h3>Total broadcasts</h3><p className="chart-total">{orders.length}</p></div>
        </div>

        {addingFunds ? (
          <div className="fund-box">
            <h4>Add funds manually</h4>
            <form onSubmit={handleAddFunds} className="fund-form">
              <div className="fund-input">
                <input
                  type="number"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="Enter amount (e.g. 500)"
                  disabled={loading}
                />
                {error && <p className="form-error">{error}</p>}
                {success && <p className="form-success">{success}</p>}
              </div>
              <button type="submit" className="primary" disabled={loading}>{loading ? 'Adding…' : 'Deposit'}</button>
              <button type="button" className="outline" onClick={() => setAddingFunds(false)} disabled={loading}>Cancel</button>
            </form>
          </div>
        ) : (
          <button className="primary" onClick={() => setAddingFunds(true)}><Icon name="indian-rupee" size={16}/> Add funds</button>
        )}

        <CustomerPricingPanel customer={customer} />

        <div className="detail-note">
          <strong>Contact details</strong>
          <p>Phone: {customer.phone || 'Not provided'}</p>
          <p>Company: {customer.company_name || 'Not provided'}</p>
          <p>Joined: {new Date(customer.created_at).toLocaleDateString()}</p>
        </div>

        <div className="modal-footer"><button className="outline" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

function WrongPortal({ role, portal, onSignOut }: { role: Role; portal: Role; onSignOut: () => void }) {
  const adminOnCustomer = role === "admin" && portal === "customer";
  return (
    <main className="gate-shell">
      <div className="gate-card">
        <span className="gate-icon"><Icon name="lock" size={22}/></span>
        <h1>{adminOnCustomer ? "You are signed in as administrator" : "Restricted area"}</h1>
        <p>
          {adminOnCustomer
            ? "Administrator sessions run in the operations console. Continue there to manage broadcasts."
            : "This console is reserved for Xpack administrators. Your customer panel is on the main site."}
        </p>
        <div className="gate-actions">
          <a className="primary" href={adminOnCustomer ? "/admin" : "/"}>
            {adminOnCustomer ? "Go to admin console" : "Go to customer panel"}<Icon name="arrow" size={16}/>
          </a>
          <button className="outline" onClick={onSignOut}>Sign out</button>
        </div>
      </div>
    </main>
  );
}

function Auth({ portal, onLogin }: { portal: Role; onLogin: (s: Session) => void }) {
  const isAdminPortal = portal === "admin";
  const [mode, setMode] = useState<"login" | "signup" | "admin" | "forgot">(isAdminPortal ? "admin" : "login");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [captchaQ, setCaptchaQ] = useState({ n1: 4, n2: 7 });
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [lockoutCount, setLockoutCount] = useState(0);
  const [lockoutUntil, setLockoutUntil] = useState<Date | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(0);

  const resetCaptcha = () => {
    setCaptchaQ({ n1: Math.floor(Math.random() * 10) + 1, n2: Math.floor(Math.random() * 10) + 1 });
    setCaptchaAnswer("");
  };

  // The captcha starts as a fixed pair so the server and client render the same markup, then
  // randomises once on mount. Generating it during render instead would either desync
  // hydration or hand every visitor the same sum.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { resetCaptcha(); }, []);

  const changeMode = (newMode: typeof mode) => {
    // The admin console never exposes the customer sign-up / customer sign-in flows,
    // and the customer site never exposes the administrator flow.
    if (isAdminPortal) return;
    setMode(newMode);
    setError("");
    setNotice("");
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
        role: result.user?.role as Role || (mode === "admin" ? "admin" : "customer"), 
        name: result.user?.name || (mode === "admin" ? "Admin" : "User"), 
        email, 
        company: result.user?.company || "" 
      });
      return;
    }
    
    if (mode === "forgot") {
      // No self-service reset: on this panel the operations team holds and resets customer
      // passwords from the admin console, so send people down a route that actually works
      // rather than claiming an email was sent.
      const res = await requestPasswordHelp(email);
      if (res?.error) return setError(res.error);
      setNotice(
        "Request received. Our operations team will reset your password and contact you on the email and phone number registered to this account."
      );
      setError("");
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

  return (
    <main className={`auth-shell${isAdminPortal ? " admin-shell" : ""}`}>
      <section className="auth-brand">
        <div className="brand"><span className="brand-mark"><b>X</b></span><span>XPACK<em>{isAdminPortal ? "ADMIN" : "PANEL"}</em></span></div>
        {isAdminPortal ? (
          <div>
            <p className="eyebrow">RESTRICTED CONSOLE</p>
            <h1>Operations<br/>command centre.</h1>
            <p>Fulfil broadcasts, manage services and pricing, handle refunds, and answer the support desk.</p>
          </div>
        ) : (
          <div>
            <p className="eyebrow">IVR BROADCAST PANEL</p>
            <h1>Every broadcast,<br/>clear and under control.</h1>
            <p>Create broadcasts, securely share files, track processing live, and download campaign reports in one panel.</p>
          </div>
        )}
        <div className="auth-points">
          {isAdminPortal
            ? <><span><Icon name="check"/>Full fulfilment controls</span><span><Icon name="check"/>Wallet and refund management</span><span><Icon name="check"/>Complete audit trail</span></>
            : <><span><Icon name="check"/>Instant wallet top-ups</span><span><Icon name="check"/>Live broadcast tracking</span><span><Icon name="check"/>Dedicated support desk</span></>}
        </div>
      </section>
      <section className="auth-panel">
        <form className="auth-card" onSubmit={submit}>
          <div className="auth-heading"><p className="eyebrow">{isAdminPortal ? "RESTRICTED AREA" : "XPACK PANEL"}</p><h2>{title}</h2><p>{mode === "admin" ? "Use your authorized Xpack Operations credentials." : mode === "signup" ? "Set up your customer panel in under a minute." : mode === "forgot" ? "Tell us your email and our operations team will reset the password on your account." : "Sign in to manage your broadcasts."}</p></div>
          {mode === "signup" && <><label>Full name<input name="name" required placeholder="Your full name" disabled={isLocked}/></label><label>Company name <span>(optional)</span><input name="company" placeholder="Your company" disabled={isLocked}/></label><label>Phone number<input name="phone" required placeholder="+91 00000 00000" disabled={isLocked}/></label></>}
          <label>Email address<input name="email" type="email" required placeholder={isAdminPortal ? "administrator email" : "you@company.com"} autoComplete={isAdminPortal ? "off" : "email"} disabled={isLocked}/></label>
          {mode !== "forgot" && <label>Password<div className="password-field"><input name="password" type={showPassword ? "text" : "password"} required minLength={8} placeholder="••••••••" autoComplete={isAdminPortal ? "off" : "current-password"} disabled={isLocked}/><button type="button" className="password-toggle" onClick={() => setShowPassword(!showPassword)} disabled={isLocked}><Icon name={showPassword ? "eye-off" : "eye"} size={16}/></button></div></label>}
          {mode === "signup" && <label>Confirm password<input name="confirm" type="password" required minLength={8} placeholder="••••••••" disabled={isLocked}/></label>}
          {mode !== "forgot" && <label>Security check: what is {captchaQ.n1} + {captchaQ.n2}?<input type="number" required placeholder="Your answer" value={captchaAnswer} onChange={e => setCaptchaAnswer(e.target.value)} disabled={isLocked}/></label>}
          {mode === "login" && <div className="auth-options"><label className="check"><input type="checkbox" defaultChecked disabled={isLocked}/> Remember me</label><button type="button" onClick={() => changeMode("forgot")} disabled={isLocked}>Forgot password?</button></div>}
          {error && <p className="auth-error">{error}</p>}
          {notice && <p className="auth-notice">{notice}</p>}
          <button className="primary auth-submit" disabled={isLocked}>{mode === "signup" ? "Create account" : mode === "forgot" ? "Request a password reset" : isLocked ? `Locked (${timeRemaining}s)` : "Sign in"}<Icon name="arrow" size={16}/></button>
          {!isAdminPortal && (
            <p className="auth-switch">
              {mode === "signup" ? "Already have an account?" : mode === "forgot" ? "Remembered it?" : "New to Xpack?"}{" "}
              <button type="button" onClick={() => changeMode(mode === "signup" ? "login" : mode === "forgot" ? "login" : "signup")} disabled={isLocked}>{mode === "signup" || mode === "forgot" ? "Sign in" : "Create an account"}</button>
            </p>
          )}
        </form>
      </section>
    </main>
  );
}

function TransactionTable({ transactions }: { transactions: any[] }) {
  if (!transactions || transactions.length === 0) {
    return <p className="text-muted empty">No transactions found.</p>;
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Amount</th>
            <th>Broadcast ref</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map(t => (
            <tr key={t.id}>
              <td className="muted-cell">{new Date(t.created_at).toLocaleString()}</td>
              <td>
                <span className={`txn-tag ${t.type === 'CREDIT' ? 'credit' : 'debit'}`}>
                  {t.type === 'CREDIT' ? 'CREDIT' : 'DEBIT'}
                </span>
              </td>
              <td><strong className="amount">₹{Number(t.amount).toFixed(2)}</strong></td>
              <td className="muted-cell">{t.order_id || '-'}</td>
              <td><Badge status={t.status === 'SUCCESS' ? 'Completed' : t.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Customer account screen: profile details and password change, both persisted. */
function CustomerSettings({ session, onProfileSaved }: { session: Session; onProfileSaved: (p: { name: string; company: string }) => void }) {
  const [fullName, setFullName] = useState(session.name);
  const [company, setCompany] = useState(session.company || "");
  const [phone, setPhone] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState("");
  const [profileErr, setProfileErr] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState("");
  const [passwordErr, setPasswordErr] = useState("");

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setProfileMsg("");
    setProfileErr("");

    const formData = new FormData();
    formData.set("full_name", fullName);
    formData.set("company_name", company);
    formData.set("phone", phone);

    setSavingProfile(true);
    const res = await updateMyProfile(formData);
    setSavingProfile(false);

    if (res?.error) return setProfileErr(res.error);
    setProfileMsg("Profile saved.");
    onProfileSaved({ name: res?.profile?.full_name || fullName, company: res?.profile?.company_name || "" });
    setTimeout(() => setProfileMsg(""), 3000);
  };

  const savePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPasswordMsg("");
    setPasswordErr("");

    if (newPassword.length < 8) return setPasswordErr("The new password must be at least 8 characters long.");
    if (newPassword !== confirmPassword) return setPasswordErr("The new passwords do not match.");

    setSavingPassword(true);
    const res = await changeMyPassword(currentPassword, newPassword);
    setSavingPassword(false);

    if (res?.error) return setPasswordErr(res.error);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordMsg("Password changed.");
    setTimeout(() => setPasswordMsg(""), 3000);
  };

  return (
    <>
      <Heading eyebrow="ACCOUNT" title="Profile and preferences" text="Keep your account details up to date."/>
      <section className="panel settings-panel">
        <form className="setting-section" onSubmit={saveProfile}>
          <h2>Profile information</h2>
          <p>These details appear on your broadcast requests.</p>
          <div className="form-grid">
            <label>Full name<input value={fullName} onChange={e => setFullName(e.target.value)} required/></label>
            <label>Company<input value={company} onChange={e => setCompany(e.target.value)} placeholder="Optional"/></label>
            <label>Email address<input value={session.email} disabled title="Contact support to change your email address"/></label>
            <label>Phone number<input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Add a phone number"/></label>
          </div>
          {profileErr && <p className="form-error">{profileErr}</p>}
          {profileMsg && <p className="form-success">✓ {profileMsg}</p>}
          <button className="primary" disabled={savingProfile}>{savingProfile ? "Saving…" : "Save changes"}</button>
        </form>

        <form className="setting-section" onSubmit={savePassword}>
          <h2>Change password</h2>
          <p>You will stay signed in on this device after changing it.</p>
          <div className="form-grid">
            <label>Current password<input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required/></label>
            <label>New password<input type="password" minLength={8} value={newPassword} onChange={e => setNewPassword(e.target.value)} required/></label>
            <label>Confirm new password<input type="password" minLength={8} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required/></label>
          </div>
          {passwordErr && <p className="form-error">{passwordErr}</p>}
          {passwordMsg && <p className="form-success">✓ {passwordMsg}</p>}
          <button className="primary" disabled={savingPassword}>{savingPassword ? "Updating…" : "Update password"}</button>
        </form>
      </section>
    </>
  );
}

function CustomerPage({ view, orders, tickets, transactions, setView, create, ticket, select, selectTicket, session, balance, onCredited, onProfileSaved }: { view: string; orders: Order[]; tickets: Ticket[]; transactions: any[]; setView: (v: string) => void; create: () => void; ticket: () => void; select: (o: Order) => void; selectTicket: (t: Ticket) => void; session: Session; balance: number; onCredited: () => void; onProfileSaved: (p: { name: string; company: string }) => void }) {
  if (view === "My broadcasts") {
    return (
      <>
        <Heading eyebrow="CUSTOMER PANEL" title="My broadcasts" text="Every broadcast you have submitted, with live status." action="Create new broadcast" onAction={create}/>
        <section className="panel data-panel">
          <BroadcastTable orders={orders} onSelect={select}/>
        </section>
      </>
    );
  }

  if (view === "Support") {
    return (
      <>
        <Heading eyebrow="SUPPORT" title="How can we help?" text="Create a ticket and keep every conversation in one thread." action="New ticket" onAction={ticket}/>
        <section className="support-layout">
          <section className="panel data-panel"><TicketTable tickets={tickets} onSelect={selectTicket}/></section>
          <aside className="panel support-aside">
            <Icon name="help" size={26}/>
            <h2>Priority support</h2>
            <p>Our operations team typically responds within one business day.</p>
            <button className="outline" onClick={ticket}>Raise a ticket</button>
          </aside>
        </section>
      </>
    );
  }

  if (view === "Settings") {
    return <CustomerSettings session={session} onProfileSaved={onProfileSaved}/>;
  }
  
  if (view === "Add funds") {
    return <AddFunds balance={balance} transactions={transactions} onCredited={onCredited} />;
  }
  
  const placed = orders.filter((o: Order) => o.status === "Placed").length;
  const progressing = orders.filter((o: Order) => o.status === "In progress").length;
  const completed = orders.filter((o: Order) => o.status === "Completed").length;

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

  return (
    <>
      <Heading eyebrow="CUSTOMER PANEL" title={`Welcome back, ${session.name.split(" ")[0]}`} text="Here's what's happening with your broadcasts." action="Create new broadcast" onAction={create}/>
      <div className="metric-grid">
        <Metric icon="radio" label="Total broadcasts" value={orders.length} detail="All time"/>
        <Metric icon="clock" label="Pending" value={placed} detail="Awaiting review" warning/>
        <Metric icon="activity" label="In progress" value={progressing} detail="Being processed"/>
        <Metric icon="chart" label="Completed" value={completed} detail="Reports ready" success/>
      </div>
      <section className="announce">
        <span className="announce-icon"><Icon name="radio" size={18}/></span>
        <div>
          <strong>Create a broadcast in under a minute.</strong>
          <p>Pick a category and service, choose a male or female voice, upload your audio and contact list — then track delivery right here.</p>
        </div>
        <button className="primary" onClick={create}><Icon name="plus" size={16}/>Create new broadcast</button>
      </section>
      <div className="dashboard-grid">
        <section className="panel">
          <PanelTop title="Recent broadcasts" text="Your latest broadcast requests." action="View all" onAction={() => setView("My broadcasts")}/>
          <BroadcastTable orders={orders.slice(0, 4)} onSelect={select}/>
        </section>
        <aside className="activity-panel panel">
          <PanelTop title="Recent activity" text="Across your account."/>
          <div className="timeline">
            {events.length > 0 ? events.slice(0, 3).map((ev, i) => <Timeline key={i} color={ev.color} title={ev.title} text={ev.text} time={ev.time} />) : <p className="text-muted empty">No recent activity.</p>}
          </div>
          <button className="outline full" onClick={() => setView("Support")}>Open support</button>
        </aside>
      </div>
      <section className="quick-section">
        <div><p className="eyebrow">QUICK ACTIONS</p><h2>Manage your broadcasts with ease</h2><p>Everything needed for a successful IVR campaign.</p></div>
        <div className="quick-actions">
          <button onClick={create}><span className="icon-box red"><Icon name="plus"/></span><span><strong>Create new broadcast</strong><small>Select category &amp; service</small></span><Icon name="arrow" size={18}/></button>
          <button onClick={() => setView("My broadcasts")}><span className="icon-box green"><Icon name="file"/></span><span><strong>View campaign reports</strong><small>Download completed results</small></span><Icon name="arrow" size={18}/></button>
        </div>
      </section>
    </>
  );
}

/**
 * One row of the admin customer directory.
 *
 * The password is stored in plain text on purpose so operations can read it here; the cell
 * stays masked until the admin reveals it so the column is not readable over a shoulder or
 * in a screen share by default.
 */
function CustomerRow({ user, orders, onSelectCustomer, onChanged, revealAll }: {
  user: any;
  orders: Order[];
  onSelectCustomer: (u: any) => void;
  onChanged: () => void;
  revealAll: boolean;
}) {
  const [loggingIn, setLoggingIn] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [busy, setBusy] = useState(false);

  const showPassword = revealAll || revealed;
  const password = user.password_plain || "";
  const displayName = user.full_name || user.company_name || user.email;

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const handleLoginAsUser = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Sign in as ${displayName}?\n\nYou will be taken to their customer panel. Use the banner at the top to return to the admin console.`)) return;

    setLoggingIn(true);
    const res = await impersonateUser(user.id);
    if (res?.error) {
      alert(res.error);
      setLoggingIn(false);
      return;
    }
    // Full reload so the swapped session cookies are picked up everywhere.
    window.location.href = "/";
  };

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert("Could not copy. Reveal the password and copy it manually.");
    }
  };

  const handleResetPassword = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = prompt(`Set a new password for ${displayName}.\n\nMinimum 8 characters. This replaces their current password immediately.`);
    if (next === null) return;
    if (next.length < 8) return alert("Password must be at least 8 characters long.");

    setResetting(true);
    const res = await adminSetUserPassword(user.id, next);
    setResetting(false);

    if (res?.error) return alert(res.error);
    if (res?.warning) alert(res.warning);
    setRevealed(true);
    onChanged();
  };

  const handleToggleActive = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextActive = !user.is_active;
    if (!confirm(`${nextActive ? "Enable" : "Disable"} the account for ${displayName}?`)) return;

    setBusy(true);
    const res = await adminSetUserActive(user.id, nextActive);
    setBusy(false);
    if (res?.error) return alert(res.error);
    onChanged();
  };

  const broadcastCount = orders.filter(
    (x: Order) => x.email?.toLowerCase() === String(user.email || "").toLowerCase()
  ).length;

  return (
    <tr className="clickable-row" onClick={() => onSelectCustomer?.(user)}>
      <td>
        <button className="customer-link" onClick={(e) => { stop(e); onSelectCustomer?.(user); }}>
          <strong>{displayName}</strong>
        </button>
        {user.company_name && user.full_name && <div className="service-line">{user.company_name}</div>}
      </td>
      <td>{user.email}</td>
      <td>
        <div className="password-cell-wrapper">
          {password ? (
            <>
              <code className="password-cell">{showPassword ? password : "•".repeat(Math.min(password.length, 12))}</code>
              <button
                className="password-toggle-btn"
                onClick={(e) => { stop(e); setRevealed(!revealed); }}
                title={showPassword ? "Hide password" : "Reveal password"}
                type="button"
              >
                <Icon name={showPassword ? "eye-off" : "eye"} size={14} />
              </button>
              <button
                className="password-toggle-btn"
                onClick={handleCopy}
                title="Copy password"
                type="button"
              >
                <Icon name={copied ? "check" : "copy"} size={14} />
              </button>
            </>
          ) : (
            <span className="text-muted no-password">Not captured</span>
          )}
        </div>
      </td>
      <td>{broadcastCount}</td>
      <td><strong className="amount">₹{(Number(user.balance) || 0).toFixed(2)}</strong></td>
      <td><Badge status={user.is_active ? "Active" : "Closed"} /></td>
      <td>
        <div className="row-actions">
          <button
            className="primary small"
            onClick={handleLoginAsUser}
            disabled={loggingIn || user.is_active === false}
            title={user.is_active === false ? "Enable this account before signing in as the customer" : "Sign in as this customer"}
            type="button"
          >
            <Icon name="login" size={14} /> {loggingIn ? "Signing in…" : "Login as user"}
          </button>
          <button
            className="outline small"
            onClick={handleResetPassword}
            disabled={resetting}
            title={password ? "Set a new password" : "No password on file — set one to enable the fast login path"}
            type="button"
          >
            <Icon name="key" size={14} /> {resetting ? "Saving…" : password ? "Reset" : "Set password"}
          </button>
          <button
            className="outline small"
            onClick={handleToggleActive}
            disabled={busy}
            title={user.is_active ? "Disable this account" : "Enable this account"}
            type="button"
          >
            <Icon name={user.is_active ? "ban" : "check"} size={14} /> {user.is_active ? "Disable" : "Enable"}
          </button>
        </div>
      </td>
    </tr>
  );
}

/** Admin customer directory: search, plain-password access, and per-account actions. */
function CustomerDirectory({ users, orders, isDataLoading, onSelectCustomer, onChanged }: {
  users: any[];
  orders: Order[];
  isDataLoading?: boolean;
  onSelectCustomer: (u: any) => void;
  onChanged: () => void;
}) {
  const [search, setSearch] = useState("");
  const [revealAll, setRevealAll] = useState(false);

  const customers = users.filter((u: any) => u.role !== "ADMIN");
  const term = search.trim().toLowerCase();
  const visible = term
    ? customers.filter((u: any) =>
        [u.full_name, u.company_name, u.email, u.phone]
          .some((field: any) => String(field || "").toLowerCase().includes(term))
      )
    : customers;

  const withoutPassword = customers.filter((u: any) => !u.password_plain).length;

  return (
    <>
      <Heading eyebrow="ADMIN CONSOLE" title="Customer directory" text="Review customers, their activity, and account standing." />
      <section className="panel data-panel">
        <div className="table-tools">
          <div className="search">
            <Icon name="search" size={16} />
            <input placeholder="Search name, company, email, or phone" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button className="outline small" onClick={() => setRevealAll(!revealAll)} type="button">
            <Icon name={revealAll ? "eye-off" : "eye"} size={14} /> {revealAll ? "Hide all passwords" : "Reveal all passwords"}
          </button>
          <button className="outline small" onClick={onChanged} type="button">
            <Icon name="refresh" size={14} /> Refresh
          </button>
        </div>

        {withoutPassword > 0 && (
          <div className="detail-note info directory-note">
            <strong>{withoutPassword} account{withoutPassword > 1 ? "s have" : " has"} no password on file</strong>
            <p>
              Accounts created before password capture was switched on have nothing to display. Use
              &ldquo;Set password&rdquo; on the row to choose one — that also enables the instant
              &ldquo;Login as user&rdquo; path for them.
            </p>
          </div>
        )}

        <div className="table-wrap">
          {isDataLoading ? (
            <div className="loading-block"><div className="loader" /></div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Email</th>
                  <th>Password</th>
                  <th>Broadcasts</th>
                  <th>Wallet balance</th>
                  <th>Account</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.length ? visible.map((u: any) => (
                  <CustomerRow
                    key={u.id || u.email}
                    user={u}
                    orders={orders}
                    onSelectCustomer={onSelectCustomer}
                    onChanged={onChanged}
                    revealAll={revealAll}
                  />
                )) : (
                  <tr><td colSpan={7} className="empty">No customers match &ldquo;{search}&rdquo;.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </>
  );
}

function AdminPage({ view, orders, tickets, users, transactions, price, setPrice, setView, select, selectTicket, onRefreshBroadcasts, isDataLoading, onTopupsChanged, onRefreshUsers, onSelectCustomer }: { view: string; orders: Order[]; tickets: Ticket[]; users: any[]; transactions: any[]; price: string; setPrice: (p: string) => void; setView: (v: string) => void; select: (o: Order) => void; selectTicket: (t: Ticket) => void; onRefreshBroadcasts: () => void; isDataLoading?: boolean; onTopupsChanged?: () => void; onRefreshUsers: () => void; onSelectCustomer: (u: any) => void }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [dashTab, setDashTab] = useState("summary");
  const [actFilterDate, setActFilterDate] = useState("");
  const [chartDateFilter, setChartDateFilter] = useState("");
  const [broadcastFilters, setBroadcastFilters] = useState<{ view: string; schedule: string; status: string } | null>(null);
  // Track which server value the local edit belongs to, so a refreshed price flows into the
  // field without an effect writing state on every render pass.
  const [priceEdit, setPriceEdit] = useState<{ base: string; value: string } | null>(null);
  const localPrice = priceEdit?.base === price ? priceEdit.value : price;
  const setLocalPrice = (value: string) => setPriceEdit({ base: price, value });

  // A view can carry an argument after a colon, e.g. "Broadcasts:scheduled". The menu uses
  // it to preselect a filter; the admin can still change the filter once the page is open.
  const [viewName, viewArg] = view.split(":");

  // Filters default from the menu entry and are remembered per view, so navigating to
  // "Needs action" always lands on the placed queue without an effect resetting state.
  const defaultSchedule = viewArg === "scheduled" ? "later" : "current";
  const defaultStatus = viewArg === "pending" ? "Placed" : "All statuses";
  const filtersMatchView = broadcastFilters?.view === view;
  const scheduleFilter = filtersMatchView ? broadcastFilters!.schedule : defaultSchedule;
  const statusFilter = filtersMatchView ? broadcastFilters!.status : defaultStatus;
  const setScheduleFilter = (schedule: string) => setBroadcastFilters({ view, schedule, status: statusFilter });
  const setStatusFilter = (status: string) => setBroadcastFilters({ view, schedule: scheduleFilter, status });

  const parseDate = (dStr: string) => {
    const d = new Date(dStr);
    return isNaN(d.getTime()) ? new Date() : d;
  };

  if (viewName === "Services") {
    return <CategoryServiceManager />;
  }

  if (viewName === "Topups") {
    return <TopupRequestsView onCredited={onTopupsChanged} />;
  }

  if (viewName === "Transactions") {
    return <AdminTransactionsView transactions={transactions} users={users} />;
  }

  if (viewName === "Settings") {
    return (
      <AdminSettingsView
        tab={viewArg || "general"}
        onTabChange={(tab) => setView(`Settings:${tab}`)}
        price={price}
        onPriceSaved={setPrice}
        stats={{ users: users.length, broadcasts: orders.length, tickets: tickets.length }}
      />
    );
  }

  if (viewName === "Broadcasts") {
    let filtered = orders.filter(o => {
      const isLater = o.schedule && o.schedule !== 'Start on processing' && new Date(o.schedule) > new Date();
      if (scheduleFilter === "later") return isLater;
      return !isLater;
    });

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(o =>
        o.name.toLowerCase().includes(term) ||
        o.customer.toLowerCase().includes(term) ||
        o.id.toLowerCase().includes(term) ||
        o.email.toLowerCase().includes(term) ||
        o.broadcastNo.toLowerCase().includes(term) ||
        (o.categoryName && o.categoryName.toLowerCase().includes(term)) ||
        (o.serviceName && o.serviceName.toLowerCase().includes(term))
      );
    }
    if (statusFilter !== "All statuses") {
      filtered = filtered.filter(o => o.status === statusFilter);
    }

    return (
      <>
        <Heading eyebrow="ADMIN CONSOLE" title="Broadcast management" text="Review requests, access assets, and manage fulfilment."/>
        <section className="panel data-panel">
          <div className="table-tools">
            <div className="search"><Icon name="search" size={16}/><input placeholder="Search broadcast, category, or customer" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}/></div>
            <div className="segmented">
              <button className={scheduleFilter === 'current' ? 'on' : ''} onClick={() => setScheduleFilter('current')}>Current</button>
              <button className={scheduleFilter === 'later' ? 'on' : ''} onClick={() => setScheduleFilter('later')}>Scheduled later</button>
            </div>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option>All statuses</option>
              <option>Placed</option>
              <option>In progress</option>
              <option>Completed</option>
              <option>Cancelled</option>
              <option>On hold</option>
              <option>Refunded</option>
            </select>
          </div>
          <BroadcastTable orders={filtered} admin onSelect={select} onViewCustomer={() => setView("Customers")}/>
        </section>
      </>
    );
  }

  if (viewName === "Customers") {
    return (
      <CustomerDirectory
        users={users}
        orders={orders}
        isDataLoading={isDataLoading}
        onSelectCustomer={onSelectCustomer}
        onChanged={onRefreshUsers}
      />
    );
  }
  if (viewName === "Support desk") return <><Heading eyebrow="ADMIN CONSOLE" title="Support desk" text="Prioritize, reply to, and close customer conversations."/><section className="panel data-panel"><TicketTable tickets={tickets} admin onSelect={selectTicket}/></section></>;
  
  if (viewName === "Activity log") {
    return (
      <>
        <Heading eyebrow="ADMIN CONSOLE" title="Activity log" text="Full audit trail of everything that happened in the panel."/>
        <ActivityLog />
      </>
    );
  }
  
  if (viewName === "Pricing") {
    const handleSavePricing = async () => {
      const res = await updatePricePerCall(localPrice);
      if (res.error) alert(res.error);
      else {
        alert("Pricing updated successfully!");
        setPrice(localPrice);
      }
    };

    return (
      <>
        <Heading eyebrow="ADMIN CONSOLE" title="Global call pricing" text="Set default pricing parameters."/>
        <section className="panel pricing-panel">
          <PanelTop title="Call pricing (default per-call rate)" text="Used as the fallback estimate when a service has no fixed price."/>
          <div className="admin-update pricing-form">
            <label>Price per call (₹)<input type="number" step="0.01" value={localPrice} onChange={e => setLocalPrice(e.target.value)}/></label>
            <button className="primary" onClick={handleSavePricing}>Save pricing</button>
          </div>
        </section>
      </>
    );
  }

  const pending = orders.filter((o: Order) => o.status === "Placed").length;
  const active = orders.filter((o: Order) => o.status === "In progress").length;
  const done = orders.filter((o: Order) => o.status === "Completed").length;
  const onHoldCount = orders.filter((o: Order) => o.status === "On hold").length;
  const urgentTickets = tickets.filter((t: Ticket) => t.status !== "Resolved" && t.status !== "Closed" && t.priority === "High").length;

  const walletTotal = users.reduce((sum: number, u: any) => sum + Number(u.balance || 0), 0);

  return (
    <>
      <Heading eyebrow="ADMIN CONSOLE" title="Operations overview" text="A live view of your broadcast operations."/>

      <TabStrip
        tabs={[
          { key: "summary", label: "Summary" },
          { key: "analytics", label: "Analytics" },
          { key: "panel", label: "Panel information" },
        ]}
        active={dashTab}
        onChange={setDashTab}
      />

      {dashTab === "analytics" && (
        <>
          <StatisticsGraph />
          <AdminAnalytics orders={orders} users={users} dateFilter={chartDateFilter} setDateFilter={setChartDateFilter}/>
        </>
      )}

      {dashTab === "panel" && (
        <div className="dashboard-grid">
          <section className="panel">
            <PanelTop title="Panel information" text="What this deployment currently holds."/>
            <div className="info-list">
              <div><span>Registered customers</span><strong>{users.length}</strong></div>
              <div><span>Broadcasts all time</span><strong>{orders.length}</strong></div>
              <div><span>Support tickets</span><strong>{tickets.length}</strong></div>
              <div><span>Customer wallet float</span><strong>₹{walletTotal.toFixed(2)}</strong></div>
              <div><span>Default price per call</span><strong>₹{Number(price || 0).toFixed(2)}</strong></div>
            </div>
          </section>
          <aside className="panel">
            <PanelTop title="Quick links" text="Jump straight into the common admin jobs."/>
            <div className="quick-links">
              <button onClick={() => setView("Topups")}><span className="icon-box red"><Icon name="wallet"/></span><span><strong>Verify top-ups</strong><small>Approve UTR submissions</small></span><Icon name="arrow" size={16}/></button>
              <button onClick={() => setView("Settings:payments")}><span className="icon-box green"><Icon name="qr"/></span><span><strong>Payment methods</strong><small>UPI QR and verification</small></span><Icon name="arrow" size={16}/></button>
              <button onClick={() => setView("Services")}><span className="icon-box red"><Icon name="layers"/></span><span><strong>Services</strong><small>Categories and pricing</small></span><Icon name="arrow" size={16}/></button>
            </div>
          </aside>
        </div>
      )}

      {dashTab === "summary" && (
      <>
      <div className="metric-grid">
        <Metric icon="users" label="Total customers" value={users.length} detail="Across all accounts"/>
        <Metric icon="clock" label="Pending broadcasts" value={pending} detail="Waiting for review" warning/>
        <Metric icon="activity" label="In progress" value={active} detail="Currently processing"/>
        <Metric icon="chart" label="Completed" value={done} detail="Reports delivered" success/>
      </div>
      <div className="dashboard-grid">
        <section className="panel urgent">
          <PanelTop title="Broadcasts needing action" text="New requests and broadcasts that need attention." action="Manage broadcasts" onAction={() => setView("Broadcasts")}/>
          <div className="urgent-list">
            {orders.filter((o: Order) => o.status !== "Completed").slice(0,3).length ? orders.filter((o: Order) => o.status !== "Completed").slice(0,3).map((o: Order, i: number) => (
              <div className="urgent-row" key={o.id}>
                <span className={`priority ${i === 0 ? "new" : "due-soon"}`}>{i === 0 ? "New" : "Due soon"}</span>
                <div><strong>{o.broadcastNo} · {o.customer}</strong><p>{o.name} · {o.created}</p></div>
                <button className="outline small" onClick={() => select(o)}>Review <Icon name="arrow" size={14}/></button>
              </div>
            )) : <p className="text-muted empty">Nothing waiting. All broadcasts are handled.</p>}
          </div>
        </section>
        <aside className="panel queue">
          <PanelTop title="Support queue" text="Current ticket workload." action="Open desk" onAction={() => setView("Support desk")}/>
          <div className="queue-stats">
            <div><b>{tickets.filter((t: Ticket) => t.status === "Open").length}</b><span>Open</span></div>
            <div><b>{tickets.filter((t: Ticket) => t.status === "In progress").length}</b><span>In progress</span></div>
            <div><b>{tickets.filter((t: Ticket) => t.status === "Resolved").length}</b><span>Resolved</span></div>
          </div>
          {urgentTickets > 0 ? (
            <div className="sla"><span className="icon-box red"><Icon name="clock"/></span><div><strong>{urgentTickets} tickets nearing SLA</strong><p>High priority tickets require response.</p></div></div>
          ) : (
            <div className="sla calm"><span className="icon-box green"><Icon name="check"/></span><div><strong>All caught up!</strong><p>No high-priority tickets pending.</p></div></div>
          )}
        </aside>
      </div>
      <section className="panel operations">
        <PanelTop title="Today's processing pipeline" text="Broadcast health by status."/>
        <div className="pipeline">
          <div><span className="pipe-number red-fill">{pending}</span><strong>Placed</strong><p>Awaiting review</p></div>
          <span className="pipe-line"/>
          <div><span className="pipe-number yellow-fill">{active}</span><strong>In progress</strong><p>On IVR system</p></div>
          <span className="pipe-line"/>
          <div><span className="pipe-number green-fill">{done}</span><strong>Completed</strong><p>Reports delivered</p></div>
          {onHoldCount > 0 && <><span className="pipe-line"/><div><span className="pipe-number hold-fill">{onHoldCount}</span><strong>On hold</strong><p>Awaiting fix</p></div></>}
        </div>
      </section>
      </>
      )}
    </>
  );
}

/** Broadcast distribution and wallet totals. Shared by the dashboard tab and the activity log. */
function AdminAnalytics({ orders, users, dateFilter, setDateFilter }: { orders: Order[]; users: any[]; dateFilter: string; setDateFilter: (v: string) => void }) {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const asKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const chartOrders = dateFilter
    ? orders.filter(o => {
        const d = new Date(o.created);
        return !isNaN(d.getTime()) && asKey(d) === dateFilter;
      })
    : orders;

  const statuses = { placed: 0, progress: 0, hold: 0, completed: 0, cancelled: 0, refunded: 0 };
  let totalRefunds = 0;

  chartOrders.forEach(o => {
    if (o.status === "Placed") statuses.placed++;
    else if (o.status === "In progress") statuses.progress++;
    else if (o.status === "On hold") statuses.hold++;
    else if (o.status === "Completed") statuses.completed++;
    else if (o.status === "Cancelled") statuses.cancelled++;
    else if (o.status === "Refunded") statuses.refunded++;

    if ((o.status === "Cancelled" || o.status === "Refunded") && o.charge) totalRefunds += Number(o.charge);
    if (o.partialRefundAmount) totalRefunds += Number(o.partialRefundAmount);
  });

  const maxVal = Math.max(...Object.values(statuses), 1);
  const bars: Array<[string, string, number]> = [
    ["placed", "Placed", statuses.placed],
    ["progress", "In progress", statuses.progress],
    ["hold", "On hold", statuses.hold],
    ["done", "Completed", statuses.completed],
    ["cancel", "Cancelled", statuses.cancelled],
    ["refund", "Refunded", statuses.refunded],
  ];

  return (
    <div className="activity-dashboard">
      <div className="chart-card">
        <div className="chart-head">
          <h3>Broadcast distribution</h3>
          <div className="activity-filters" style={{ marginBottom: 0 }}>
            <input type="date" className="date-filter" value={dateFilter} onChange={e => setDateFilter(e.target.value)}/>
            {dateFilter && <button className="text-button" onClick={() => setDateFilter("")}>Till now</button>}
          </div>
        </div>
        <div className="bar-chart">
          {bars.map(([cls, label, value]) => (
            <div className="bar-wrap" key={cls}>
              <div className={`bar ${cls}`} style={{ height: `${(value / maxVal) * 100}%` }} />
              <span className="bar-val">{value}</span>
              <span className="bar-label">{label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="chart-column">
        <div className="chart-card"><h3>Total customers</h3><p className="chart-total">{users.length}</p><p className="chart-sub">Registered accounts</p></div>
        <div className="chart-card"><h3>Total refunds</h3><p className="chart-total refund-total">₹{totalRefunds.toFixed(2)}</p><p className="chart-sub">Processed to wallet</p></div>
      </div>
    </div>
  );
}

/** Every wallet movement across all customers. */
function AdminTransactionsView({ transactions, users }: { transactions: any[]; users: any[] }) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");

  const nameFor = (userId: string) => {
    const u = users.find((x: any) => x.id === userId);
    return u ? (u.company_name || u.full_name || u.email) : "Unknown";
  };
  const emailFor = (userId: string) => users.find((x: any) => x.id === userId)?.email || "";

  let visible = transactions || [];
  if (typeFilter !== "All") visible = visible.filter((t: any) => t.type === typeFilter);
  if (search.trim()) {
    const term = search.trim().toLowerCase();
    visible = visible.filter((t: any) =>
      String(t.order_id || "").toLowerCase().includes(term) ||
      nameFor(t.user_id).toLowerCase().includes(term) ||
      emailFor(t.user_id).toLowerCase().includes(term)
    );
  }

  const credits = (transactions || []).filter((t: any) => t.type === "CREDIT").reduce((s: number, t: any) => s + Number(t.amount || 0), 0);
  const debits = (transactions || []).filter((t: any) => t.type === "DEBIT").reduce((s: number, t: any) => s + Number(t.amount || 0), 0);

  return (
    <>
      <Heading eyebrow="PAYMENTS" title="Wallet transactions" text="Every credit and debit recorded against customer wallets."/>
      <div className="metric-grid three">
        <Metric icon="indian-rupee" label="Total credited" value={`₹${credits.toFixed(2)}`} detail="Top-ups and refunds" success/>
        <Metric icon="chart" label="Total debited" value={`₹${debits.toFixed(2)}`} detail="Broadcast charges"/>
        <Metric icon="activity" label="Transactions" value={(transactions || []).length} detail="All time"/>
      </div>
      <section className="panel data-panel">
        <div className="table-tools">
          <div className="search"><Icon name="search" size={16}/><input placeholder="Search customer or reference" value={search} onChange={e => setSearch(e.target.value)}/></div>
          <div className="segmented">
            <button className={typeFilter === "All" ? "on" : ""} onClick={() => setTypeFilter("All")}>All</button>
            <button className={typeFilter === "CREDIT" ? "on" : ""} onClick={() => setTypeFilter("CREDIT")}>Credits</button>
            <button className={typeFilter === "DEBIT" ? "on" : ""} onClick={() => setTypeFilter("DEBIT")}>Debits</button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Date</th><th>Customer</th><th>Type</th><th>Amount</th><th>Reference</th><th>Status</th></tr>
            </thead>
            <tbody>
              {visible.length ? visible.map((t: any) => (
                <tr key={t.id}>
                  <td className="muted-cell">{new Date(t.created_at).toLocaleString()}</td>
                  <td><strong>{nameFor(t.user_id)}</strong><div className="service-line">{emailFor(t.user_id)}</div></td>
                  <td><span className={`txn-tag ${t.type === "CREDIT" ? "credit" : "debit"}`}>{t.type}</span></td>
                  <td><strong className="amount">₹{Number(t.amount).toFixed(2)}</strong></td>
                  <td className="muted-cell">{t.order_id || "-"}</td>
                  <td><Badge status={t.status === "SUCCESS" ? "Completed" : t.status}/></td>
                </tr>
              )) : <tr><td colSpan={6} className="empty">No transactions found.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/**
 * The quantity-pricing block shared by the add- and edit-service forms.
 *
 * Leaving "units included" empty is a supported answer, not an omission: it keeps the service
 * on the flat per-order price it has always had. The derived per-unit rate is shown live
 * because "11 for 100" and "0.11 each" are the same deal stated two ways, and the operator is
 * about to sell at whichever one they actually meant.
 */
function ServiceQuantityFields({ mode, setMode, price, units, setUnits, min, setMin, max, setMax }: {
  mode: PricingMode; setMode: (v: PricingMode) => void;
  price: string;
  units: string; setUnits: (v: string) => void;
  min: string; setMin: (v: string) => void;
  max: string; setMax: (v: string) => void;
}) {
  const unitsNum = units.trim() === "" ? null : Number(units);
  const unitsValid = unitsNum !== null && Number.isFinite(unitsNum) && unitsNum > 0;
  const rate = unitsValid ? Number(price || 0) / unitsNum : 0;
  const minNum = min.trim() === "" ? null : Number(min);
  const maxNum = max.trim() === "" ? null : Number(max);
  const boundsWrong = minNum !== null && maxNum !== null && maxNum < minNum;

  return (
    <>
      <div className="field-block">
        <label className="field-label">How is this service priced?</label>
        <div className="segmented tight pricing-mode">
          <button type="button" className={mode === "QUANTITY" ? "on" : ""} onClick={() => setMode("QUANTITY")}>
            Per unit
          </button>
          <button type="button" className={mode === "FLAT" ? "on" : ""} onClick={() => setMode("FLAT")}>
            Flat per order
          </button>
        </div>
      </div>

      {mode === "QUANTITY" ? (
        <>
          <label>Units that price covers <span className="req">required</span>
            <input
              type="number"
              min="1"
              step="1"
              required
              placeholder="e.g. 100"
              value={units}
              onChange={e => {
                setUnits(e.target.value);
                // Seed the minimum with one full pack the first time units are entered.
                // Left blank it falls back to 1, which on a service sold as "100 SMS for
                // Rs 10" lets someone buy a single SMS for 10 paise - not what anyone
                // pricing a pack intends. Filled into the visible field rather than applied
                // behind the operator's back, so it can be read and changed before saving.
                if (min.trim() === "") setMin(e.target.value);
              }}
            />
          </label>

          {unitsValid ? (
            <p className="field-hint">
              ₹{Number(price || 0).toFixed(2)} buys {unitsNum.toLocaleString("en-IN")} numbers, so customers are
              charged <strong>₹{formatRate(rate)} per number</strong>.
              {" "}The smallest order allowed is {(minNum || 1).toLocaleString("en-IN")} numbers
              at ₹{(rate * (minNum || 1)).toFixed(2)};
              {" "}{((minNum || 1) * 2).toLocaleString("en-IN")} numbers cost ₹{(rate * (minNum || 1) * 2).toFixed(2)}.
            </p>
          ) : (
            <p className="field-hint error">
              Enter how many numbers the price covers. For &ldquo;100 SMS for ₹10&rdquo;, that is 100 —
              which charges ₹0.10 per number.
            </p>
          )}

          <div className="field-pair">
            <label>Minimum order quantity
              <input
                type="number" min="1" step="1" placeholder="e.g. 100"
                value={min} onChange={e => setMin(e.target.value)}
              />
            </label>
            <label>Maximum order quantity
              <input
                type="number" min="1" step="1" placeholder="Leave empty for no limit"
                value={max} onChange={e => setMax(e.target.value)}
              />
            </label>
          </div>
          {boundsWrong && (
            <p className="field-hint error">
              The maximum cannot be below the minimum. Customers would be unable to order this service at any quantity.
            </p>
          )}
        </>
      ) : (
        <p className="field-hint">
          Every order of this service costs ₹{Number(price || 0).toFixed(2)}, however many numbers it carries.
          Switch to <strong>Per unit</strong> to charge by the number instead.
        </p>
      )}
    </>
  );
}

function CategoryServiceManager() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [catName, setCatName] = useState("");
  const [catDesc, setCatDesc] = useState("");
  
  const [selectedCatId, setSelectedCatId] = useState("");
  const [servName, setServName] = useState("");
  const [servPrice, setServPrice] = useState("");
  const [servDesc, setServDesc] = useState("");
  // Quantity pricing. Held as strings because "" has to be distinguishable from zero while
  // the operator is still typing.
  const [servMode, setServMode] = useState<PricingMode>("QUANTITY");
  const [servUnits, setServUnits] = useState("");
  const [servMin, setServMin] = useState("");
  const [servMax, setServMax] = useState("");

  /** Everything the quantity fields need to become a `ServiceQuantityInput`. */
  const quantityInput = () => (
    servMode === "FLAT"
      ? { unit_quantity: null, min_quantity: null, max_quantity: null }
      : {
          unit_quantity: servUnits.trim() === "" ? null : Number(servUnits),
          min_quantity: servMin.trim() === "" ? null : Number(servMin),
          max_quantity: servMax.trim() === "" ? null : Number(servMax),
        }
  );

  /**
   * Blocks a save that would silently do nothing.
   *
   * Per-unit with no unit count is the failure that prompted this: the service saved, the
   * panel said so, and the customer screen went on charging a flat price with no minimum,
   * because the one field that turns quantity pricing on had been left empty.
   */
  const quantityFormError = (): string | null => {
    if (servMode === "FLAT") return null;
    const units = Number(servUnits);
    if (servUnits.trim() === "" || !Number.isFinite(units) || units <= 0 || !Number.isInteger(units)) {
      return "Enter how many numbers the price covers. For \u201c100 SMS for \u20b910\u201d, enter 100.";
    }
    const min = servMin.trim() === "" ? null : Number(servMin);
    const max = servMax.trim() === "" ? null : Number(servMax);
    if (min !== null && max !== null && max < min) {
      return "The maximum order quantity cannot be below the minimum.";
    }
    return null;
  };

  const clearServiceForm = () => {
    setServName("");
    setServPrice("");
    setServDesc("");
    setServMode("QUANTITY");
    setServUnits("");
    setServMin("");
    setServMax("");
  };

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [showNewService, setShowNewService] = useState(false);
  const [showEditCategory, setShowEditCategory] = useState(false);
  const [showEditService, setShowEditService] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [editingService, setEditingService] = useState<Service | null>(null);

  const loadData = useCallback(async () => {
    const res = await getAllCategoriesAndServices();
    if (res.data) {
      setCategories(res.data);
      // Functional update: reading selectedCatId from the closure would have pinned this to
      // whatever it was when the callback was created.
      setSelectedCatId(current => current || (res.data!.length > 0 ? res.data![0].id : ""));
    }
  }, []);

  useEffect(() => {
    (async () => { await loadData(); })();
  }, [loadData]);

  const handleAddCategory = async (e: FormEvent) => {
    e.preventDefault();
    if (!catName.trim()) return alert("Category name is required.");
    setLoading(true);
    const res = await createCategory(catName, catDesc);
    setLoading(false);
    if (res.error) {
      alert(res.error);
    } else {
      setCatName("");
      setCatDesc("");
      setShowNewCategory(false);
      setMsg("Category created successfully!");
      setTimeout(() => setMsg(""), 3000);
      loadData();
    }
  };

  const handleAddService = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedCatId) return alert("Please select a Category.");
    if (!servName.trim()) return alert("Service name is required.");
    const priceNum = parseFloat(servPrice);
    if (isNaN(priceNum) || priceNum < 0) return alert("Please enter a valid price.");

    const quantityProblem = quantityFormError();
    if (quantityProblem) return alert(quantityProblem);

    setLoading(true);
    const res = await createService(selectedCatId, servName, priceNum, servDesc, quantityInput());
    setLoading(false);
    if (res.error) {
      alert(res.error);
    } else {
      clearServiceForm();
      setShowNewService(false);
      setMsg("Service added successfully!");
      setTimeout(() => setMsg(""), 3000);
      loadData();
    }
  };

  const handleDeleteCategory = async (id: string) => {
    if (!confirm("Are you sure you want to delete this category? All services inside it will also be deleted.")) return;
    const res = await deleteCategory(id);
    if (res.error) alert(res.error);
    else loadData();
  };

  const handleDeleteService = async (id: string) => {
    if (!confirm("Delete this service?")) return;
    const res = await deleteService(id);
    if (res.error) alert(res.error);
    else loadData();
  };

  const handleEditCategory = (cat: Category) => {
    setEditingCategory(cat);
    setCatName(cat.name);
    setCatDesc(cat.description || "");
    setShowEditCategory(true);
  };

  const handleEditService = (service: Service, categoryId: string) => {
    setEditingService(service);
    setSelectedCatId(categoryId);
    setServName(service.name);
    setServPrice(String(service.price));
    setServDesc(service.description || "");
    setServMode(service.unit_quantity ? "QUANTITY" : "FLAT");
    setServUnits(service.unit_quantity ? String(service.unit_quantity) : "");
    setServMin(service.min_quantity ? String(service.min_quantity) : "");
    setServMax(service.max_quantity ? String(service.max_quantity) : "");
    setShowEditService(true);
  };

  const handleUpdateCategory = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingCategory || !catName.trim()) return alert("Category name is required.");

    setLoading(true);
    const res = await updateCategory(editingCategory.id, catName, catDesc, editingCategory.is_active);
    setLoading(false);

    if (res.error) return alert(res.error);

    setShowEditCategory(false);
    setEditingCategory(null);
    setCatName("");
    setCatDesc("");
    setMsg("Category updated successfully!");
    setTimeout(() => setMsg(""), 3000);
    loadData();
  };

  const handleUpdateService = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingService || !servName.trim()) return alert("Service name is required.");
    const priceNum = parseFloat(servPrice);
    if (isNaN(priceNum) || priceNum < 0) return alert("Please enter a valid price.");

    const quantityProblem = quantityFormError();
    if (quantityProblem) return alert(quantityProblem);

    setLoading(true);
    const res = await updateService(
      editingService.id,
      servName,
      priceNum,
      servDesc,
      editingService.is_active,
      quantityInput(),
    );
    setLoading(false);

    if (res.error) return alert(res.error);

    setShowEditService(false);
    setEditingService(null);
    clearServiceForm();
    setMsg("Service updated successfully!");
    setTimeout(() => setMsg(""), 3000);
    loadData();
  };

  /** The category switch controls what customers can see in the new-broadcast picker. */
  const handleToggleCategory = async (cat: Category) => {
    const res = await updateCategory(cat.id, cat.name, cat.description, !cat.is_active);
    if (res.error) return alert(res.error);
    loadData();
  };

  const handleToggleService = async (service: Service) => {
    const res = await updateService(service.id, service.name, Number(service.price), service.description, !service.is_active);
    if (res.error) return alert(res.error);
    loadData();
  };

  const filteredCategories = categories.filter(cat =>
    cat.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    cat.services?.some(s => s.name.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <>
      <Heading eyebrow="ADMIN CONSOLE" title="Services Management" text="Manage categories and services offered to customers."/>
      {msg && <div className="flash-success">✓ {msg}</div>}

      <div className="services-toolbar">
        <div className="services-actions">
          <button className="primary" onClick={() => setShowNewService(true)}>
            <Icon name="plus" size={16}/> New Service
          </button>
          <button className="outline" onClick={() => setShowNewCategory(true)}>
            <Icon name="plus" size={16}/> New Category
          </button>
        </div>
        <div className="services-search">
          <div className="search">
            <Icon name="search" size={16}/>
            <input 
              placeholder="Search services or categories..." 
              value={searchTerm} 
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
      </div>

      {showNewCategory && (
        <div className="modal-backdrop" onClick={() => setShowNewCategory(false)}>
          <div className="modal compact-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <p className="eyebrow">NEW CATEGORY</p>
                <h2>Create Category</h2>
              </div>
              <button className="close" onClick={() => setShowNewCategory(false)}>
                <Icon name="close"/>
              </button>
            </div>
            <form onSubmit={handleAddCategory}>
              <label>Category name
                <input 
                  required 
                  placeholder="e.g. Instagram Services" 
                  value={catName} 
                  onChange={e => setCatName(e.target.value)}
                />
              </label>
              <label>Description (optional)
                <textarea 
                  rows={3} 
                  placeholder="Brief description of this category" 
                  value={catDesc} 
                  onChange={e => setCatDesc(e.target.value)}
                />
              </label>
              <div className="modal-footer">
                <button type="button" className="outline" onClick={() => setShowNewCategory(false)}>Cancel</button>
                <button type="submit" className="primary" disabled={loading}>
                  {loading ? 'Creating...' : 'Create Category'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showNewService && (
        <div className="modal-backdrop" onClick={() => setShowNewService(false)}>
          <div className="modal compact-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <p className="eyebrow">NEW SERVICE</p>
                <h2>Add Service</h2>
              </div>
              <button className="close" onClick={() => setShowNewService(false)}>
                <Icon name="close"/>
              </button>
            </div>
            <form onSubmit={handleAddService}>
              <label>Select category
                <select value={selectedCatId} onChange={e => setSelectedCatId(e.target.value)} required>
                  <option value="">-- Choose category --</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label>Service name
                <input 
                  required 
                  placeholder="e.g. Instagram Followers" 
                  value={servName} 
                  onChange={e => setServName(e.target.value)}
                />
              </label>
              <label>Price (₹)
                <input 
                  type="number" 
                  step="0.01" 
                  required 
                  placeholder="40.00" 
                  value={servPrice} 
                  onChange={e => setServPrice(e.target.value)}
                />
              </label>
              <ServiceQuantityFields
                mode={servMode} setMode={setServMode}
                price={servPrice}
                units={servUnits} setUnits={setServUnits}
                min={servMin} setMin={setServMin}
                max={servMax} setMax={setServMax}
              />
              <label>Description (optional)
                <input 
                  placeholder="Service details" 
                  value={servDesc} 
                  onChange={e => setServDesc(e.target.value)}
                />
              </label>
              <div className="modal-footer">
                <button type="button" className="outline" onClick={() => setShowNewService(false)}>Cancel</button>
                <button type="submit" className="primary" disabled={loading}>
                  {loading ? 'Adding...' : 'Add Service'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <section className="panel data-panel services-panel">
        <div className="services-list">
          {filteredCategories.length === 0 ? (
            <div className="empty-state">
              <Icon name="layers" size={48}/>
              <p>No categories or services found.</p>
              <button className="primary" onClick={() => setShowNewCategory(true)}>
                <Icon name="plus" size={16}/> Create First Category
              </button>
            </div>
          ) : (
            filteredCategories.map(cat => (
              <div key={cat.id} className="service-category-card">
                <div className="category-header">
                  <div className="category-info">
                    <div className="category-toggle">
                      <input
                        type="checkbox"
                        checked={cat.is_active !== false}
                        onChange={() => handleToggleCategory(cat)}
                        className="toggle-switch"
                        title={cat.is_active !== false ? "Visible to customers — click to hide" : "Hidden from customers — click to show"}
                      />
                    </div>
                    <div className="category-details">
                      <h3>{cat.name}{cat.is_active === false && <span className="muted-tag">Hidden</span>}</h3>
                      {cat.description && <p>{cat.description}</p>}
                    </div>
                  </div>
                  <div className="category-actions">
                    <button className="icon-btn" onClick={() => handleEditCategory(cat)} title="Edit category">
                      <Icon name="edit" size={16}/>
                    </button>
                    <button className="icon-btn danger" onClick={() => handleDeleteCategory(cat.id)} title="Delete category">
                      <Icon name="trash" size={16}/>
                    </button>
                  </div>
                </div>

                {cat.services && cat.services.length > 0 && (
                  <div className="services-table">
                    <table>
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Service Name</th>
                          <th>Type</th>
                          <th>Price</th>
                          <th>Status</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cat.services.map((s, idx) => (
                          <tr key={s.id}>
                            <td>{idx + 1}</td>
                            <td>
                              <div className="service-name">
                                <strong>{s.name}</strong>
                                {s.description && <small>{s.description}</small>}
                              </div>
                            </td>
                            <td>
                              {/* Per-unit or flat, stated on the row. Without it there is no way
                                  to tell a service that bills by the number from one that does
                                  not, and a save that quietly did neither looks identical. */}
                              <span className={`service-type ${isQuantityPriced(s) ? "per-unit" : ""}`}>
                                {isQuantityPriced(s) ? "Per unit" : "Flat"}
                              </span>
                            </td>
                            <td>
                              <strong className="amount">₹{Number(s.price).toFixed(2)}</strong>
                              {isQuantityPriced(s) ? (
                                <small className="service-rate">
                                  per {Number(s.unit_quantity).toLocaleString("en-IN")} · ₹{formatRate(unitRate(s))}/number
                                  <br/>
                                  {minQuantityOf(s).toLocaleString("en-IN")}–{maxQuantityOf(s) === null ? "∞" : maxQuantityOf(s)!.toLocaleString("en-IN")} per order
                                </small>
                              ) : (
                                <small className="service-rate muted-rate">per order</small>
                              )}
                            </td>
                            <td>
                              <button
                                className="badge-button"
                                onClick={() => handleToggleService(s)}
                                title={s.is_active ? "Disable this service" : "Enable this service"}
                                type="button"
                              >
                                <Badge status={s.is_active ? "Enabled" : "Disabled"}/>
                              </button>
                            </td>
                            <td>
                              <div className="row-actions">
                                <button className="icon-btn" onClick={() => handleEditService(s, cat.id)} title="Edit service">
                                  <Icon name="edit" size={14}/>
                                </button>
                                <button className="icon-btn danger" onClick={() => handleDeleteService(s.id)} title="Delete service">
                                  <Icon name="trash" size={14}/>
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      {showEditCategory && editingCategory && (
        <div className="modal-backdrop" onClick={() => setShowEditCategory(false)}>
          <div className="modal compact-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <p className="eyebrow">EDIT CATEGORY</p>
                <h2>Update Category</h2>
              </div>
              <button className="close" onClick={() => setShowEditCategory(false)}>
                <Icon name="close"/>
              </button>
            </div>
            <form onSubmit={handleUpdateCategory}>
              <label>Category name
                <input 
                  required 
                  placeholder="e.g. Instagram Services" 
                  value={catName} 
                  onChange={e => setCatName(e.target.value)}
                />
              </label>
              <label>Description (optional)
                <textarea 
                  rows={3} 
                  placeholder="Brief description of this category" 
                  value={catDesc} 
                  onChange={e => setCatDesc(e.target.value)}
                />
              </label>
              <div className="modal-footer">
                <button type="button" className="outline" onClick={() => setShowEditCategory(false)}>Cancel</button>
                <button type="submit" className="primary" disabled={loading}>
                  {loading ? 'Updating...' : 'Update Category'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEditService && editingService && (
        <div className="modal-backdrop" onClick={() => setShowEditService(false)}>
          <div className="modal compact-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <p className="eyebrow">EDIT SERVICE</p>
                <h2>Update Service</h2>
              </div>
              <button className="close" onClick={() => setShowEditService(false)}>
                <Icon name="close"/>
              </button>
            </div>
            <form onSubmit={handleUpdateService}>
              <label>Select category
                <select value={selectedCatId} onChange={e => setSelectedCatId(e.target.value)} required>
                  <option value="">-- Choose category --</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label>Service name
                <input 
                  required 
                  placeholder="e.g. Instagram Followers" 
                  value={servName} 
                  onChange={e => setServName(e.target.value)}
                />
              </label>
              <label>Price (₹)
                <input 
                  type="number" 
                  step="0.01" 
                  required 
                  placeholder="40.00" 
                  value={servPrice} 
                  onChange={e => setServPrice(e.target.value)}
                />
              </label>
              <ServiceQuantityFields
                mode={servMode} setMode={setServMode}
                price={servPrice}
                units={servUnits} setUnits={setServUnits}
                min={servMin} setMin={setServMin}
                max={servMax} setMax={setServMax}
              />
              <label>Description (optional)
                <input 
                  placeholder="Service details" 
                  value={servDesc} 
                  onChange={e => setServDesc(e.target.value)}
                />
              </label>
              <div className="modal-footer">
                <button type="button" className="outline" onClick={() => setShowEditService(false)}>Cancel</button>
                <button type="submit" className="primary" disabled={loading}>
                  {loading ? 'Updating...' : 'Update Service'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

const BROADCAST_TABS: Array<[string, (o: Order) => boolean]> = [
  ["All", () => true],
  ["Pending", o => o.status === "Placed"],
  ["In progress", o => o.status === "In progress"],
  ["On hold", o => o.status === "On hold"],
  ["Completed", o => o.status === "Completed"],
  ["Partial", o => o.status === "Partial"],
  ["Cancelled", o => o.status === "Cancelled"],
  ["Refunded", o => o.status === "Refunded"],
];

function BroadcastTable({ orders, onSelect, admin = false, onViewCustomer }: { orders: Order[]; onSelect: (o: Order) => void; admin?: boolean; onViewCustomer?: (email: string) => void }) {
  const [statusTab, setStatusTab] = useState<string>("All");
  const activeTab = BROADCAST_TABS.find(([label]) => label === statusTab) || BROADCAST_TABS[0];
  const filteredOrders = orders.filter(activeTab[1]);

  return (
    <div>
      <div className="status-tabs">
        {BROADCAST_TABS.map(([label, match]) => (
          <button
            key={label}
            onClick={() => setStatusTab(label)}
            className={`status-tab ${statusTab === label ? "on" : ""}`}
          >
            {label}
            <span className="status-tab-count">{orders.filter(match).length}</span>
          </button>
        ))}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="id-head">Broadcast ID</th>
              <th>Date</th>
              {admin && <th>Customer</th>}
              <th>Category &amp; service</th>
              <th>Voice</th>
              <th>Contacts</th>
              <th>Charge</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredOrders.length ? filteredOrders.map((o) => (
              <tr key={o.id}>
                <td className="sno-col"><strong>{o.id}</strong></td>
                <td className="muted-cell">{o.created}</td>
                {admin && <td>{onViewCustomer ? <button className="customer-link" onClick={() => onViewCustomer(o.email)}>{o.customer}</button> : o.customer}</td>}
                <td>
                  <strong>{o.categoryName || o.name}</strong>
                  {o.serviceName && <div className="service-line">{o.serviceName}</div>}
                </td>
                <td>
                  <span className={`voice-tag ${o.voiceType === 'FEMALE' ? 'female' : 'male'}`}>
                    {o.voiceType === 'FEMALE' ? 'Female' : 'Male'}
                  </span>
                </td>
                <td>
                  <div><strong>{o.contacts}</strong></div>
                  <small>{o.contactsInputType === 'MANUAL' ? 'Text paste' : 'File upload'}</small>
                </td>
                <td><strong className="amount">₹{(o.charge || 0).toFixed(2)}</strong></td>
                <td><Badge status={o.status}/></td>
                <td><button className="outline small" onClick={() => onSelect(o)}>View</button></td>
              </tr>
            )) : (
              <tr><td colSpan={admin ? 9 : 8} className="empty">No broadcasts found under {statusTab}.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TicketTable({ tickets, admin = false, onSelect }: { tickets: Ticket[]; admin?: boolean; onSelect: (t: Ticket) => void }) { return <div className="table-wrap"><table><thead><tr><th>Ticket</th>{admin && <th>Customer</th>}<th>Priority</th><th>Status</th><th>Created</th><th>Action</th></tr></thead><tbody>{tickets.length ? tickets.map(t => <tr key={t.id}><td><strong>{t.subject}</strong><small>{t.id} · {t.message.length > 30 ? t.message.slice(0, 27) + "..." : t.message}</small></td>{admin && <td>{t.customer}</td>}<td><span className={t.priority === "High" ? "priority overdue" : "priority new"}>{t.priority}</span></td><td><Badge status={t.status}/></td><td>{t.created}</td><td><button className="text-button row-text" onClick={() => onSelect(t)}>View</button></td></tr>) : <tr><td colSpan={admin ? 6 : 5} className="empty">No support tickets found.</td></tr>}</tbody></table></div>; }

/**
 * How a service charges. Per-unit is the default for anything new: a flat price per order was
 * the only option this panel used to have, and leaving it as the unstated default meant an
 * operator could fill in a price, save, and never notice that the per-number fields they
 * skipped were the ones that made the price behave the way they meant.
 */
type PricingMode = "QUANTITY" | "FLAT";

/**
 * A per-number rate at the precision it actually needs.
 *
 * Two decimals normally, because a rate is money and "Rs 0.1" reads as a typo. More only when
 * two would lose the value: Rs 10 per 300 is Rs 0.0333, and rounding that to Rs 0.03 would
 * misstate the rate by a tenth.
 */
function formatRate(rate: number): string {
  const two = rate.toFixed(2);
  return Number(two) === Number(rate.toFixed(4)) ? two : rate.toFixed(4).replace(/0+$/, "");
}

/**
 * An amount with Indian digit grouping. Quantity pricing made these numbers big enough to
 * need it - "Rs 10000.10" is misread at a glance in a way "Rs 10,000.10" is not.
 */
function formatMoney(amount: number): string {
  return amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * The order-size band under the phone-number box: what this service accepts, how many numbers
 * are in the box right now, and what they come to.
 *
 * Shown from the moment a per-unit service is selected, before anything is typed, because the
 * minimum is the thing a customer most needs to know *before* they start pasting - not after
 * being turned away. Count and total recompute on every keystroke, from the same parser and
 * the same pricing function the server bills with, so what is displayed here is what the
 * order is charged.
 */
function QuantityQuote({ service, count, busy }: { service: Service | undefined; count: number; busy?: boolean }) {
  // A flat-priced service has no bounds and no per-number rate to show; it keeps the plain
  // confirmation it had before quantity pricing existed.
  if (!service || !isQuantityPriced(service)) {
    return count > 0 ? (
      <div className="flash-success small-flash">✓ {count.toLocaleString("en-IN")} contacts ready</div>
    ) : null;
  }

  const min = minQuantityOf(service);
  const max = maxQuantityOf(service);
  const rate = unitRate(service);
  const total = quoteTotal(service, count);
  const problem = count > 0 ? validateQuantity(service, count) : null;

  const state = busy ? "busy" : count === 0 ? "empty" : problem ? "invalid" : "valid";

  return (
    <div className={`quantity-quote ${state}`}>
      <div className="quote-bounds">
        <span>Min <strong>{min.toLocaleString("en-IN")}</strong></span>
        <span className="quote-dash" aria-hidden="true">—</span>
        <span>Max <strong>{max === null ? "no limit" : max.toLocaleString("en-IN")}</strong></span>
      </div>

      <div className="quote-live">
        {busy ? (
          <span className="quote-counting">Counting numbers…</span>
        ) : (
          <>
            <span className="quote-count">{count.toLocaleString("en-IN")}</span>
            <span className="quote-times"> × ₹{formatRate(rate)} = </span>
            <span className="quote-amount">₹{formatMoney(total)}</span>
          </>
        )}
      </div>

      {!busy && (
        <div className="quote-hint">
          {problem
            ? problem
            : count === 0
              ? `Each line is one number. Enter at least ${min.toLocaleString("en-IN")} to place this order.`
              : max !== null
                ? `✓ Within limits · ${(max - count).toLocaleString("en-IN")} more allowed`
                : "✓ Within limits"}
        </div>
      )}
    </div>
  );
}

function BroadcastModal({ onClose, onSubmit, session, balance, price }: { onClose: () => void; onSubmit: (o: any) => Promise<SubmitResult>; session: Session; balance: number; price: string }) {
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCatId, setSelectedCatId] = useState("");
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [voiceType, setVoiceType] = useState<'MALE' | 'FEMALE'>("MALE");
  
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioInputMethod, setAudioInputMethod] = useState<'FILE' | 'TTS'>("FILE");
  const [ttsText, setTtsText] = useState("");
  
  // Numbers upload tab
  const [inputMethod, setInputMethod] = useState<'FILE' | 'MANUAL'>("FILE");
  const [contactsFile, setContactsFile] = useState<File | null>(null);
  const [manualText, setManualText] = useState("");

  const [contactsCount, setContactsCount] = useState<number>(0);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState("");
  const [scheduleType, setScheduleType] = useState("Start on processing");

  useEffect(() => {
    async function loadCategories() {
      const res = await getCategoriesWithServices();
      if (res.data) {
        setCategories(res.data);
      }
    }
    loadCategories();
  }, []);

  const currentCategory = categories.find(c => c.id === selectedCatId);
  const availableServices = currentCategory?.services || [];
  const currentService = availableServices.find(s => s.id === selectedServiceId);

  // The running total. A quantity-priced service multiplies its rate by however many numbers
  // are in the box right now, so this recomputes on every keystroke; a flat-priced service
  // ignores the count entirely and quotes its price, exactly as it always did.
  const quantityPriced = currentService ? isQuantityPriced(currentService) : false;
  const calculatedCost = currentService ? quoteTotal(currentService, contactsCount) : 0;
  const canAfford = balance >= calculatedCost;

  // Shown, never trusted: the same check runs on the server against a count the server did
  // itself, and that is the one that decides whether the order is accepted.
  const quantityProblem =
    currentService && quantityPriced && contactsCount > 0
      ? validateQuantity(currentService, contactsCount)
      : null;

  /**
   * Whether the order can be placed at the current quantity.
   *
   * An empty box counts as blocked even though it raises no *problem* to display - the band
   * stays neutral and explains what to do, rather than scolding someone who has not started
   * typing, but the button must not sit there enabled offering to debit Rs 0.00.
   */
  const quantityBlocked = Boolean(
    currentService && quantityPriced && (contactsCount === 0 || quantityProblem)
  );

  /**
   * Counts the numbers in an uploaded list so the order can be quoted before it is placed.
   *
   * Uses the same parser the server bills with (`countNumbers`), across every sheet of a
   * workbook rather than only the first, so the total shown here is the total charged. An
   * unreadable file counts zero rather than guessing at one number per 15 bytes, as this used
   * to: under quantity pricing a guess is a quote the server will not honour.
   */
  const parseContactsFile = async (file: File) => {
    setIsParsing(true);
    setParseError("");
    try {
      const ext = file.name.split('.').pop()?.toLowerCase();
      let count = 0;

      if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm' || ext === 'ods') {
        const XLSX = await loadXLSX();
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data);
        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          if (sheet) count += countNumbers(XLSX.utils.sheet_to_csv(sheet));
        }
      } else {
        count = countNumbers(await file.text());
      }

      setContactsCount(count);
      if (count === 0) {
        setParseError(
          "No phone numbers were found in that file. They should be one per line or one per cell, " +
          "10 to 15 digits each. You can also paste them in using \u201cType / paste\u201d."
        );
      }
    } catch (e) {
      console.error("File parse error:", e);
      setContactsCount(0);
      setParseError("That file could not be read. Try CSV, TXT or XLSX, or paste the numbers in directly.");
    } finally {
      setIsParsing(false);
    }
  };

  const handleContactsFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setContactsFile(file || null);
    setParseError("");
    if (file) {
      parseContactsFile(file);
    } else {
      setContactsCount(0);
    }
  };

  // Live counter for typed or pasted numbers. Shares `countNumbers` with the server, so the
  // figure driving the running total is the figure the order is billed on.
  const handleManualTextChange = (text: string) => {
    setManualText(text);
    setContactsCount(countNumbers(text));
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitError("");

    if (!selectedCatId) return setSubmitError("Please select a category.");
    if (!selectedServiceId) return setSubmitError("Please select a service.");

    // Order size is checked before affordability: when an order is both below the minimum and,
    // at that size, nearly free, "you need at least 100 numbers" is the message that helps.
    if (currentService && quantityPriced) {
      const problem = validateQuantity(currentService, contactsCount);
      if (problem) return setSubmitError(problem);
    }

    if (!canAfford) return setSubmitError(`Insufficient balance. Your wallet holds ₹${balance.toFixed(2)}, but this order costs ₹${calculatedCost.toFixed(2)}.`);

    if (audioInputMethod === 'FILE' && !audioFile) {
      return setSubmitError("Please upload an audio file.");
    }
    if (audioInputMethod === 'TTS' && !ttsText.trim()) {
      return setSubmitError("Please enter the text to convert to speech.");
    }

    if (inputMethod === 'FILE' && !contactsFile) {
      return setSubmitError("Please upload a target contact list file.");
    }
    if (inputMethod === 'MANUAL' && !manualText.trim()) {
      return setSubmitError("Please enter target phone numbers.");
    }

    // Checked here as well as on the server: an oversized upload is rejected by the platform
    // before the action runs, so the server-side message would never reach the customer.
    if (audioFile && audioFile.size > UPLOAD_LIMITS.AUDIO) {
      return setSubmitError(`The audio file is ${formatFileSize(audioFile.size)}. The limit is ${describeLimit(UPLOAD_LIMITS.AUDIO)}.`);
    }
    if (contactsFile && contactsFile.size > UPLOAD_LIMITS.CONTACTS) {
      return setSubmitError(`The contact list is ${formatFileSize(contactsFile.size)}. The limit is ${describeLimit(UPLOAD_LIMITS.CONTACTS)}.`);
    }

    const data = new FormData(e.currentTarget);
    let finalSchedule = String(data.get("schedule"));
    if (finalSchedule === "Schedule for later") {
      const dateVal = String(data.get("scheduleDate"));
      if (!dateVal) return setSubmitError("Please select a date for the scheduled broadcast.");
      if (!isInTheFuture(dateVal)) {
        return setSubmitError("A scheduled broadcast must be set for a time in the future.");
      }
      finalSchedule = dateVal;
    }

    setSubmitting(true);

    // Upload straight to Supabase Storage first. Nothing is charged and no order is created
    // until every file is safely stored, so a failed upload costs the customer nothing.
    const pending: Array<{ kind: "audio" | "contacts"; file: File; label: string }> = [];
    if (audioInputMethod === 'FILE' && audioFile) pending.push({ kind: "audio", file: audioFile, label: audioFile.name });
    if (inputMethod === 'FILE' && contactsFile) pending.push({ kind: "contacts", file: contactsFile, label: contactsFile.name });

    const uploads = await uploadFiles(pending, (percent, label) => {
      setProgress(percent);
      setProgressLabel(label ? `Uploading ${label}` : "");
    });
    setProgressLabel("");

    if (!uploads.ok) {
      setSubmitting(false);
      setProgress(0);
      return setSubmitError(uploads.error);
    }

    let index = 0;
    const audioKey = audioInputMethod === 'FILE' && audioFile ? uploads.keys[index++] : "";
    const contactsKey = inputMethod === 'FILE' && contactsFile ? uploads.keys[index] : "";

    const result = await onSubmit({
      categoryId: selectedCatId,
      categoryName: currentCategory?.name || '',
      serviceId: selectedServiceId,
      serviceName: currentService?.name || '',
      voiceType,
      notes: String(data.get("notes") || ""),
      audioKey,
      audioInputMethod,
      ttsText: audioInputMethod === 'TTS' ? ttsText : '',
      contactsInputType: inputMethod,
      contactsKey,
      manualContacts: inputMethod === 'MANUAL' ? manualText : '',
      contactCount: contactsCount,
      charge: calculatedCost,
      schedule: finalSchedule
    });
    setSubmitting(false);
    setProgress(0);
    if (!result.ok) setSubmitError(result.error || "The broadcast could not be created.");
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <form className="modal order-modal" onSubmit={submit}>
        <div className="modal-head">
          <div><p className="eyebrow">NEW BROADCAST</p><h2>Create new broadcast</h2><p>Select a category and service for your IVR broadcast campaign.</p></div>
          <button type="button" className="close" onClick={onClose}><Icon name="close"/></button>
        </div>

        {/* 1. Category Selection */}
        <label className="field-label">Category
          <select
            value={selectedCatId}
            onChange={e => { setSelectedCatId(e.target.value); setSelectedServiceId(""); }}
            required
          >
            <option value="">-- Select category --</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        {categories.length === 0 && (
          <p className="text-muted">No categories are available yet. Please contact support.</p>
        )}

        {/* 2. Service Selection */}
        <label className="field-label">Service
          <select
            value={selectedServiceId}
            onChange={e => setSelectedServiceId(e.target.value)}
            disabled={!selectedCatId}
            required
          >
            <option value="">{!selectedCatId ? "First select a category above…" : "-- Select service --"}</option>
            {availableServices.map(s => (
              <option key={s.id} value={s.id}>{s.name} — ₹{Number(s.price).toFixed(2)}</option>
            ))}
          </select>
        </label>

        {/* 3. Voice Selection */}
        <div className="field-block">
          <label className="field-label">Select voice</label>
          <div className="voice-picker">
            <button type="button" onClick={() => setVoiceType('MALE')} className={`voice-option ${voiceType === 'MALE' ? "on" : ""}`}>
              <Icon name="mic" size={16}/> Male voice
            </button>
            <button type="button" onClick={() => setVoiceType('FEMALE')} className={`voice-option female ${voiceType === 'FEMALE' ? "on" : ""}`}>
              <Icon name="mic" size={16}/> Female voice
            </button>
          </div>
        </div>

        {/* 4. Audio Input Method Selection */}
        <div className="field-block">
          <div className="field-row">
            <label className="field-label">Audio source</label>
            <div className="segmented tight">
              <button type="button" className={audioInputMethod === 'FILE' ? 'on' : ''} onClick={() => setAudioInputMethod('FILE')}>Upload file</button>
              <button type="button" className={audioInputMethod === 'TTS' ? 'on' : ''} onClick={() => setAudioInputMethod('TTS')}>Text to speech</button>
            </div>
          </div>

          {audioInputMethod === 'FILE' ? (
            <label className="field-label">Audio file
              <span className="dropzone">
                {audioFile ? (
                  <><Icon name="check"/><b>{audioFile.name}</b><small>Ready to upload</small></>
                ) : (
                  <><Icon name="upload"/><b>Upload audio file</b><small>Maximum {describeLimit(UPLOAD_LIMITS.AUDIO)} (.mp3, .wav, .aac)</small></>
                )}
                <input name="audio" type="file" onChange={e => setAudioFile(e.target.files?.[0] || null)} accept="audio/*"/>
              </span>
            </label>
          ) : (
            <label className="field-label">Text to convert to speech
              <textarea
                rows={4}
                placeholder="Type or paste the text you want to convert to speech. The system will generate an audio file using AI voice..."
                value={ttsText}
                onChange={e => setTtsText(e.target.value)}
              />
              {ttsText.trim().length > 0 && (
                <div className="flash-success small-flash">✓ {ttsText.trim().length} characters ready for conversion</div>
              )}
            </label>
          )}
        </div>

        {/* 5. Target Numbers Upload (Two Methods) */}
        <div className="field-block">
          <div className="field-row">
            <label className="field-label">Target phone numbers</label>
            <div className="segmented tight">
              <button type="button" className={inputMethod === 'FILE' ? 'on' : ''} onClick={() => setInputMethod('FILE')}>File upload</button>
              <button type="button" className={inputMethod === 'MANUAL' ? 'on' : ''} onClick={() => setInputMethod('MANUAL')}>Type / paste</button>
            </div>
          </div>

          {inputMethod === 'FILE' ? (
            <div>
              <span className={`dropzone ${isParsing ? "busy" : ""}`}>
                {contactsFile ? (
                  <><Icon name="check"/><b>{contactsFile.name}</b><small>{isParsing ? "Scanning file…" : `${contactsCount} contacts found`}</small></>
                ) : (
                  <><Icon name="upload"/><b>Upload contact list file</b><small>Any file type · up to {describeLimit(UPLOAD_LIMITS.CONTACTS)}</small></>
                )}
                <input type="file" onChange={handleContactsFileChange}/>
              </span>
              {parseError && <div className="form-error small-flash">{parseError}</div>}
              {(contactsFile || quantityPriced) && !parseError && (
                <QuantityQuote service={currentService} count={contactsFile ? contactsCount : 0} busy={isParsing} />
              )}
            </div>
          ) : (
            <div>
              <textarea
                rows={8}
                className="mono"
                placeholder={"Type one number and press enter for the next…\n9876543210\n9123456789"}
                value={manualText}
                onChange={e => handleManualTextChange(e.target.value)}
              />
              {(manualText.trim().length > 0 || quantityPriced) && (
                <QuantityQuote service={currentService} count={contactsCount} />
              )}
            </div>
          )}
        </div>

        {/* 6. Schedule & Instructions */}
        <div className="form-grid" style={{alignItems: 'end'}}>
          <label>Schedule
            <select name="schedule" value={scheduleType} onChange={e => setScheduleType(e.target.value)}>
              <option>Start on processing</option>
              <option>Schedule for later</option>
            </select>
          </label>
          {scheduleType === "Schedule for later" && (
            <label>Select Date<input type="datetime-local" name="scheduleDate" required/></label>
          )}
        </div>

        <label>Message / Instructions 
          <textarea name="notes" placeholder="Write any additional message or instructions for our operations team..." rows={3}/>
        </label>

        {/* 7. Summary Box */}
        <div className="summary-box">
          <div className="summary-row"><span>Selected service</span><strong>{currentService ? currentService.name : 'None selected'}</strong></div>
          <div className="summary-row"><span>Selected voice</span><strong>{voiceType === 'FEMALE' ? 'Female voice' : 'Male voice'}</strong></div>
          <div className="summary-row"><span>Target contacts</span><strong>{contactsCount > 0 ? `${contactsCount.toLocaleString("en-IN")} contacts` : '-'}</strong></div>
          {currentService && quantityPriced && (
            <div className="summary-row"><span>Rate</span><strong>₹{formatRate(unitRate(currentService))} per number</strong></div>
          )}
          <div className="summary-row total"><span>Total charge</span><strong>₹{formatMoney(calculatedCost)}</strong></div>
          {quantityProblem && <p className="summary-warn">{quantityProblem}</p>}
          {!canAfford && currentService && (
            <p className="summary-warn">Insufficient balance (₹{balance.toFixed(2)} available)</p>
          )}
        </div>

        {submitError && <div className="form-error">{submitError}</div>}

        <UploadProgress percent={progress} label={progressLabel} active={submitting && Boolean(progressLabel)} />

        <div className="modal-footer">
          <button type="button" className="outline" onClick={onClose} disabled={submitting}>Cancel</button>
          <button className="primary" disabled={submitting || isParsing || !selectedServiceId || !canAfford || quantityBlocked}>
            {submitting
              ? (progressLabel ? `Uploading… ${progress}%` : "Placing order…")
              : quantityBlocked
                // Naming a debit on a button that cannot be pressed reads as the price of an
                // order the customer is not being allowed to place. Say what is missing.
                ? <>{contactsCount < minQuantityOf(currentService!) ? "Enter at least " + minQuantityOf(currentService!).toLocaleString("en-IN") + " numbers" : "Too many numbers for this service"}</>
                : <>Confirm &amp; debit ₹{formatMoney(calculatedCost)} <Icon name="arrow" size={16}/></>}
          </button>
        </div>
      </form>
    </div>
  ); 
}

function TicketModal({ onClose, onSubmit, session }: { onClose: () => void; onSubmit: (t: Ticket) => Promise<SubmitResult>; session: Session }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    setSubmitting(true);
    setError("");
    const result = await onSubmit({
      id: "",
      subject: String(d.get("subject")),
      customer: session.company || session.name,
      priority: String(d.get("priority")) as "Normal" | "High",
      status: "Open",
      message: String(d.get("message")),
      created: "Just now"
    });
    setSubmitting(false);
    if (!result.ok) setError(result.error || "The ticket could not be created.");
  };
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <form className="modal compact-modal" onSubmit={submit}>
        <div className="modal-head"><div><p className="eyebrow">SUPPORT</p><h2>New support ticket</h2><p>Describe your issue and we&apos;ll get back to you.</p></div><button type="button" className="close" onClick={onClose}><Icon name="close"/></button></div>
        <label>Subject<input name="subject" required placeholder="How can we help?"/></label>
        <label>Priority<select name="priority"><option>Normal</option><option>High</option></select></label>
        <label>Message<textarea name="message" required rows={5} placeholder="Give us the details…"/></label>
        {error && <div className="form-error">{error}</div>}
        <div className="modal-footer"><button type="button" className="outline" onClick={onClose} disabled={submitting}>Cancel</button><button className="primary" disabled={submitting}>{submitting ? "Submitting…" : <>Create ticket <Icon name="arrow" size={16}/></>}</button></div>
      </form>
    </div>
  ); 
}

function StatusTimeline({ currentStatus }: { currentStatus: Status }) {
  const steps = [
    { label: "Placed", key: "Placed" },
    { label: "In progress", key: "In progress" },
    { label: "Completed", key: "Completed" }
  ];
  
  if (currentStatus === "Cancelled") steps[2] = { label: "Cancelled", key: "Cancelled" };
  if (currentStatus === "Refunded") steps[2] = { label: "Refunded", key: "Refunded" };
  // Partial is still an end state for the run, so it takes the final step rather than
  // leaving the timeline showing an order that never finished.
  if (currentStatus === "Partial") steps[2] = { label: "Partial", key: "Partial" };
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

/**
 * Every status this broadcast has been through, oldest first. The rows come from
 * broadcast_status_history, which is written on creation, on every admin status change and
 * on a customer resubmission - so this is the customer-visible order history.
 */
function OrderStatusHistory({ history, created }: { history?: OrderHistory[]; created: string }) {
  const entries = history && history.length > 0
    ? history
    : [{ status: "PLACED", reason: undefined, created_at: created }];

  const toneFor = (status: string) => {
    const s = status.toUpperCase();
    if (s === "COMPLETED" || s === "PARTIAL") return "green";
    if (s === "CANCELLED" || s === "REFUNDED") return "red";
    if (s === "ON_HOLD") return "amber";
    return "blue";
  };

  const when = (value: string) => {
    const date = new Date(value);
    return isNaN(date.getTime()) ? value : date.toLocaleString();
  };

  return (
    <div className="order-history">
      <div className="order-history-head">
        <Icon name="history" size={16}/>
        <strong>Order history</strong>
        <span className="text-muted">{entries.length} update{entries.length > 1 ? "s" : ""}</span>
      </div>
      <ol className="order-history-list">
        {entries.map((entry, i) => (
          <li key={`${entry.created_at}-${i}`} className={`order-history-item ${toneFor(entry.status)}`}>
            <span className="order-history-dot"/>
            <div>
              <div className="order-history-row">
                <Badge status={formatStatus(entry.status)}/>
                <small>{when(entry.created_at)}</small>
              </div>
              {entry.reason && <p className="order-history-reason">{entry.reason}</p>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function OrderModal({ order, admin, onClose, onUpdate, onResubmit }: {
  order: Order; 
  admin: boolean; 
  onClose: () => void; 
  onUpdate: (
    id: string, 
    s: Status, 
    payload?: { 
      reportKey?: string;
      holdReason?: string;
      cancelReason?: string; 
      refundReason?: string; 
      refundAmount?: number;
      partialRefundAmount?: number;
      confirmPartialRefundAmount?: number;
      deliveredCalls?: number;
      failedCalls?: number;
      adminComment?: string;
    }
  ) => Promise<SubmitResult>;
  onResubmit: (id: string, audioKey?: string, contactsKey?: string) => Promise<SubmitResult>;
}) {
  const [status, setStatus] = useState<Status>(order.status);
  const [reportFile, setReportFile] = useState<File | null>(null);

  /**
   * The pasted number list, fetched when the modal opens rather than carried in the orders
   * list. null means "still loading" so the textarea can say so instead of flashing empty and
   * looking like the customer submitted nothing.
   */
  const [contactsText, setContactsText] = useState<string | null>(
    order.contactsInputType === 'MANUAL' ? null : ''
  );

  useEffect(() => {
    if (order.contactsInputType !== 'MANUAL') return;
    let mounted = true;
    (async () => {
      const res = await getBroadcastContacts(order.id);
      if (!mounted) return;
      setContactsText(res.error ? `(${res.error})` : (res.data || ''));
    })();
    return () => { mounted = false; };
  }, [order.id, order.contactsInputType]);

  const [holdReason, setHoldReason] = useState(order.holdReason || "");
  const [cancelReason, setCancelReason] = useState(order.cancelReason || "");
  const [refundReason, setRefundReason] = useState(order.refundReason || "");
  const [refundAmount] = useState(order.refundAmount || "");

  // Double entry partial refund
  // The refund is driven by these two counts, taken off the fulfilment report.
  const [deliveredCalls, setDeliveredCalls] = useState<string>(order.deliveredCalls != null ? String(order.deliveredCalls) : "");
  const [failedCalls, setFailedCalls] = useState<string>(order.failedCalls != null ? String(order.failedCalls) : "");
  const [adminComment, setAdminComment] = useState<string>(order.adminComment || "");

  const [resubmitAudio, setResubmitAudio] = useState<File | null>(null);
  const [resubmitContacts, setResubmitContacts] = useState<File | null>(null);

  const [saving, setSaving] = useState(false);
  const [resubmitting, setResubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");

  // A report is attached whenever the run is closed out - a fully delivered campaign still
  // gets one. A refund only belongs on Partial: Completed means every call landed, and
  // Cancelled/Refunded already return the whole remaining charge on the server.
  const reportApplies = status === "Completed" || status === "Partial";
  const refundApplies = status === "Partial";
  const alreadyPartiallyRefunded = Boolean(order.partialRefundAmount && order.partialRefundAmount > 0);

  // What is still owed on this order, mirroring the server's own cap so the preview cannot
  // promise a figure the server will then reduce.
  const refundableRemaining = Math.max(0, Number(((order.charge || 0) - Number(order.partialRefundAmount || 0)).toFixed(2)));

  const deliveredNum = deliveredCalls.trim() === "" ? null : Number.parseInt(deliveredCalls, 10);
  const failedNum = failedCalls.trim() === "" ? null : Number.parseInt(failedCalls, 10);
  const hasCallCounts = deliveredCalls.trim() !== "" || failedCalls.trim() !== "";

  // The same function the server runs, so the number previewed here is the number credited.
  const refundBreakdown = refundApplies && hasCallCounts
    ? calculateFailedCallRefund(order.charge || 0, deliveredNum ?? 0, failedNum ?? 0, refundableRemaining)
    : null;

  const partialRefundValue = refundBreakdown?.ok ? refundBreakdown.refund : 0;
  const partialRefundOverCharge = partialRefundValue > (order.charge || 0);

  const reportTooLarge = Boolean(reportFile && reportFile.size > UPLOAD_LIMITS.REPORT);

  const blockingError = (refundBreakdown && !refundBreakdown.ok)
    ? refundBreakdown.error
    : partialRefundOverCharge
      ? `A partial refund cannot exceed the ₹${(order.charge || 0).toFixed(2)} charged for this order.`
      : reportTooLarge
        ? `The report file is larger than ${describeLimit(UPLOAD_LIMITS.REPORT)}. Please compress it before uploading.`
        : "";

  const handleDownload = async (key: string) => {
    const res = await getDownloadUrl(key);
    if (res.url) {
      window.open(res.url, '_blank');
    } else {
      setFormError("Could not generate a download link for that file. Please try again.");
    }
  };

  const handleAdminSubmit = async () => {
    if (blockingError) return setFormError(blockingError);

    setSaving(true);
    setFormError("");

    // The report goes browser -> Supabase Storage first; only its key is posted to the
    // action. Nothing is saved if the upload fails, so the order never moves without it.
    let reportKey: string | undefined;
    if (reportFile) {
      setProgressLabel(`Uploading ${reportFile.name}`);
      setProgress(0);
      const upload = await uploadFile("report", reportFile, setProgress);
      setProgressLabel("");
      if (!upload.ok) {
        setSaving(false);
        return setFormError(upload.error);
      }
      reportKey = upload.key;
    }

    const result = await onUpdate(order.id, status, {
      reportKey,
      holdReason,
      cancelReason,
      refundReason,
      refundAmount: Number(refundAmount),
      // Counts go up, not an amount. The server recomputes the refund from them.
      deliveredCalls: hasCallCounts ? (deliveredNum ?? 0) : undefined,
      failedCalls: hasCallCounts ? (failedNum ?? 0) : undefined,
      adminComment
    });

    setSaving(false);
    setProgress(0);
    // On success the parent closes this modal; on failure it stays open holding the file the
    // operator already picked, so the retry does not start from scratch.
    if (!result.ok) setFormError(result.error || "The update could not be saved.");
  };

  const handleResubmitClick = async () => {
    setResubmitting(true);
    setFormError("");

    const pending: Array<{ kind: "audio" | "contacts"; file: File; label: string }> = [];
    if (resubmitAudio) pending.push({ kind: "audio", file: resubmitAudio, label: resubmitAudio.name });
    if (resubmitContacts) pending.push({ kind: "contacts", file: resubmitContacts, label: resubmitContacts.name });

    const uploads = await uploadFiles(pending, (percent, label) => {
      setProgress(percent);
      setProgressLabel(label ? `Uploading ${label}` : "");
    });
    setProgressLabel("");

    if (!uploads.ok) {
      setResubmitting(false);
      setProgress(0);
      return setFormError(uploads.error);
    }

    let index = 0;
    const audioKey = resubmitAudio ? uploads.keys[index++] : undefined;
    const contactsKey = resubmitContacts ? uploads.keys[index] : undefined;

    const result = await onResubmit(order.id, audioKey, contactsKey);
    setResubmitting(false);
    setProgress(0);
    if (!result.ok) setFormError(result.error || "The files could not be resubmitted.");
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal order-modal">
        <div className="modal-head">
          <div><p className="eyebrow">{order.broadcastNo} · {order.id}</p><h2>{order.categoryName || order.name}</h2><p>{order.customer} · {order.contacts}</p></div>
          <button className="close" onClick={onClose}><Icon name="close"/></button>
        </div>

        <StatusTimeline currentStatus={order.status}/>

        <div className="detail-grid">
          <div><small>Current status</small><Badge status={order.status}/></div>
          <div><small>Voice type</small><strong>{order.voiceType === 'FEMALE' ? 'Female voice' : 'Male voice'}</strong></div>
          <div><small>Category &amp; service</small><strong>{order.categoryName || 'General'}</strong><span className="service-line">{order.serviceName}</span></div>
          <div><small>Total charge</small><strong className="amount">₹{(order.charge || 0).toFixed(2)}</strong></div>
          <div>
            <small>Audio asset</small>
            {order.audioKey ? (
              <button className="text-button" onClick={() => handleDownload(order.audioKey!)} title={order.audioKey}><Icon name="download" size={14}/>Download audio</button>
            ) : <span className="text-muted">No file</span>}
          </div>
          <div>
            <small>Contacts data</small>
            {order.contactsKey ? (
              <button className="text-button" onClick={() => handleDownload(order.contactsKey!)} title={order.contactsKey}><Icon name="download" size={14}/>Download contacts file</button>
            ) : order.contactsInputType === 'MANUAL' ? (
              <strong>Text paste ({(order.contactCount || 0).toLocaleString("en-IN")} numbers)</strong>
            ) : <span className="text-muted">No data</span>}
          </div>
        </div>

        {/* Display manual contacts to admin or customer if text paste was used. Loaded on
            demand: a pasted list can run to tens of thousands of numbers and does not belong
            in the payload of every screen that lists this order. */}
        {order.contactsInputType === 'MANUAL' && (
          <div className="detail-note">
            <strong>Target phone numbers (text paste)</strong>
            {contactsText === null ? (
              <p className="text-muted">Loading numbers…</p>
            ) : (
              <textarea readOnly rows={6} value={contactsText} className="mono readonly"/>
            )}
          </div>
        )}

        {order.notes && (
          <div className="detail-note">
            <strong>Customer instructions / message</strong>
            <p>{order.notes}</p>
          </div>
        )}

        <OrderStatusHistory history={order.history} created={order.created}/>

        {order.adminComment && (
          <div className="detail-note info">
            <strong>Admin remarks / report note</strong>
            <p>{order.adminComment}</p>
          </div>
        )}

        {order.partialRefundAmount && order.partialRefundAmount > 0 && (
          <div className="refund-box">
            <Icon name="check" size={18}/>
            <div>
              <strong>Partial refund credited (₹{order.partialRefundAmount.toFixed(2)})</strong>
              <p>Amount has been automatically credited back to the customer wallet balance.</p>
            </div>
          </div>
        )}

        {order.report && (
          <div className="report-ready">
            <Icon name="check"/>
            <div><strong>Performance report ready</strong><p>Report file has been uploaded to this broadcast.</p></div>
            <button className="outline" onClick={() => handleDownload(order.reportKey!)}><Icon name="download" size={14}/>Download report</button>
          </div>
        )}

        {!admin && order.status === "On hold" && order.holdReason && (
          <div className="hold-reason-box"><Icon name="pause" size={18}/><div><strong>Broadcast on hold — action required</strong><p>{order.holdReason}</p></div></div>
        )}

        {!admin && order.status === "On hold" && (
          <div className="resubmit-section">
            <h3>Resubmit files to resolve the issue</h3>
            <p className="resubmit-note">Upload a corrected audio file and/or contact list. Your broadcast will be moved back to &quot;Placed&quot; for review.</p>
            <div className="form-grid">
              <label>Audio file <span className="dropzone">{resubmitAudio ? <><Icon name="check"/><b>{resubmitAudio.name}</b><small>Ready</small></> : <><Icon name="upload"/><b>Replace audio</b><small>Optional</small></>}<input type="file" onChange={e => setResubmitAudio(e.target.files?.[0] || null)}/></span></label>
              <label>Contact list <span className="dropzone">{resubmitContacts ? <><Icon name="check"/><b>{resubmitContacts.name}</b><small>Ready</small></> : <><Icon name="upload"/><b>Replace contacts</b><small>Optional</small></>}<input type="file" onChange={e => setResubmitContacts(e.target.files?.[0] || null)}/></span></label>
            </div>
            <UploadProgress percent={progress} label={progressLabel} active={resubmitting} />
            <button className="primary" onClick={handleResubmitClick} disabled={resubmitting || (!resubmitAudio && !resubmitContacts)}>
              {resubmitting ? `Uploading… ${progress}%` : <>Resubmit files <Icon name="arrow" size={16}/></>}
            </button>
          </div>
        )}

        {!admin && formError && <div className="form-error">{formError}</div>}

        {/* Admin fulfillment & status update modal form */}
        {admin && (
          <div className="admin-update fulfilment-box">
            <h3>Admin fulfilment &amp; status update</h3>

            <label>Update broadcast status
              <select value={status} onChange={e => setStatus(e.target.value as Status)}>
                <option>Placed</option>
                <option>In progress</option>
                <option>Completed</option>
                <option>Partial</option>
                <option>On hold</option>
                <option>Cancelled</option>
                <option>Refunded</option>
              </select>
            </label>

            {refundApplies && (
              <div className="refund-panel">
                <h4>Refund calculator</h4>
                <p>
                  Enter the delivery figures from the report. The refund is worked out from what this
                  customer was charged for this order — ₹{(order.charge || 0).toFixed(2)} — split across
                  the calls that were actually attempted.
                </p>

                {alreadyPartiallyRefunded && (
                  <div className="form-warning">
                    ⚠️ ₹{order.partialRefundAmount!.toFixed(2)} has already been refunded on this order, leaving
                    ₹{refundableRemaining.toFixed(2)} refundable. Anything calculated below is credited{" "}
                    <strong>on top of</strong> what was already returned.
                  </div>
                )}

                <div className="form-grid">
                  <label>Calls delivered
                    <input
                      type="number"
                      step="1"
                      min="0"
                      placeholder="0"
                      value={deliveredCalls}
                      onChange={e => setDeliveredCalls(e.target.value)}
                    />
                  </label>
                  <label>Calls failed
                    <input
                      type="number"
                      step="1"
                      min="0"
                      placeholder="0"
                      value={failedCalls}
                      onChange={e => setFailedCalls(e.target.value)}
                      className={refundBreakdown && !refundBreakdown.ok ? "invalid" : ""}
                    />
                  </label>
                </div>

                {refundBreakdown && !refundBreakdown.ok && (
                  <div className="form-error">⚠️ {refundBreakdown.error}</div>
                )}

                {refundBreakdown?.ok && (
                  <div className="refund-breakdown">
                    <div className="summary-row"><span>Total calls attempted</span><strong>{refundBreakdown.totalCalls}</strong></div>
                    <div className="summary-row"><span>Rate per call</span><strong>₹{refundBreakdown.perCallRate.toFixed(2)}</strong></div>
                    <div className="summary-row"><span>Failed calls</span><strong>{failedNum ?? 0}</strong></div>
                    <div className="summary-row total"><span>Refund to wallet</span><strong>₹{refundBreakdown.refund.toFixed(2)}</strong></div>
                  </div>
                )}

                {refundBreakdown?.ok && refundBreakdown.capped && (
                  <div className="form-warning">
                    ⚠️ These figures work out to ₹{refundBreakdown.uncapped!.toFixed(2)}, but only
                    ₹{refundableRemaining.toFixed(2)} is still refundable on this order. The refund has been
                    capped at that.
                  </div>
                )}

                {refundBreakdown?.ok && refundBreakdown.refund > 0 && (
                  <div className="form-success">✓ ₹{refundBreakdown.refund.toFixed(2)} will be credited back to the customer&apos;s wallet balance.</div>
                )}

                {refundBreakdown?.ok && refundBreakdown.refund === 0 && (
                  <div className="form-success">✓ No calls failed — nothing will be refunded.</div>
                )}
              </div>
            )}

            {reportApplies && (
              <div className="field-block">
                <label className="field-label">Campaign report file</label>
                <span className={`dropzone ${reportTooLarge ? "invalid" : reportFile ? "filled" : ""}`}>
                  {reportFile ? (
                    <><Icon name="check"/><b>{reportFile.name}</b><small>{formatFileSize(reportFile.size)} · ready to send to the customer</small></>
                  ) : order.reportKey ? (
                    <><Icon name="file"/><b>Replace the existing report</b><small>A report is already attached — choosing a file overwrites it</small></>
                  ) : (
                    <><Icon name="upload"/><b>Upload the campaign report</b><small>Any file type · up to {describeLimit(UPLOAD_LIMITS.REPORT)}</small></>
                  )}
                  <input
                    type="file"
                    onChange={e => { setReportFile(e.target.files?.[0] || null); setFormError(""); }}
                  />
                </span>
                {reportFile ? (
                  <div className="dropzone-actions">
                    <button type="button" className="text-button" onClick={() => setReportFile(null)}>
                      <Icon name="close" size={13}/>Remove file
                    </button>
                  </div>
                ) : (
                  <p className="field-hint">
                    {order.reportKey
                      ? "The customer can already download the attached report."
                      : "Optional — you can complete the order now and attach the report later."}
                  </p>
                )}
              </div>
            )}

            <label>Admin comment / remarks for customer
              <textarea
                rows={2}
                placeholder="Add final report comment or notes for customer..."
                value={adminComment}
                onChange={e => setAdminComment(e.target.value)}
              />
            </label>

            {status === "On hold" && (
              <label>Hold reason<textarea value={holdReason} onChange={e => setHoldReason(e.target.value)} rows={3} placeholder="Describe why this order is on hold..."/></label>
            )}

            {status === "Cancelled" && (
              <label>Cancellation reason<textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)} rows={3} placeholder="Why is this broadcast cancelled?"/></label>
            )}

            {/* Refunded was wired through to the server and written into the order history, but
                the field to type it never existed, so the reason was always blank. */}
            {status === "Refunded" && (
              <label>Refund reason<textarea value={refundReason} onChange={e => setRefundReason(e.target.value)} rows={3} placeholder="Why is this broadcast being refunded in full?"/></label>
            )}

            {(status === "Cancelled" || status === "Refunded") && (order.charge || 0) > 0 && (
              <div className="form-warning">
                ⚠️ Saving this refunds the full ₹{(order.charge || 0).toFixed(2)} to the customer&apos;s wallet.
              </div>
            )}

            {formError && <div className="form-error">{formError}</div>}

            <UploadProgress percent={progress} label={progressLabel} active={saving && Boolean(reportFile)} />

            <button
              className="primary"
              onClick={handleAdminSubmit}
              disabled={saving || Boolean(blockingError)}
            >
              {saving
                ? (progressLabel ? `Uploading… ${progress}%` : "Saving…")
                : partialRefundValue > 0
                  // Name the amount on the button itself - this click is what moves the money,
                  // so the figure being approved should be visible at the moment of approving it.
                  ? `Save & refund ₹${partialRefundValue.toFixed(2)}`
                  : "Save & process fulfilment"}
            </button>
          </div>
        )}

        <div className="modal-footer">
          <button className="outline" onClick={onClose} disabled={saving || resubmitting}>Close</button>
        </div>
      </div>
    </div>
  );
}

function TicketViewModal({ ticket, admin, onClose, onUpdate }: { ticket: Ticket; admin: boolean; onClose: () => void; onUpdate: (id: string, s: TicketStatus, reply?: string) => Promise<SubmitResult> }) {
  const [status, setStatus] = useState<TicketStatus>(ticket.status);
  const [reply, setReply] = useState<string>(ticket.reply || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setSaving(true);
    setError("");
    const result = await onUpdate(ticket.id, status, reply);
    setSaving(false);
    if (!result.ok) setError(result.error || "The ticket could not be updated.");
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal compact-modal">
        <div className="modal-head"><div><p className="eyebrow">{ticket.id}</p><h2>{ticket.subject}</h2><p>{ticket.customer} · {ticket.created}</p></div><button className="close" onClick={onClose}><Icon name="close"/></button></div>
        <div className="detail-grid">
          <div><small>Current status</small><Badge status={ticket.status}/></div>
          <div><small>Priority</small><span className={ticket.priority === "High" ? "priority overdue" : "priority new"}>{ticket.priority}</span></div>
        </div>
        <div className="detail-note"><strong>Customer message</strong><p>{ticket.message}</p></div>
        {ticket.reply && !admin && <div className="detail-note info"><strong>Admin reply</strong><p>{ticket.reply}</p></div>}
        {admin && (
          <div className="admin-update">
            <label>Update ticket status
              <select value={status} onChange={e => setStatus(e.target.value as TicketStatus)}>
                <option>Open</option>
                <option>In progress</option>
                <option>Resolved</option>
              </select>
            </label>
            <label>Reply to customer
              <textarea value={reply} onChange={e => setReply(e.target.value)} rows={3} placeholder="Type your response here..."/>
            </label>
            {error && <div className="form-error">{error}</div>}
            <button className="primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save update"}</button>
          </div>
        )}
        <div className="modal-footer"><button className="outline" onClick={onClose} disabled={saving}>Close</button></div>
      </div>
    </div>
  ); 
}
