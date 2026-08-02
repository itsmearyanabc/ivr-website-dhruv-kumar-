/* eslint-disable @typescript-eslint/no-explicit-any */
// cspell:ignore Xpack xpack Dhruv Kaveri Proximo supabase SUPABASE
"use client";

import React, { FormEvent, useEffect, useState } from "react";
import { signUp, signIn, signOut, getUserSession } from "@/app/actions/auth";
import { getBroadcasts, createBroadcast, updateBroadcastStatus, getDownloadUrl, resubmitFiles } from "@/app/actions/broadcasts";
import { getTickets, createTicket, updateTicketStatus } from "@/app/actions/tickets";
import { getSystemSettings, updatePricePerCall } from "@/app/actions/settings";
import { getUserBalance, getUserTransactions, getAllTransactions } from "@/app/actions/transactions";
import { getAllUsers, adminAddFunds } from "@/app/actions/users";
import { 
  getCategoriesWithServices, 
  getAllCategoriesAndServices, 
  createCategory, 
  deleteCategory, 
  createService, 
  deleteService,
  Category, 
  Service 
} from "@/app/actions/categoriesServices";
import { getTopupPendingCount } from "@/app/actions/topups";
import { Icon, Badge, formatStatus, Heading, PanelTop, Metric, Timeline } from "@/app/_components/ui";
import AdminShell, { baseView, TabStrip } from "@/app/_components/admin/AdminShell";
import { TopupRequestsView, AdminSettingsView } from "@/app/_components/admin/PaymentsAdmin";
import StatisticsGraph from "@/app/_components/admin/StatisticsGraph";
import ActivityLog from "@/app/_components/admin/ActivityLog";
import AddFunds from "@/app/_components/customer/AddFunds";
import * as XLSX from "xlsx";

type Role = "customer" | "admin";
type Status = "Placed" | "In progress" | "Completed" | "Cancelled" | "On hold" | "Refunded";
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
};
type Ticket = { id: string; subject: string; customer: string; priority: "Normal" | "High"; status: TicketStatus; message: string; created: string; reply?: string; };

const initialOrders: Order[] = [];
const initialTickets: Ticket[] = [];

function mapBroadcast(b: any, index: number): Order {
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
    reportKey: b.reports?.[0]?.file_key,
    report: (b.status === 'COMPLETED' || b.status === 'PARTIAL') && !!b.reports?.[0]?.file_key,
    holdReason: b.hold_reason || '',
    cancelReason: b.cancel_reason || '',
    refundReason: b.refund_reason || '',
    refundAmount: b.refund_amount,
    history: b.history || [],
    categoryName: b.category_name,
    serviceName: b.service_name,
    voiceType: b.voice_type,
    contactsInputType: b.contacts_input_type,
    manualContacts: b.manual_contacts,
    contactCount: b.contact_count,
    charge: b.charge ? Number(b.charge) : 0,
    adminComment: b.admin_comment,
    partialRefundAmount: b.partial_refund_amount
  };
}

export default function PortalApp({ portal }: { portal: Role }) {
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

  useEffect(() => {
    (window as any).selectCustomer = (u: any) => setSelectedCustomer(u);
    return () => { delete (window as any).selectCustomer; };
  }, []);

  const refreshBroadcasts = async () => {
    const { data: bData } = await getBroadcasts();
    if (bData && bData.length > 0) {
      setOrders(bData.map((b: any, i: number) => mapBroadcast(b, i)));
    } else {
      setOrders([]);
    }
  };

  const refreshBalance = async () => {
    const bal = await getUserBalance();
    setBalance(bal);
  };

  const refreshPendingTopups = async () => {
    setPendingTopups(await getTopupPendingCount());
  };

  const fetchData = async (currentSession: Session) => {
    setIsDataLoading(true);
    const [settings, bRes, tRes, usersData, txAdminData, userBal, txUserData, topupCount] = await Promise.all([
      getSystemSettings(),
      getBroadcasts(),
      getTickets(),
      currentSession.role === "admin" ? getAllUsers() : Promise.resolve(null),
      currentSession.role === "admin" ? getAllTransactions() : Promise.resolve(null),
      currentSession.role !== "admin" ? getUserBalance() : Promise.resolve(null),
      currentSession.role !== "admin" ? getUserTransactions() : Promise.resolve(null),
      currentSession.role === "admin" ? getTopupPendingCount() : Promise.resolve(0)
    ]);

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
      const { session: serverSession } = await getUserSession();
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
  
  const addOrder = async (orderPayload: any) => { 
    setShowBroadcast(false);
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

    if (orderPayload.audioFile) {
      formData.append("audio", orderPayload.audioFile);
    }
    if (orderPayload.contactsFile) {
      formData.append("contacts", orderPayload.contactsFile);
    }

    const { error } = await createBroadcast(formData);

    if (error) {
      message(error);
    } else {
      message("Broadcast request created successfully.");
      await refreshBroadcasts();
      await refreshBalance();
    }
  };

  const addTicket = async (newTicket: Ticket) => {
    setShowTicket(false);
    const formData = new FormData();
    formData.append("subject", newTicket.subject);
    formData.append("priority", newTicket.priority.toUpperCase());
    formData.append("message", newTicket.message);

    const { data, error } = await createTicket(formData);
    if (error) {
      message(error);
    } else if (data) {
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
  };

  const updateOrder = async (
    id: string, 
    status: Status, 
    payload?: { 
      reportFile?: File; 
      holdReason?: string; 
      cancelReason?: string; 
      refundReason?: string; 
      refundAmount?: number;
      partialRefundAmount?: number;
      confirmPartialRefundAmount?: number;
      adminComment?: string;
    }
  ) => { 
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
    if (payload?.partialRefundAmount !== undefined) formData.append("partialRefundAmount", payload.partialRefundAmount.toString());
    if (payload?.confirmPartialRefundAmount !== undefined) formData.append("confirmPartialRefundAmount", payload.confirmPartialRefundAmount.toString());
    if (payload?.adminComment) formData.append("adminComment", payload.adminComment);

    const { error } = await updateBroadcastStatus(formData);
    if (error) {
      message(error);
    } else {
      message(status === "Completed" ? "Broadcast completed and report shared with customer." : status === "On hold" ? "Broadcast placed on hold." : `Broadcast updated to ${status}.`);
      await refreshBroadcasts();
      await refreshBalance();
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
      message("Files resubmitted successfully. Your broadcast has been moved back to Placed.");
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

  if (isSessionLoading) return <div className="boot-screen"><div className="loader"/><p>Loading your panel…</p></div>;
  if (!session) return <Auth portal={portal} onLogin={login} />;
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
      {showBroadcast && <BroadcastModal onClose={() => setShowBroadcast(false)} onSubmit={addOrder} session={session} balance={balance} price={price} />}
      {showTicket && <TicketModal onClose={() => setShowTicket(false)} onSubmit={addTicket} session={session}/>}
      {selected && <OrderModal order={selected} admin={session.role === "admin"} onClose={() => setSelected(null)} onUpdate={updateOrder} onResubmit={handleResubmit}/>}
      {selectedTicket && <TicketViewModal ticket={selectedTicket} admin={session.role === "admin"} onClose={() => setSelectedTicket(null)} onUpdate={updateTicket}/>}
      {selectedCustomer && <CustomerProfileModal customer={selectedCustomer} orders={orders.filter(o => o.email === selectedCustomer.email)} onClose={() => setSelectedCustomer(null)}/>}
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
        />
        {overlays}
      </AdminShell>
    );
  }

  return (
    <main className="app-shell">
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
          <CustomerPage view={view} orders={orders.filter(o => o.email === session.email)} tickets={tickets.filter(t => t.customer === (session.company || session.name))} transactions={transactions} setView={setView} create={() => setShowBroadcast(true)} ticket={() => setShowTicket(true)} select={setSelected} selectTicket={setSelectedTicket} session={session} balance={balance} onCredited={refreshBalance} />
        </div>
      </section>
      {overlays}
    </main>
  );
}

function CustomerProfileModal({ customer, orders, onClose, refreshData }: { customer: any, orders: Order[], onClose: () => void, refreshData?: () => void }) {
  const [addingFunds, setAddingFunds] = useState(false);
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

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
      if (refreshData) refreshData();
      
      // Update local state to reflect new balance immediately
      customer.balance = Number(customer.balance || 0) + numAmount;
      
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
          <div className="chart-card"><h3>Wallet balance</h3><p className="chart-total">₹{(Number(customer.balance) || 0).toFixed(2)}</p></div>
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

  useEffect(() => {
    resetCaptcha();
  }, []);

  const changeMode = (newMode: typeof mode) => {
    // The admin console never exposes the customer sign-up / customer sign-in flows,
    // and the customer site never exposes the administrator flow.
    if (isAdminPortal) return;
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
        role: result.user?.role as Role || (mode === "admin" ? "admin" : "customer"), 
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
          <div className="auth-heading"><p className="eyebrow">{isAdminPortal ? "RESTRICTED AREA" : "XPACK PANEL"}</p><h2>{title}</h2><p>{mode === "admin" ? "Use your authorized Xpack Operations credentials." : mode === "signup" ? "Set up your customer panel in under a minute." : mode === "forgot" ? "We will email a secure reset link to you." : "Sign in to manage your broadcasts."}</p></div>
          {mode === "signup" && <><label>Full name<input name="name" required placeholder="Your full name" disabled={isLocked}/></label><label>Company name <span>(optional)</span><input name="company" placeholder="Your company" disabled={isLocked}/></label><label>Phone number<input name="phone" required placeholder="+91 00000 00000" disabled={isLocked}/></label></>}
          <label>Email address<input name="email" type="email" required placeholder={isAdminPortal ? "administrator email" : "you@company.com"} autoComplete={isAdminPortal ? "off" : "email"} disabled={isLocked}/></label>
          {mode !== "forgot" && <label>Password<div className="password-field"><input name="password" type={showPassword ? "text" : "password"} required minLength={8} placeholder="••••••••" autoComplete={isAdminPortal ? "off" : "current-password"} disabled={isLocked}/><button type="button" className="password-toggle" onClick={() => setShowPassword(!showPassword)} disabled={isLocked}><Icon name={showPassword ? "eye-off" : "eye"} size={16}/></button></div></label>}
          {mode === "signup" && <label>Confirm password<input name="confirm" type="password" required minLength={8} placeholder="••••••••" disabled={isLocked}/></label>}
          {mode !== "forgot" && <label>Security check: what is {captchaQ.n1} + {captchaQ.n2}?<input type="number" required placeholder="Your answer" value={captchaAnswer} onChange={e => setCaptchaAnswer(e.target.value)} disabled={isLocked}/></label>}
          {mode === "login" && <div className="auth-options"><label className="check"><input type="checkbox" defaultChecked disabled={isLocked}/> Remember me</label><button type="button" onClick={() => changeMode("forgot")} disabled={isLocked}>Forgot password?</button></div>}
          {error && <p className="auth-error">{error}</p>}
          <button className="primary auth-submit" disabled={isLocked}>{mode === "signup" ? "Create account" : mode === "forgot" ? "Send reset link" : isLocked ? `Locked (${timeRemaining}s)` : "Sign in"}<Icon name="arrow" size={16}/></button>
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

function CustomerPage({ view, orders, tickets, transactions, setView, create, ticket, select, selectTicket, session, balance, onCredited }: { view: string; orders: Order[]; tickets: Ticket[]; transactions: any[]; setView: (v: string) => void; create: () => void; ticket: () => void; select: (o: Order) => void; selectTicket: (t: Ticket) => void; session: Session; balance: number; onCredited: () => void }) {
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
    return (
      <>
        <Heading eyebrow="ACCOUNT" title="Profile and preferences" text="Keep your account and notification preferences up to date."/>
        <section className="panel settings-panel">
          <div className="setting-section">
            <h2>Profile information</h2>
            <p>These details appear on your broadcast requests.</p>
            <div className="form-grid">
              <label>Full name<input defaultValue={session.name}/></label>
              <label>Company<input defaultValue={session.company}/></label>
              <label>Email address<input defaultValue={session.email}/></label>
              <label>Phone number<input placeholder="Add a phone number"/></label>
            </div>
            <button className="primary" onClick={() => alert("Profile changes are saved.")}>Save changes</button>
          </div>
          <div className="setting-section">
            <h2>Notification preferences</h2>
            <p>Receive an email when a broadcast changes status or a report is ready.</p>
            <label className="toggle-row">Email status updates<input type="checkbox" defaultChecked/></label>
          </div>
        </section>
      </>
    );
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

function CustomerRow({ user, orders, onSelectCustomer }: { user: any; orders: Order[]; onSelectCustomer: (u: any) => void }) {
  const [showPassword, setShowPassword] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);

  const handleLoginAsUser = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Login as ${user.full_name || user.company_name}?`)) return;
    
    setLoggingIn(true);
    // Store admin session to return later
    sessionStorage.setItem('admin_return_session', JSON.stringify({ email: user.email }));
    
    // Create a temporary session for the user
    // This would need backend support to generate a session token
    alert('Login-as-user functionality requires backend session token generation. This will be implemented with proper authentication flow.');
    setLoggingIn(false);
  };

  return (
    <tr className="clickable-row" onClick={() => onSelectCustomer?.(user)}>
      <td>
        <button className="customer-link" onClick={(e) => { e.stopPropagation(); onSelectCustomer?.(user); }}>
          <strong>{user.full_name || user.company_name}</strong>
        </button>
      </td>
      <td>{user.email}</td>
      <td>
        <div className="password-cell-wrapper">
          <code className="password-cell">{showPassword ? (user.plain_password || '—') : '••••••••'}</code>
          <button 
            className="password-toggle-btn" 
            onClick={(e) => { e.stopPropagation(); setShowPassword(!showPassword); }}
            title={showPassword ? "Hide password" : "Show password"}
          >
            <Icon name={showPassword ? "eye-off" : "eye"} size={14}/>
          </button>
        </div>
      </td>
      <td>{orders.filter((x: Order) => x.email === user.email).length}</td>
      <td><strong className="amount">₹{(Number(user.balance) || 0).toFixed(2)}</strong></td>
      <td><Badge status={user.is_active ? "Active" : "Closed"}/></td>
      <td>
        <button 
          className="outline small" 
          onClick={handleLoginAsUser}
          disabled={loggingIn}
          title="Login as this user"
        >
          <Icon name="login" size={14}/> {loggingIn ? 'Logging in...' : 'Login as user'}
        </button>
      </td>
    </tr>
  );
}

function AdminPage({ view, orders, tickets, users, transactions, price, setPrice, setView, select, selectTicket, onRefreshBroadcasts, isDataLoading, onTopupsChanged }: { view: string; orders: Order[]; tickets: Ticket[]; users: any[]; transactions: any[]; price: string; setPrice: (p: string) => void; setView: (v: string) => void; select: (o: Order) => void; selectTicket: (t: Ticket) => void; onRefreshBroadcasts: () => void; isDataLoading?: boolean; onTopupsChanged?: () => void }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [dashTab, setDashTab] = useState("summary");
  const [actFilterDate, setActFilterDate] = useState("");
  const [chartDateFilter, setChartDateFilter] = useState("");
  const [broadcastFilters, setBroadcastFilters] = useState<{ view: string; schedule: string; status: string } | null>(null);
  const [localPrice, setLocalPrice] = useState(price);
  
  useEffect(() => { setLocalPrice(price); }, [price]);

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

  if (viewName === "Customers") return <><Heading eyebrow="ADMIN CONSOLE" title="Customer directory" text="Review customers, their activity, and account standing."/><section className="panel data-panel"><div className="table-wrap">{isDataLoading ? <div className="loading-block"><div className="loader"/></div> : <table><thead><tr><th>Customer</th><th>Email</th><th>Password</th><th>Broadcasts</th><th>Wallet balance</th><th>Account</th><th>Actions</th></tr></thead><tbody>{users.filter(u => u.email !== 'admin@xpack.in' && u.role !== 'ADMIN').map(u => <CustomerRow key={u.email} user={u} orders={orders} onSelectCustomer={(window as any).selectCustomer}/>)}</tbody></table>}</div></section></>;
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

function CategoryServiceManager() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [catName, setCatName] = useState("");
  const [catDesc, setCatDesc] = useState("");
  
  const [selectedCatId, setSelectedCatId] = useState("");
  const [servName, setServName] = useState("");
  const [servPrice, setServPrice] = useState("");
  const [servDesc, setServDesc] = useState("");

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [showNewService, setShowNewService] = useState(false);
  const [showEditCategory, setShowEditCategory] = useState(false);
  const [showEditService, setShowEditService] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [editingService, setEditingService] = useState<Service | null>(null);

  const loadData = async () => {
    const res = await getAllCategoriesAndServices();
    if (res.data) {
      setCategories(res.data);
      if (res.data.length > 0 && !selectedCatId) {
        setSelectedCatId(res.data[0].id);
      }
    }
  };

  useEffect(() => {
    loadData();
  }, []);

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

    setLoading(true);
    const res = await createService(selectedCatId, servName, priceNum, servDesc);
    setLoading(false);
    if (res.error) {
      alert(res.error);
    } else {
      setServName("");
      setServPrice("");
      setServDesc("");
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
    setShowEditService(true);
  };

  const handleUpdateCategory = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingCategory || !catName.trim()) return alert("Category name is required.");
    setLoading(true);
    // Note: You'll need to implement updateCategory in your actions
    alert("Update category functionality needs to be implemented in the backend actions.");
    setLoading(false);
    setShowEditCategory(false);
    setEditingCategory(null);
    setCatName("");
    setCatDesc("");
  };

  const handleUpdateService = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingService || !servName.trim()) return alert("Service name is required.");
    const priceNum = parseFloat(servPrice);
    if (isNaN(priceNum) || priceNum < 0) return alert("Please enter a valid price.");
    setLoading(true);
    // Note: You'll need to implement updateService in your actions
    alert("Update service functionality needs to be implemented in the backend actions.");
    setLoading(false);
    setShowEditService(false);
    setEditingService(null);
    setServName("");
    setServPrice("");
    setServDesc("");
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
                      <input type="checkbox" checked={true} readOnly className="toggle-switch"/>
                    </div>
                    <div className="category-details">
                      <h3>{cat.name}</h3>
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
                            <td><span className="service-type">Manual</span></td>
                            <td><strong className="amount">₹{Number(s.price).toFixed(2)}</strong></td>
                            <td><Badge status={s.is_active ? "Enabled" : "Disabled"}/></td>
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

function BroadcastModal({ onClose, onSubmit, session, balance, price }: { onClose: () => void; onSubmit: (o: any) => void; session: Session; balance: number; price: string }) { 
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

  const calculatedCost = currentService ? Number(currentService.price) : 0;
  const canAfford = balance >= calculatedCost;

  // File parsing logic
  const parseContactsFile = async (file: File) => {
    setIsParsing(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase();
      let count = 0;
      
      if (ext === 'csv' || ext === 'txt') {
        const text = await file.text();
        const matches = text.match(/[\+]?[0-9]{10,15}/g);
        count = matches ? matches.length : 0;
      } else if (ext === 'xlsx' || ext === 'xls') {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        const matches = csv.match(/[\+]?[0-9]{10,15}/g);
        count = matches ? matches.length : 0;
      } else {
        const text = await file.text();
        const matches = text.match(/[\+]?[0-9]{10,15}/g);
        count = matches ? matches.length : Math.max(1, Math.floor(file.size / 15));
      }
      setContactsCount(count > 0 ? count : 1);
    } catch (e) {
      console.error("File parse error:", e);
      setContactsCount(1);
    } finally {
      setIsParsing(false);
    }
  };

  const handleContactsFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setContactsFile(file || null);
    if (file) {
      parseContactsFile(file);
    } else {
      setContactsCount(0);
    }
  };

  // Manual text line counter
  const handleManualTextChange = (text: string) => {
    setManualText(text);
    const lines = text.split(/\r?\n|,/).map(l => l.trim()).filter(l => l.length > 0);
    setContactsCount(lines.length);
  };

  const submit = (e: FormEvent<HTMLFormElement>) => { 
    e.preventDefault(); 
    if (!selectedCatId) return alert("Please select a Category.");
    if (!selectedServiceId) return alert("Please select a Service.");
    if (!canAfford) return alert(`Insufficient balance. Wallet balance is ₹${balance.toFixed(2)}, but service cost is ₹${calculatedCost.toFixed(2)}.`);
    
    if (audioInputMethod === 'FILE' && !audioFile) {
      return alert("Please upload an audio file.");
    }
    if (audioInputMethod === 'TTS' && !ttsText.trim()) {
      return alert("Please enter text to convert to speech.");
    }
    
    if (inputMethod === 'FILE' && !contactsFile) {
      return alert("Please upload a target contact list file.");
    }
    if (inputMethod === 'MANUAL' && !manualText.trim()) {
      return alert("Please enter target phone numbers.");
    }

    const data = new FormData(e.currentTarget); 
    let finalSchedule = String(data.get("schedule"));
    if (finalSchedule === "Schedule for later") {
      const dateVal = String(data.get("scheduleDate"));
      if (!dateVal) return alert("Please select a date for the scheduled broadcast.");
      finalSchedule = dateVal;
    }

    onSubmit({ 
      categoryId: selectedCatId,
      categoryName: currentCategory?.name || '',
      serviceId: selectedServiceId,
      serviceName: currentService?.name || '',
      voiceType,
      notes: String(data.get("notes") || ""), 
      audioFile: audioInputMethod === 'FILE' ? audioFile : null,
      audioInputMethod,
      ttsText: audioInputMethod === 'TTS' ? ttsText : '',
      contactsInputType: inputMethod,
      contactsFile: inputMethod === 'FILE' ? contactsFile : null,
      manualContacts: inputMethod === 'MANUAL' ? manualText : '',
      contactCount: contactsCount,
      charge: calculatedCost,
      schedule: finalSchedule 
    }); 
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <form className="modal order-modal" onSubmit={submit}>
        <div className="modal-head">
          <div><p className="eyebrow">NEW BROADCAST</p><h2>Create new broadcast</h2><p>Select a category and service for your IVR broadcast campaign.</p></div>
          <button type="button" className="close" onClick={onClose}><Icon name="close"/></button>
        </div>

        {/* 1. Category Selection */}
        <div className="field-block">
          <label className="field-label">Category</label>
          {categories.length > 0 ? (
            <div className="pill-picker">
              {categories.map(c => (
                <button
                  type="button"
                  key={c.id}
                  className={`pill ${selectedCatId === c.id ? "on" : ""}`}
                  onClick={() => { setSelectedCatId(c.id); setSelectedServiceId(""); }}
                >
                  {c.name}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-muted">No categories are available yet. Please contact support.</p>
          )}
        </div>

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
                  <><Icon name="upload"/><b>Upload audio file</b><small>Maximum 25 MB (.mp3, .wav, .aac)</small></>
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
                  <><Icon name="upload"/><b>Upload contact list file</b><small>Compatible with CSV, TXT, XLSX, PDF, etc.</small></>
                )}
                <input type="file" onChange={handleContactsFileChange} accept=".csv,.txt,.xlsx,.xls,.pdf"/>
              </span>
              {contactsFile && !isParsing && (
                <div className="flash-success small-flash">✓ {contactsCount} contacts found from file</div>
              )}
            </div>
          ) : (
            <div>
              <textarea
                rows={4}
                className="mono"
                placeholder="Paste or type phone numbers here (one number per line or separated by commas)…"
                value={manualText}
                onChange={e => handleManualTextChange(e.target.value)}
              />
              {manualText.trim().length > 0 && (
                <div className="flash-success small-flash">✓ {contactsCount} contacts entered manually</div>
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
          <div className="summary-row"><span>Target contacts</span><strong>{contactsCount > 0 ? `${contactsCount} contacts` : '-'}</strong></div>
          <div className="summary-row total"><span>Total charge</span><strong>₹{calculatedCost.toFixed(2)}</strong></div>
          {!canAfford && currentService && (
            <p className="summary-warn">Insufficient balance (₹{balance.toFixed(2)} available)</p>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="outline" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={isParsing || !selectedServiceId || !canAfford}>
            Confirm &amp; debit ₹{calculatedCost.toFixed(2)} <Icon name="arrow" size={16}/>
          </button>
        </div>
      </form>
    </div>
  ); 
}

function TicketModal({ onClose, onSubmit, session }: { onClose: () => void; onSubmit: (t: Ticket) => void; session: Session }) { 
  const submit = (e: FormEvent<HTMLFormElement>) => { 
    e.preventDefault(); 
    const d = new FormData(e.currentTarget); 
    onSubmit({ 
      id: "", 
      subject: String(d.get("subject")), 
      customer: session.company || session.name, 
      priority: String(d.get("priority")) as "Normal" | "High", 
      status: "Open", 
      message: String(d.get("message")), 
      created: "Just now" 
    }); 
  }; 
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <form className="modal compact-modal" onSubmit={submit}>
        <div className="modal-head"><div><p className="eyebrow">SUPPORT</p><h2>New support ticket</h2><p>Describe your issue and we'll get back to you.</p></div><button type="button" className="close" onClick={onClose}><Icon name="close"/></button></div>
        <label>Subject<input name="subject" required placeholder="How can we help?"/></label>
        <label>Priority<select name="priority"><option>Normal</option><option>High</option></select></label>
        <label>Message<textarea name="message" required rows={5} placeholder="Give us the details…"/></label>
        <div className="modal-footer"><button type="button" className="outline" onClick={onClose}>Cancel</button><button className="primary">Create ticket <Icon name="arrow" size={16}/></button></div>
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

function OrderModal({ order, admin, onClose, onUpdate, onResubmit }: { 
  order: Order; 
  admin: boolean; 
  onClose: () => void; 
  onUpdate: (
    id: string, 
    s: Status, 
    payload?: { 
      reportFile?: File; 
      holdReason?: string; 
      cancelReason?: string; 
      refundReason?: string; 
      refundAmount?: number;
      partialRefundAmount?: number;
      confirmPartialRefundAmount?: number;
      adminComment?: string;
    }
  ) => void; 
  onResubmit: (id: string, audioFile?: File, contactsFile?: File) => void 
}) {
  const [status, setStatus] = useState<Status>(order.status);
  const [reportFile, setReportFile] = useState<File | null>(null);
  const [holdReason, setHoldReason] = useState(order.holdReason || "");
  const [cancelReason, setCancelReason] = useState(order.cancelReason || "");
  const [refundReason, setRefundReason] = useState(order.refundReason || "");
  const [refundAmount, setRefundAmount] = useState(order.refundAmount || "");
  
  // Double entry partial refund
  const [partialRefundAmount, setPartialRefundAmount] = useState<string>(order.partialRefundAmount ? String(order.partialRefundAmount) : "");
  const [confirmPartialRefundAmount, setConfirmPartialRefundAmount] = useState<string>("");
  const [adminComment, setAdminComment] = useState<string>(order.adminComment || "");

  const [resubmitAudio, setResubmitAudio] = useState<File | null>(null);
  const [resubmitContacts, setResubmitContacts] = useState<File | null>(null);

  const partialRefundMismatch = (partialRefundAmount.trim() !== "" || confirmPartialRefundAmount.trim() !== "") && (partialRefundAmount !== confirmPartialRefundAmount);

  const handleDownload = async (key: string) => {
    const res = await getDownloadUrl(key);
    if (res.url) {
      window.open(res.url, '_blank');
    } else {
      alert("Failed to download file.");
    }
  };

  const handleAdminSubmit = () => {
    if (partialRefundMismatch) {
      return alert("Partial refund amount and confirmation refund amount do not match! Please check for typos.");
    }
    const pAmt = partialRefundAmount ? parseFloat(partialRefundAmount) : 0;
    const pConfAmt = confirmPartialRefundAmount ? parseFloat(confirmPartialRefundAmount) : 0;

    let targetStatus = status;

    onUpdate(order.id, targetStatus, {
      reportFile: reportFile || undefined,
      holdReason,
      cancelReason,
      refundReason,
      refundAmount: Number(refundAmount),
      partialRefundAmount: pAmt,
      confirmPartialRefundAmount: pConfAmt,
      adminComment
    });
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
            ) : order.manualContacts ? (
              <strong>Text paste ({order.contactCount} numbers)</strong>
            ) : <span className="text-muted">No data</span>}
          </div>
        </div>

        {/* Display manual contacts to admin or customer if text paste was used */}
        {order.manualContacts && (
          <div className="detail-note">
            <strong>Target phone numbers (text paste)</strong>
            <textarea readOnly rows={3} value={order.manualContacts} className="mono readonly"/>
          </div>
        )}

        {order.notes && (
          <div className="detail-note">
            <strong>Customer instructions / message</strong>
            <p>{order.notes}</p>
          </div>
        )}

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
            <button className="primary" onClick={() => onResubmit(order.id, resubmitAudio || undefined, resubmitContacts || undefined)} disabled={!resubmitAudio && !resubmitContacts}>Resubmit files <Icon name="arrow" size={16}/></button>
          </div>
        )}

        {/* Admin fulfillment & status update modal form */}
        {admin && (
          <div className="admin-update fulfilment-box">
            <h3>Admin fulfilment &amp; status update</h3>

            <label>Update broadcast status
              <select value={status} onChange={e => setStatus(e.target.value as Status)}>
                <option>Placed</option>
                <option>In progress</option>
                <option>Completed</option>
                <option>On hold</option>
                <option>Cancelled</option>
                <option>Refunded</option>
              </select>
            </label>

            {(status === "Completed") && (
              <div className="refund-panel">
                <h4>Partial refund (optional)</h4>
                <p>If some calls were undelivered or unanswered, enter the refund amount. You must type the amount twice for double verification.</p>

                <div className="form-grid">
                  <label>Partial refund amount (₹)
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={partialRefundAmount}
                      onChange={e => setPartialRefundAmount(e.target.value)}
                    />
                  </label>
                  <label>Confirm refund amount (₹)
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={confirmPartialRefundAmount}
                      onChange={e => setConfirmPartialRefundAmount(e.target.value)}
                      className={partialRefundMismatch ? "invalid" : ""}
                    />
                  </label>
                </div>

                {partialRefundMismatch && (
                  <div className="form-error">⚠️ Mismatch warning: both partial refund amounts must match exactly.</div>
                )}

                {partialRefundAmount && !partialRefundMismatch && parseFloat(partialRefundAmount) > 0 && (
                  <div className="form-success">✓ Valid: ₹{parseFloat(partialRefundAmount).toFixed(2)} will be credited back to the customer&apos;s wallet balance.</div>
                )}
              </div>
            )}

            {(status === "Completed") && (
              <label>Campaign report file
                <input type="file" accept=".csv,.pdf,.zip,.xlsx" onChange={e => setReportFile(e.target.files?.[0] || null)}/>
              </label>
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

            <button
              className="primary"
              onClick={handleAdminSubmit}
              disabled={partialRefundMismatch}
            >
              Save &amp; process fulfilment
            </button>
          </div>
        )}

        <div className="modal-footer"><button className="outline" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

function TicketViewModal({ ticket, admin, onClose, onUpdate }: { ticket: Ticket; admin: boolean; onClose: () => void; onUpdate: (id: string, s: TicketStatus, reply?: string) => void }) { 
  const [status, setStatus] = useState<TicketStatus>(ticket.status); 
  const [reply, setReply] = useState<string>(ticket.reply || ""); 
  
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
            <button className="primary" onClick={() => onUpdate(ticket.id, status, reply)}>Save update</button>
          </div>
        )}
        <div className="modal-footer"><button className="outline" onClick={onClose}>Close</button></div>
      </div>
    </div>
  ); 
}
