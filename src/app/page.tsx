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
import * as XLSX from "xlsx";

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
};
type Ticket = { id: string; subject: string; customer: string; priority: "Normal" | "High"; status: TicketStatus; message: string; created: string; reply?: string; };

const initialOrders: Order[] = [];
const initialTickets: Ticket[] = [];

function Icon({ name, size = 18 }: { name: string; size?: number }) {
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
    menu: <><path d="M3 12h18M3 6h18M3 18h18"/></>
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{p[name]}</svg>;
}

function formatStatus(raw: string): Status | TicketStatus {
  const map: Record<string, string> = {
    'PLACED': 'Placed', 'IN_PROGRESS': 'In progress', 'COMPLETED': 'Completed', 'PARTIAL': 'Partial', 'CANCELLED': 'Cancelled', 'ON_HOLD': 'On hold', 'REFUNDED': 'Refunded',
    'OPEN': 'Open', 'RESOLVED': 'Resolved', 'CLOSED': 'Closed',
  };
  return (map[raw] || raw.charAt(0) + raw.slice(1).toLowerCase()) as Status | TicketStatus;
}

function Badge({ status }: { status: string }) { return <span className={`badge ${status.toLowerCase().replaceAll(" ", "-")}`}><i />{status}</span>; }

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

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [view, setView] = useState(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('xpack_view') || "Overview";
    }
    return "Overview";
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('xpack_view', view);
    }
  }, [view]);
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

  useEffect(() => {
    let mounted = true;
    
    async function initSession() {
      const { session: serverSession } = await getUserSession();
      if (mounted && serverSession) {
        setSession(serverSession as Session);
        fetchData(serverSession as Session);
      }
    }
    
    async function fetchData(currentSession: Session) {
      const settings = await getSystemSettings();
      if (mounted) setPrice(settings.price_per_call);

      if (currentSession.role === "admin") {
        const usersData = await getAllUsers();
        if (mounted) setUsersList(usersData);
        
        const txData = await getAllTransactions();
        if (mounted) setTransactions(txData);
      } else {
        const bal = await getUserBalance();
        if (mounted) setBalance(bal);

        const txData = await getUserTransactions();
        if (mounted) setTransactions(txData);
      }

      const { data: bData } = await getBroadcasts();
      if (mounted && bData) {
        setOrders(bData.map((b: any, i: number) => mapBroadcast(b, i)));
      }

      const { data: tData } = await getTickets();
      if (mounted && tData) {
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

  const login = (s: Session) => { setSession(s); setView("Overview"); sessionStorage.setItem('xpack_view', 'Overview'); };
  const logout = async () => { await signOut(); setSession(null); setOrders(initialOrders); setTickets(initialTickets); sessionStorage.removeItem('xpack_view'); };
  
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
      message(status === "Completed" ? "Order completed and report shared with customer." : status === "Partial" ? "Partial refund processed and order updated." : status === "On hold" ? "Order placed on hold." : `Order updated to ${status}.`);
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
  
  const nav = session.role === "customer" 
    ? [["Overview", "grid"], ["My broadcasts", "radio"], ["Support centre", "help"], ["Settings", "settings"], ["Funds", "indian-rupee"]] 
    : [["Overview", "grid"], ["Broadcast management", "radio"], ["Categories & Services", "layers"], ["Customers", "users"], ["Support desk", "help"], ["Activity log", "activity"], ["Pricing", "dollar-sign"]];

  return (
    <main className="app-shell">
      <div className={`sidebar-backdrop ${isMobileMenuOpen ? 'mobile-open' : ''}`} onClick={() => setIsMobileMenuOpen(false)}></div>
      <aside className={`sidebar ${isMobileMenuOpen ? 'mobile-open' : ''}`}>
        <div className="brand"><span className="brand-mark"><b>x</b></span><span>Xpack</span></div>
        <div className="workspace"><span className="company-dot">{session.role === "admin" ? "X" : session.name.slice(0, 1)}</span><span>{session.role === "admin" ? "Xpack Operations" : session.company || session.name}</span></div>
        <nav>{nav.map(([label, icon]) => <button key={label} onClick={() => { setView(label); setSelected(null); setSelectedTicket(null); setSelectedCustomer(null); setIsMobileMenuOpen(false); }} className={view === label ? "active" : ""}><Icon name={icon as string}/>{label}</button>)}</nav>
        <div className="sidebar-bottom">
          <div className="help-card">
            <span className="help-symbol">?</span>
            <div><strong>Need help?</strong><p>Our team is here for you.</p><button onClick={() => setView(session.role === "admin" ? "Support desk" : "Support centre")}>Open support <Icon name="arrow" size={13}/></button></div>
          </div>
          <div className="user-card">
            <span className="avatar">{session.name.split(" ").map(x => x[0]).join("").slice(0,2)}</span>
            <div><strong>{session.name}</strong><p>{session.role === "admin" ? "Xpack administrator" : "Customer account"}</p></div>
            <button title="Sign out" onClick={() => setShowLogoutConfirm(true)}><Icon name="logout"/></button>
          </div>
        </div>
      </aside>
      {showLogoutConfirm && (
        <div className="modal-overlay">
          <div className="modal-content" style={{maxWidth: '400px', textAlign: 'center', padding: '30px'}}>
            <h2 style={{marginTop: 0}}>Confirm Logout</h2>
            <p style={{marginBottom: '20px', color: '#64748b'}}>Are you sure you want to sign out?</p>
            <div style={{display: 'flex', gap: '10px', justifyContent: 'center'}}>
              <button className="outline" onClick={() => setShowLogoutConfirm(false)}>Cancel</button>
              <button className="primary" onClick={() => { setShowLogoutConfirm(false); logout(); }}>Sign out</button>
            </div>
          </div>
        </div>
      )}
      <section className="content">
        <header>
          <button className="mobile-menu-btn" onClick={() => setIsMobileMenuOpen(true)}>
            <Icon name="menu" size={24} />
          </button>
          <div className="mobile-brand">Xpack</div>
          <div className="header-actions">
            <span className="access-label" style={session.role === 'customer' ? {background:'#f1f5f9',color:'#0f172a'}: {}}>
              <Icon name={session.role === "admin" ? "lock" : "indian-rupee"} size={14}/>
              {session.role === "admin" ? "Admin access" : `Balance: ₹${balance.toFixed(2)}`}
            </span>
            <button className="notification"><Icon name="bell"/><em>3</em></button>
            <span className="header-avatar">{session.name.split(" ").map(x => x[0]).join("").slice(0,2)}</span>
          </div>
        </header>
        <div className="page">
          {session.role === "customer" ? (
            <CustomerPage view={view} orders={orders.filter(o => o.email === session.email)} tickets={tickets.filter(t => t.customer === (session.company || session.name))} transactions={transactions} setView={setView} create={() => setShowBroadcast(true)} ticket={() => setShowTicket(true)} select={setSelected} selectTicket={setSelectedTicket} session={session} balance={balance} />
          ) : (
            <AdminPage view={view} orders={orders} tickets={tickets} users={usersList} transactions={transactions} price={price} setPrice={setPrice} setView={setView} select={setSelected} selectTicket={setSelectedTicket} onRefreshBroadcasts={refreshBroadcasts}/>
          )}
        </div>
      </section>
      {showBroadcast && <BroadcastModal onClose={() => setShowBroadcast(false)} onSubmit={addOrder} session={session} balance={balance} price={price} />} 
      {showTicket && <TicketModal onClose={() => setShowTicket(false)} onSubmit={addTicket} session={session}/>} 
      {selected && <OrderModal order={selected} admin={session.role === "admin"} onClose={() => setSelected(null)} onUpdate={updateOrder} onResubmit={handleResubmit}/>} 
      {selectedTicket && <TicketViewModal ticket={selectedTicket} admin={session.role === "admin"} onClose={() => setSelectedTicket(null)} onUpdate={updateTicket}/>} 
      {selectedCustomer && <CustomerProfileModal customer={selectedCustomer} orders={orders.filter(o => o.email === selectedCustomer.email)} onClose={() => setSelectedCustomer(null)}/>} 
      {toast && <div className="toast"><span><Icon name="check" size={16}/></span>{toast}</div>}
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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{maxWidth: '600px'}} onClick={e => e.stopPropagation()}>
        <header className="modal-header"><h2>Customer Profile</h2><button className="close-button" onClick={onClose}><Icon name="x"/></button></header>
        <div className="modal-body" style={{display: 'flex', flexDirection: 'column', gap: '20px'}}>
          <div style={{display: 'flex', gap: '15px', alignItems: 'center'}}>
            <span className="avatar" style={{width: '60px', height: '60px', fontSize: '24px', background: '#3b82f6', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%'}}>{customer.full_name?.slice(0,1) || customer.company_name?.slice(0,1) || "C"}</span>
            <div><h3 style={{fontSize: '20px', margin: '0 0 5px 0'}}>{customer.full_name || customer.company_name}</h3><p style={{margin: 0, color: '#64748b'}}>{customer.email}</p><Badge status={customer.is_active ? "Active" : "Closed"}/></div>
          </div>
          <div className="dashboard-grid" style={{gridTemplateColumns: '1fr 1fr'}}>
            <div className="chart-card"><h3>Current Balance</h3><p className="chart-total">₹{(Number(customer.balance) || 0).toFixed(2)}</p></div>
            <div className="chart-card"><h3>Total Orders</h3><p className="chart-total">{orders.length}</p></div>
          </div>
          
          {addingFunds ? (
            <div style={{background: '#f8fafc', padding: '15px', borderRadius: '8px', border: '1px solid #e2e8f0'}}>
              <h4 style={{margin: '0 0 10px 0'}}>Add Funds Manually</h4>
              <form onSubmit={handleAddFunds} style={{display: 'flex', gap: '10px', alignItems: 'flex-start'}}>
                <div style={{flex: 1}}>
                  <input 
                    type="number" 
                    value={amount} 
                    onChange={e => setAmount(e.target.value)} 
                    placeholder="Enter amount (e.g. 500)" 
                    disabled={loading}
                    style={{width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc'}}
                  />
                  {error && <p style={{color: 'red', fontSize: '12px', margin: '5px 0 0 0'}}>{error}</p>}
                  {success && <p style={{color: 'green', fontSize: '12px', margin: '5px 0 0 0'}}>{success}</p>}
                </div>
                <button type="submit" disabled={loading} style={{background: '#10b981', color: 'white', border: 'none', padding: '9px 15px', borderRadius: '4px', cursor: loading ? 'not-allowed' : 'pointer'}}>
                  {loading ? 'Adding...' : 'Deposit'}
                </button>
                <button type="button" onClick={() => setAddingFunds(false)} disabled={loading} style={{background: '#ef4444', color: 'white', border: 'none', padding: '9px 15px', borderRadius: '4px', cursor: loading ? 'not-allowed' : 'pointer'}}>
                  Cancel
                </button>
              </form>
            </div>
          ) : (
            <div style={{display: 'flex', justifyContent: 'flex-start'}}>
              <button onClick={() => setAddingFunds(true)} style={{background: '#3b82f6', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px'}}>
                <Icon name="indian-rupee" size={16}/> Add Funds
              </button>
            </div>
          )}

          <div className="detail-note">
            <strong>Contact Details</strong>
            <p>Phone: {customer.phone || 'Not provided'}</p>
            <p>Company: {customer.company_name || 'Not provided'}</p>
            <p>Joined: {new Date(customer.created_at).toLocaleDateString()}</p>
          </div>
        </div>
        <footer className="modal-footer"><button className="outline" onClick={onClose}>Close</button></footer>
      </div>
    </div>
  );
}

function Auth({ onLogin }: { onLogin: (s: Session) => void }) {
  const [mode, setMode] = useState<"login" | "signup" | "admin" | "forgot">("login");
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
    <main className="auth-shell">
      <section className="auth-brand">
        <div className="brand"><span className="brand-mark"><b>x</b></span><span>Xpack</span></div>
        <div><p className="eyebrow">IVR BROADCAST MANAGEMENT</p><h1>Every broadcast,<br/>clear and under control.</h1><p>Place orders, securely share files, track processing, and receive campaign reports in one focused workspace.</p></div>
        <div className="auth-points"><span><Icon name="check"/>Secure file management</span><span><Icon name="check"/>Live order notifications</span><span><Icon name="check"/>Dedicated support desk</span></div>
      </section>
      <section className="auth-panel">
        <form className="auth-card" onSubmit={submit}>
          <div className="auth-heading"><p className="eyebrow">{mode === "admin" ? "RESTRICTED AREA" : "XPACK PORTAL"}</p><h2>{title}</h2><p>{mode === "admin" ? "Use your authorized Xpack Operations credentials." : mode === "signup" ? "Set up your customer workspace in under a minute." : mode === "forgot" ? "We will email a secure reset link to you." : "Sign in to manage your broadcasts."}</p></div>
          {mode === "signup" && <><label>Full name<input name="name" required placeholder="Your full name" disabled={isLocked}/></label><label>Company name <span>(optional)</span><input name="company" placeholder="Your company" disabled={isLocked}/></label><label>Phone number<input name="phone" required placeholder="+91 00000 00000" disabled={isLocked}/></label></>}
          <label>Email address<input name="email" type="email" required placeholder="you@company.com" defaultValue={mode === "admin" ? "admin@xpack.in" : undefined} disabled={isLocked}/></label>
          {mode !== "forgot" && <label>Password<div style={{position: 'relative'}}><input name="password" type={showPassword ? "text" : "password"} required minLength={8} placeholder="••••••••" defaultValue={mode === "admin" ? "" : undefined} style={{paddingRight: '36px'}} disabled={isLocked}/><button type="button" onClick={() => setShowPassword(!showPassword)} style={{position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: '4px'}} disabled={isLocked}><Icon name={showPassword ? "eye-off" : "eye"} size={16}/></button></div></label>}
          {mode === "signup" && <label>Confirm password<input name="confirm" type="password" required minLength={8} placeholder="••••••••" disabled={isLocked}/></label>}
          {mode !== "forgot" && <label>Security Check: What is {captchaQ.n1} + {captchaQ.n2}?<input type="number" required placeholder="Your answer" value={captchaAnswer} onChange={e => setCaptchaAnswer(e.target.value)} disabled={isLocked}/></label>}
          {mode === "login" && <div className="auth-options"><label className="check"><input type="checkbox" defaultChecked disabled={isLocked}/> Remember me</label><button type="button" onClick={() => changeMode("forgot")} disabled={isLocked}>Forgot password?</button></div>}
          {error && <p className="auth-error">{error}</p>}
          <button className="primary auth-submit" disabled={isLocked}>{mode === "signup" ? "Create account" : mode === "forgot" ? "Send reset link" : isLocked ? `Locked (${timeRemaining}s)` : "Sign in"}<Icon name="arrow" size={16}/></button>
          {mode === "admin" ? <button type="button" className="plain-link" onClick={() => changeMode("login")} disabled={isLocked}>Back to customer sign in</button> : <><p className="auth-switch">{mode === "signup" ? "Already have an account?" : "New to Xpack?"} <button type="button" onClick={() => changeMode(mode === "signup" ? "login" : "signup")} disabled={isLocked}>{mode === "signup" ? "Sign in" : "Create an account"}</button></p><button type="button" className="admin-entry" onClick={() => changeMode("admin")} disabled={isLocked}><Icon name="lock" size={14}/>Administrator sign in</button></>}
        </form>
      </section>
    </main>
  );
}

function TransactionTable({ transactions }: { transactions: any[] }) {
  if (!transactions || transactions.length === 0) {
    return <p className="text-muted" style={{ padding: '24px', textAlign: 'center' }}>No transactions found.</p>;
  }
  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Amount</th>
            <th>Order Ref</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map(t => (
            <tr key={t.id}>
              <td style={{ color: '#64748b' }}>{new Date(t.created_at).toLocaleString()}</td>
              <td>
                <span style={{ 
                  display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600,
                  backgroundColor: t.type === 'CREDIT' ? '#e8f7ef' : '#fff0f2',
                  color: t.type === 'CREDIT' ? '#166534' : '#991b1b' 
                }}>
                  <Icon name={t.type === 'CREDIT' ? 'arrow' : 'arrow'} size={12} />
                  {t.type}
                </span>
              </td>
              <td style={{ fontWeight: 600 }}>₹{Number(t.amount).toFixed(2)}</td>
              <td style={{ color: '#64748b' }}>{t.order_id || '-'}</td>
              <td><Badge status={t.status === 'SUCCESS' ? 'Completed' : t.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CustomerPage({ view, orders, tickets, transactions, setView, create, ticket, select, selectTicket, session, balance }: { view: string; orders: Order[]; tickets: Ticket[]; transactions: any[]; setView: (v: string) => void; create: () => void; ticket: () => void; select: (o: Order) => void; selectTicket: (t: Ticket) => void; session: Session; balance: number }) {
  if (view === "My broadcasts") {
    return (
      <>
        <Heading eyebrow="CUSTOMER PORTAL" title="My broadcasts" text="Every IVR broadcast request in one place." action="New broadcast" onAction={create}/>
        <section className="panel data-panel">
          <SMMOrderTable orders={orders} onSelect={select}/>
        </section>
      </>
    );
  }

  if (view === "Support centre") {
    return (
      <>
        <Heading eyebrow="SUPPORT CENTRE" title="How can we help?" text="Create a ticket and keep every conversation in one thread." action="New ticket" onAction={ticket}/>
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
        <Heading eyebrow="ACCOUNT SETTINGS" title="Profile and preferences" text="Keep your account and notification preferences up to date."/>
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
  
  if (view === "Funds") {
    return (
      <>
        <Heading eyebrow="FUNDS" title="Account Balance" text="Add funds to your account to place orders."/>
        <div className="dashboard-grid">
          <section className="panel" style={{display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px'}}>
            <div style={{background: '#f1f5f9', width: '80px', height: '80px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '20px'}}><Icon name="indian-rupee" size={32}/></div>
            <p className="eyebrow">CURRENT BALANCE</p>
            <h2 style={{fontSize: '48px', margin: '10px 0'}}>₹{balance.toFixed(2)}</h2>
            <p className="text-muted" style={{textAlign: 'center', maxWidth: '300px'}}>Balance is automatically deducted when you submit a new broadcast order.</p>
          </section>
          <aside className="panel">
            <h2>Add Funds via Paytm</h2>
            <p className="text-muted" style={{fontSize: '13px', marginBottom: '20px'}}>Recharge your account instantly using Paytm.</p>
            <form method="POST" action="/api/paytm/initiate" className="admin-update">
              <label>Amount (₹)<input type="number" name="amount" min="10" step="1" required defaultValue="500"/></label>
              <button type="submit" className="primary" style={{marginTop: '15px'}}>Pay with Paytm</button>
            </form>
          </aside>
        </div>
        <section className="panel" style={{ marginTop: '24px' }}>
          <h3 style={{ padding: '24px 24px 0', margin: 0 }}>Transaction History</h3>
          <TransactionTable transactions={transactions} />
        </section>
      </>
    );
  }
  
  const placed = orders.filter((o: Order) => o.status === "Placed").length;
  const progressing = orders.filter((o: Order) => o.status === "In progress").length;
  const completed = orders.filter((o: Order) => o.status === "Completed" || o.status === "Partial").length;

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
    if (o.status === "Completed" || o.status === "Partial") {
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
      <Heading eyebrow="CUSTOMER PORTAL" title={`Good morning, ${session.name.split(" ")[0]}`} text="Here's what's happening with your broadcasts." action="New broadcast" onAction={create}/>
      <div className="metric-grid">
        <Metric icon="radio" label="Total broadcasts" value={orders.length} detail="All time"/>
        <Metric icon="clock" label="Pending orders" value={placed} detail="Awaiting review" warning/>
        <Metric icon="activity" label="In progress" value={progressing} detail="Being processed"/>
        <Metric icon="chart" label="Completed / Partial" value={completed} detail="Reports ready" success/>
      </div>
      <div className="dashboard-grid">
        <section className="panel">
          <PanelTop title="Recent broadcasts" text="Your latest broadcast requests." action="View all" onAction={() => setView("My broadcasts")}/>
          <SMMOrderTable orders={orders.slice(0, 4)} onSelect={select}/>
        </section>
        <aside className="activity-panel panel">
          <PanelTop title="Recent activity" text="Across your account."/>
          <div className="timeline">
            {events.length > 0 ? events.slice(0, 3).map((ev, i) => <Timeline key={i} color={ev.color} title={ev.title} text={ev.text} time={ev.time} />) : <p className="text-muted" style={{ padding: '24px 0', textAlign: 'center' }}>No recent activity.</p>}
          </div>
          <button className="outline full" onClick={() => setView("Support centre")}>Open support centre</button>
        </aside>
      </div>
      <section className="quick-section">
        <div><p className="eyebrow">QUICK ACTIONS</p><h2>Manage your broadcasts with ease</h2><p>Everything needed for a successful IVR campaign.</p></div>
        <div className="quick-actions">
          <button onClick={create}><span className="icon-box blue"><Icon name="plus"/></span><span><strong>Create a broadcast</strong><small>Select category & service</small></span><Icon name="arrow" size={18}/></button>
          <button onClick={() => setView("My broadcasts")}><span className="icon-box green"><Icon name="file"/></span><span><strong>View campaign reports</strong><small>Download completed results</small></span><Icon name="arrow" size={18}/></button>
        </div>
      </section>
    </>
  );
}

function AdminPage({ view, orders, tickets, users, transactions, price, setPrice, setView, select, selectTicket, onRefreshBroadcasts }: { view: string; orders: Order[]; tickets: Ticket[]; users: any[]; transactions: any[]; price: string; setPrice: (p: string) => void; setView: (v: string) => void; select: (o: Order) => void; selectTicket: (t: Ticket) => void; onRefreshBroadcasts: () => void }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const [actFilterDate, setActFilterDate] = useState("");
  const [chartDateFilter, setChartDateFilter] = useState("");
  const [scheduleFilter, setScheduleFilter] = useState("current");
  const [localPrice, setLocalPrice] = useState(price);
  
  useEffect(() => { setLocalPrice(price); }, [price]);

  const parseDate = (dStr: string) => {
    const d = new Date(dStr);
    return isNaN(d.getTime()) ? new Date() : d;
  };

  if (view === "Categories & Services") {
    return <CategoryServiceManager />;
  }

  if (view === "Broadcast management") {
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
        <Heading eyebrow="ADMIN PORTAL" title="Broadcast management" text="Review requests, access assets, and manage fulfillment."/>
        <section className="panel data-panel">
          <div className="table-tools" style={{flexWrap: 'wrap'}}>
            <div className="search"><Icon name="search" size={16}/><input placeholder="Search order, category, or customer" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}/></div>
            <div style={{display:'flex',gap:'10px'}}>
              <button className="outline" onClick={() => setScheduleFilter('current')} style={scheduleFilter === 'current' ? {background:'#f1f5f9',borderColor:'#cbd5e1',color:'#0f172a'}: {}}>Current BR's</button>
              <button className="outline" onClick={() => setScheduleFilter('later')} style={scheduleFilter === 'later' ? {background:'#f1f5f9',borderColor:'#cbd5e1',color:'#0f172a'}: {}}>Later BR's</button>
            </div>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option>All statuses</option>
              <option>Placed</option>
              <option>In progress</option>
              <option>Completed</option>
              <option>Partial</option>
              <option>Cancelled</option>
              <option>On hold</option>
            </select>
          </div>
          <SMMOrderTable orders={filtered} admin onSelect={select} onViewCustomer={() => setView("Customers")}/>
        </section>
      </>
    );
  }

  if (view === "Customers") return <><Heading eyebrow="ADMIN PORTAL" title="Customer directory" text="Review customers, their activity, and account standing."/><section className="panel data-panel"><table><thead><tr><th>Customer</th><th>Email</th><th>Orders</th><th>Balance</th><th>Account</th></tr></thead><tbody>{users.map(u => <tr key={u.email} className="clickable-row" onClick={() => { (window as any).selectCustomer?.(u); }}><td><button className="customer-link" onClick={(e) => { e.stopPropagation(); (window as any).selectCustomer?.(u); }}><strong>{u.full_name || u.company_name}</strong></button></td><td>{u.email}</td><td>{orders.filter((x: Order) => x.email === u.email).length}</td><td>₹{(Number(u.balance) || 0).toFixed(2)}</td><td><Badge status={u.is_active ? "Active" : "Closed"}/></td></tr>)}</tbody></table></section></>;
  if (view === "Support desk") return <><Heading eyebrow="ADMIN PORTAL" title="Support desk" text="Prioritize, reply to, and close customer conversations."/><section className="panel data-panel"><TicketTable tickets={tickets} admin onSelect={selectTicket}/></section></>;
  
  if (view === "Activity log") {
    const events: Array<{ title: string; text: string; time: string; dateObj: Date; color: string }> = [];
    orders.forEach(o => {
      events.push({ title: `${o.broadcastNo} created`, text: `${o.customer} submitted ${o.name}`, time: o.created, dateObj: parseDate(o.created), color: "blue" });
      if (o.status === "Completed" || o.status === "Partial") events.push({ title: "Report uploaded", text: `Admin completed ${o.broadcastNo} and shared report.`, time: o.created, dateObj: parseDate(o.created), color: "green" });
      if (o.history) {
        o.history.forEach((h) => {
          events.push({ title: `Order ${h.status.toLowerCase()}`, text: h.reason || `Status updated for ${o.broadcastNo}`, time: new Date(h.created_at).toLocaleString(), dateObj: new Date(h.created_at), color: h.status === 'REFUNDED' ? 'refunded' : h.status === 'CANCELLED' ? 'red' : 'activity' })
        })
      }
    });
    tickets.forEach(t => events.push({ title: "Support ticket opened", text: `Customer opened ${t.id}.`, time: t.created, dateObj: parseDate(t.created), color: "blue" }));
    
    events.sort((a, b) => b.dateObj.getTime() - a.dateObj.getTime());
    
    const filteredEvents = actFilterDate ? events.filter(e => {
      const d = e.dateObj;
      const pad = (n: number) => n.toString().padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` === actFilterDate;
    }) : events;
    const grouped: Record<string, typeof events> = {};
    filteredEvents.forEach(e => {
      const dStr = e.dateObj.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      if (!grouped[dStr]) grouped[dStr] = [];
      grouped[dStr].push(e);
    });

    const customersTotal = users.length;
    const statuses = { placed: 0, progress: 0, hold: 0, completed: 0, cancelled: 0, refunded: 0 };
    let totalRefunds = 0;
    
    const chartOrders = chartDateFilter ? orders.filter(o => {
      const d = parseDate(o.created);
      const pad = (n: number) => n.toString().padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` === chartDateFilter;
    }) : orders;

    chartOrders.forEach(o => {
      if (o.status === "Placed") statuses.placed++;
      else if (o.status === "In progress") statuses.progress++;
      else if (o.status === "On hold") statuses.hold++;
      else if (o.status === "Completed" || o.status === "Partial") statuses.completed++;
      else if (o.status === "Cancelled") statuses.cancelled++;
      else if (o.status === "Refunded") statuses.refunded++;
      
      if (o.status === "Cancelled" || o.status === "Refunded") {
        if (o.charge) totalRefunds += Number(o.charge);
      }
      if (o.partialRefundAmount) {
        totalRefunds += Number(o.partialRefundAmount);
      }
    });
    const maxVal = Math.max(...Object.values(statuses), 1);

    return <><Heading eyebrow="ADMIN PORTAL" title="Activity dashboard" text="Audit trail and operational metrics."/><div className="activity-dashboard"><div className="chart-card"><div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><h3>Order Distribution</h3><div className="activity-filters" style={{marginBottom:0}}><input type="date" className="date-filter" value={chartDateFilter} onChange={e => setChartDateFilter(e.target.value)}/>{chartDateFilter && <button className="text-button" onClick={() => setChartDateFilter("")}>Till now</button>}</div></div><div className="bar-chart"><div className="bar-wrap"><div className="bar" style={{height: `${(statuses.placed/maxVal)*100}%`}}></div><span className="bar-val">{statuses.placed}</span><span className="bar-label">Placed</span></div><div className="bar-wrap"><div className="bar" style={{height: `${(statuses.progress/maxVal)*100}%`, background: '#fff3df'}}></div><span className="bar-val">{statuses.progress}</span><span className="bar-label">In progress</span></div><div className="bar-wrap"><div className="bar" style={{height: `${(statuses.hold/maxVal)*100}%`, background: '#fef3c7'}}></div><span className="bar-val">{statuses.hold}</span><span className="bar-label">On hold</span></div><div className="bar-wrap"><div className="bar" style={{height: `${(statuses.completed/maxVal)*100}%`, background: '#e8f7ef'}}></div><span className="bar-val">{statuses.completed}</span><span className="bar-label">Completed</span></div><div className="bar-wrap"><div className="bar" style={{height: `${(statuses.cancelled/maxVal)*100}%`, background: '#fff0f2'}}></div><span className="bar-val">{statuses.cancelled}</span><span className="bar-label">Cancelled</span></div><div className="bar-wrap"><div className="bar" style={{height: `${(statuses.refunded/maxVal)*100}%`, background: '#f3e8ff'}}></div><span className="bar-val">{statuses.refunded}</span><span className="bar-label">Refunded</span></div></div></div><div style={{display:'flex',flexDirection:'column',gap:'20px'}}><div className="chart-card"><h3>Total Customers</h3><p className="chart-total">{customersTotal}</p><p className="chart-sub">Registered accounts</p></div><div className="chart-card"><h3>Total Refunds</h3><p className="chart-total" style={{color:'#86198f'}}>₹{totalRefunds.toFixed(2)}</p><p className="chart-sub">Processed to wallet</p></div></div></div><section className="panel activity-log"><div className="activity-filters"><label style={{fontSize:'12px',fontWeight:700,color:'#64748b'}}>Filter by date</label><input type="date" className="date-filter" value={actFilterDate} onChange={e => setActFilterDate(e.target.value)}/>{actFilterDate && <button className="text-button" onClick={() => setActFilterDate("")}>Clear filter</button>}</div>{Object.keys(grouped).length > 0 ? Object.entries(grouped).map(([date, evs]) => <div key={date} className="event-group"><h4 className="event-group-date">{date}</h4>{evs.map((ev, i) => <Timeline key={i} color={ev.color} title={ev.title} text={ev.text} time={ev.time} />)}</div>) : <p className="text-muted" style={{ padding: '24px', textAlign: 'center' }}>No activities recorded for this period.</p>}</section></>;
  }
  
  if (view === "Pricing") {
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
        <Heading eyebrow="ADMIN PORTAL" title="Global Call Pricing" text="Set default pricing parameters."/>
        <div className="dashboard-grid">
          <aside className="panel" style={{gridColumn: '1 / -1'}}>
            <h2>Call Pricing (Default per-call rate)</h2>
            <p className="text-muted" style={{fontSize: '13px', marginBottom: '20px'}}>Set the default cost per call for fallback estimates.</p>
            <div className="admin-update" style={{maxWidth: '400px'}}>
              <label>Price per call (₹)<input type="number" step="0.01" value={localPrice} onChange={e => setLocalPrice(e.target.value)}/></label>
              <button className="primary" onClick={handleSavePricing}>Save Pricing</button>
            </div>
          </aside>
        </div>
      </>
    );
  }

  const pending = orders.filter((o: Order) => o.status === "Placed").length;
  const active = orders.filter((o: Order) => o.status === "In progress").length;
  const done = orders.filter((o: Order) => o.status === "Completed" || o.status === "Partial").length;
  const onHoldCount = orders.filter((o: Order) => o.status === "On hold").length;
  const urgentTickets = tickets.filter((t: Ticket) => t.status !== "Resolved" && t.status !== "Closed" && t.priority === "High").length;

  return (
    <>
      <Heading eyebrow="ADMIN PORTAL" title="Operations overview" text="A live view of your broadcast operations."/>
      <div className="metric-grid">
        <Metric icon="users" label="Total customers" value={users.length} detail="Across all accounts"/>
        <Metric icon="clock" label="Pending orders" value={pending} detail="Orders waiting for review" warning/>
        <Metric icon="activity" label="In progress" value={active} detail="Currently processing"/>
        <Metric icon="chart" label="Completed" value={done} detail="Reports delivered" success/>
      </div>
      <div className="dashboard-grid">
        <section className="panel urgent">
          <PanelTop title="Orders needing action" text="New requests and orders that need attention." action="Manage orders" onAction={() => setView("Broadcast management")}/>
          <div className="urgent-list">
            {orders.filter((o: Order) => o.status !== "Completed" && o.status !== "Partial").slice(0,3).map((o: Order, i: number) => (
              <div className="urgent-row" key={o.id}>
                <span className={`priority ${i === 0 ? "new" : "due-soon"}`}>{i === 0 ? "New" : "Due soon"}</span>
                <div><strong>{o.broadcastNo} · {o.customer}</strong><p>{o.name} · {o.created}</p></div>
                <button className="outline small" onClick={() => select(o)}>Review <Icon name="arrow" size={14}/></button>
              </div>
            ))}
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
            <div className="sla" style={{ borderColor: '#e2e8f0', background: '#f8fafc' }}><span className="icon-box green"><Icon name="check"/></span><div><strong>All caught up!</strong><p>No high-priority tickets pending.</p></div></div>
          )}
        </aside>
      </div>
      <section className="panel operations">
        <PanelTop title="Today's processing pipeline" text="Broadcast order health by status."/>
        <div className="pipeline">
          <div><span className="pipe-number blue-fill">{pending}</span><strong>Placed</strong><p>Awaiting review</p></div>
          <span className="pipe-line"/>
          <div><span className="pipe-number yellow-fill">{active}</span><strong>In progress</strong><p>On IVR system</p></div>
          <span className="pipe-line"/>
          <div><span className="pipe-number green-fill">{done}</span><strong>Completed</strong><p>Reports delivered</p></div>
          {onHoldCount > 0 && <><span className="pipe-line"/><div><span className="pipe-number" style={{background:'#fef3c7',color:'#92400e'}}>{onHoldCount}</span><strong>On hold</strong><p>Awaiting fix</p></div></>}
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

  return (
    <>
      <Heading eyebrow="ADMIN PORTAL" title="Category & Service Management" text="Manually create categories and services with custom prices for SMM panel ordering."/>
      {msg && <div style={{background: '#dcfce7', color: '#15803d', padding: '12px 16px', borderRadius: '8px', marginBottom: '20px', fontWeight: 600}}>✓ {msg}</div>}
      
      <div className="dashboard-grid">
        <section className="panel" style={{display: 'flex', flexDirection: 'column', gap: '20px'}}>
          <PanelTop title="Create Category" text="Manually type the category name (e.g. 10 Second Audio, 20 Second Audio)"/>
          <form onSubmit={handleAddCategory} className="admin-update">
            <label>Category Name<input required placeholder="e.g. 10 Second Audio" value={catName} onChange={e => setCatName(e.target.value)}/></label>
            <label>Description (optional)<textarea rows={2} placeholder="Optional notes" value={catDesc} onChange={e => setCatDesc(e.target.value)}/></label>
            <button className="primary" disabled={loading}>Create Category <Icon name="plus" size={16}/></button>
          </form>
        </section>

        <aside className="panel">
          <PanelTop title="Create Service" text="Add a service & price inside a category (e.g. 10 calls for 20 rs)"/>
          <form onSubmit={handleAddService} className="admin-update">
            <label>Select Category
              <select value={selectedCatId} onChange={e => setSelectedCatId(e.target.value)} required>
                <option value="">-- Choose Category --</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label>Service Name<input required placeholder="e.g. 10 calls for 20 rs" value={servName} onChange={e => setServName(e.target.value)}/></label>
            <label>Price (₹)<input type="number" step="0.01" required placeholder="20.00" value={servPrice} onChange={e => setServPrice(e.target.value)}/></label>
            <label>Description (optional)<input placeholder="Optional details" value={servDesc} onChange={e => setServDesc(e.target.value)}/></label>
            <button className="primary" disabled={loading}>Add Service <Icon name="plus" size={16}/></button>
          </form>
        </aside>
      </div>

      <section className="panel data-panel" style={{marginTop: '24px'}}>
        <PanelTop title="Active Categories & Services" text="Current services visible to customers during order creation"/>
        <div style={{display: 'flex', flexDirection: 'column', gap: '20px', padding: '16px'}}>
          {categories.length === 0 ? (
            <p className="text-muted">No categories created yet. Create a category above to get started.</p>
          ) : (
            categories.map(cat => (
              <div key={cat.id} style={{border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px', background: '#f8fafc'}}>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px'}}>
                  <div>
                    <h3 style={{margin: 0, fontSize: '18px', color: '#0f172a'}}>{cat.name}</h3>
                    {cat.description && <p style={{margin: '4px 0 0', color: '#64748b', fontSize: '13px'}}>{cat.description}</p>}
                  </div>
                  <button className="text-button" style={{color: '#ef4444'}} onClick={() => handleDeleteCategory(cat.id)}>
                    <Icon name="trash" size={16}/> Delete Category
                  </button>
                </div>
                
                <div className="table-wrap">
                  <table style={{background: 'white'}}>
                    <thead>
                      <tr>
                        <th>Service Name</th>
                        <th>Price (₹)</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cat.services && cat.services.length > 0 ? (
                        cat.services.map(s => (
                          <tr key={s.id}>
                            <td><strong>{s.name}</strong></td>
                            <td><strong style={{color: '#16a34a'}}>₹{Number(s.price).toFixed(2)}</strong></td>
                            <td><Badge status={s.is_active ? "Active" : "Disabled"}/></td>
                            <td>
                              <button className="text-button" style={{color: '#ef4444'}} onClick={() => handleDeleteService(s.id)}>
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr><td colSpan={4} className="empty">No services added to this category yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </>
  );
}

function Heading({ eyebrow, title, text, action, onAction }: { eyebrow: string; title: string; text: string; action?: string; onAction?: () => void }) { return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{text}</p></div>{action && <button className="primary" onClick={onAction}><Icon name="plus"/>{action}</button>}</div>; }
function PanelTop({ title, text, action, onAction }: { title: string; text: string; action?: string; onAction?: () => void }) { return <div className="panel-top"><div><h2>{title}</h2><p>{text}</p></div>{action && <button className="text-button" onClick={onAction}>{action}<Icon name="arrow" size={15}/></button>}</div>; }
function Metric({ icon, label, value, detail, warning, success }: { icon: string; label: string; value: number | string; detail: string; warning?: boolean; success?: boolean }) { return <article className="metric panel"><div className={`metric-icon ${warning ? "orange" : success ? "green" : "blue"}`}><Icon name={icon}/></div><p>{label}</p><h2>{value}</h2><small className={warning ? "warning-text" : success ? "success-text" : ""}>{detail}</small></article>; }
function Timeline({ color, title, text, time }: { color: string; title: string; text: string; time: string }) { return <div className="timeline-item"><span className={`timeline-dot ${color}`}><Icon name={color === "green" ? "chart" : color === "red" ? "help" : "activity"} size={13}/></span><div><strong>{title}</strong><p>{text}</p><small>{time}</small></div></div>; }

function SMMOrderTable({ orders, onSelect, admin = false, onViewCustomer }: { orders: Order[]; onSelect: (o: Order) => void; admin?: boolean; onViewCustomer?: (email: string) => void }) { 
  const [statusTab, setStatusTab] = useState<string>("All");

  const filteredOrders = statusTab === "All" ? orders : orders.filter(o => {
    if (statusTab === "Pending") return o.status === "Placed";
    if (statusTab === "In Progress") return o.status === "In progress";
    if (statusTab === "Completed") return o.status === "Completed";
    if (statusTab === "Partial") return o.status === "Partial";
    if (statusTab === "Canceled") return o.status === "Cancelled" || o.status === "Refunded";
    return true;
  });

  return (
    <div>
      {/* SMM Panel Inspired Filter Bar */}
      <div style={{display: 'flex', gap: '8px', padding: '14px 16px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', overflowX: 'auto'}}>
        {["All", "Pending", "In Progress", "Completed", "Partial", "Canceled"].map(tab => (
          <button
            key={tab}
            onClick={() => setStatusTab(tab)}
            style={{
              padding: '6px 14px',
              borderRadius: '20px',
              border: statusTab === tab ? '1px solid #3b82f6' : '1px solid #cbd5e1',
              background: statusTab === tab ? '#3b82f6' : 'white',
              color: statusTab === tab ? 'white' : '#475569',
              fontWeight: statusTab === tab ? 600 : 500,
              fontSize: '13px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease'
            }}
          >
            {tab === "All" && "📋 All"}
            {tab === "Pending" && "⏳ Pending"}
            {tab === "In Progress" && "⚙️ In Progress"}
            {tab === "Completed" && "✓ Completed"}
            {tab === "Partial" && "🔄 Partial"}
            {tab === "Canceled" && "❌ Canceled"}
            <span style={{marginLeft: '6px', opacity: 0.8, fontSize: '11px'}}>
              ({tab === "All" ? orders.length : orders.filter(o => {
                if (tab === "Pending") return o.status === "Placed";
                if (tab === "In Progress") return o.status === "In progress";
                if (tab === "Completed") return o.status === "Completed";
                if (tab === "Partial") return o.status === "Partial";
                if (tab === "Canceled") return o.status === "Cancelled" || o.status === "Refunded";
                return true;
              }).length})
            </span>
          </button>
        ))}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{width:'70px',textAlign:'center'}}>ID</th>
              <th>Date</th>
              {admin && <th>Customer</th>}
              <th>Category & Service</th>
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
                <td style={{fontSize: '12px', color: '#64748b'}}>{o.created}</td>
                {admin && <td>{onViewCustomer ? <button className="customer-link" onClick={() => onViewCustomer(o.email)}>{o.customer}</button> : o.customer}</td>}
                <td>
                  <strong>{o.categoryName || o.name}</strong>
                  {o.serviceName && <div style={{fontSize: '12px', color: '#2563eb', fontWeight: 500}}>{o.serviceName}</div>}
                </td>
                <td>
                  <span style={{
                    padding: '2px 8px', 
                    borderRadius: '12px', 
                    fontSize: '11px', 
                    fontWeight: 600,
                    background: o.voiceType === 'FEMALE' ? '#fce7f3' : '#e0f2fe',
                    color: o.voiceType === 'FEMALE' ? '#be185d' : '#0369a1'
                  }}>
                    {o.voiceType === 'FEMALE' ? '👩 Female' : '👨 Male'}
                  </span>
                </td>
                <td>
                  <div><strong>{o.contacts}</strong></div>
                  <span style={{fontSize: '11px', color: '#64748b'}}>{o.contactsInputType === 'MANUAL' ? 'Text paste' : 'File upload'}</span>
                </td>
                <td><strong style={{color: '#0f172a'}}>₹{(o.charge || 0).toFixed(2)}</strong></td>
                <td><Badge status={o.status}/></td>
                <td><button className="text-button row-text" onClick={() => onSelect(o)}>View</button></td>
              </tr>
            )) : (
              <tr><td colSpan={admin ? 9 : 8} className="empty">No broadcast orders found under {statusTab}.</td></tr>
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
    if (!audioFile) return alert("Please upload an audio file."); 
    
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
      audioFile,
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
      <form className="modal" onSubmit={submit} style={{maxWidth: '650px'}}>
        <div className="modal-head">
          <div><p className="eyebrow">NEW BROADCAST ORDER</p><h2>Create a broadcast</h2><p>Select category and service for your IVR broadcast campaign.</p></div>
          <button type="button" className="close" onClick={onClose}><Icon name="close"/></button>
        </div>

        {/* 1. Category Selection */}
        <label style={{fontWeight: 600, color: '#0f172a'}}>Category
          <select 
            value={selectedCatId} 
            onChange={e => {
              setSelectedCatId(e.target.value);
              setSelectedServiceId("");
            }} 
            required
            style={{padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', marginTop: '6px', fontSize: '14px', width: '100%'}}
          >
            <option value="">-- Select Category --</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>

        {/* 2. Service Selection */}
        <label style={{fontWeight: 600, color: '#0f172a'}}>Service
          <select 
            value={selectedServiceId} 
            onChange={e => setSelectedServiceId(e.target.value)} 
            disabled={!selectedCatId}
            required
            style={{
              padding: '10px 14px', 
              borderRadius: '8px', 
              border: '1px solid #cbd5e1', 
              marginTop: '6px', 
              fontSize: '14px', 
              width: '100%',
              background: !selectedCatId ? '#f1f5f9' : 'white'
            }}
          >
            <option value="">{!selectedCatId ? "First select a category above..." : "-- Select Service --"}</option>
            {availableServices.map(s => (
              <option key={s.id} value={s.id}>{s.name} — ₹{Number(s.price).toFixed(2)}</option>
            ))}
          </select>
        </label>

        {/* 3. Voice Selection */}
        <div style={{margin: '10px 0'}}>
          <label style={{fontWeight: 600, color: '#0f172a', display: 'block', marginBottom: '8px'}}>Select Voice</label>
          <div style={{display: 'flex', gap: '12px'}}>
            <button
              type="button"
              onClick={() => setVoiceType('MALE')}
              style={{
                flex: 1,
                padding: '10px',
                borderRadius: '8px',
                border: voiceType === 'MALE' ? '2px solid #2563eb' : '1px solid #cbd5e1',
                background: voiceType === 'MALE' ? '#eff6ff' : 'white',
                color: voiceType === 'MALE' ? '#1d4ed8' : '#475569',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
            >
              👨 Male Voice
            </button>
            <button
              type="button"
              onClick={() => setVoiceType('FEMALE')}
              style={{
                flex: 1,
                padding: '10px',
                borderRadius: '8px',
                border: voiceType === 'FEMALE' ? '2px solid #db2777' : '1px solid #cbd5e1',
                background: voiceType === 'FEMALE' ? '#fdf2f8' : 'white',
                color: voiceType === 'FEMALE' ? '#be185d' : '#475569',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
            >
              👩 Female Voice
            </button>
          </div>
        </div>

        {/* 4. Audio File Upload */}
        <label style={{fontWeight: 600, color: '#0f172a'}}>Audio file 
          <span className="dropzone" style={{marginTop: '6px'}}>
            {audioFile ? (
              <><Icon name="check"/><b>{audioFile.name}</b><small>Ready to upload</small></>
            ) : (
              <><Icon name="upload"/><b>Upload audio file</b><small>Maximum 25 MB (.mp3, .wav, .aac)</small></>
            )}
            <input name="audio" type="file" required onChange={e => setAudioFile(e.target.files?.[0] || null)} accept="audio/*"/>
          </span>
        </label>

        {/* 5. Target Numbers Upload (Two Methods) */}
        <div style={{margin: '12px 0'}}>
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px'}}>
            <label style={{fontWeight: 600, color: '#0f172a'}}>Target Phone Numbers</label>
            <div style={{display: 'flex', gap: '6px', background: '#f1f5f9', padding: '2px', borderRadius: '6px'}}>
              <button
                type="button"
                onClick={() => setInputMethod('FILE')}
                style={{
                  padding: '4px 10px',
                  borderRadius: '5px',
                  border: 'none',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: inputMethod === 'FILE' ? 'white' : 'transparent',
                  boxShadow: inputMethod === 'FILE' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
                  color: inputMethod === 'FILE' ? '#0f172a' : '#64748b'
                }}
              >
                File Upload
              </button>
              <button
                type="button"
                onClick={() => setInputMethod('MANUAL')}
                style={{
                  padding: '4px 10px',
                  borderRadius: '5px',
                  border: 'none',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: inputMethod === 'MANUAL' ? 'white' : 'transparent',
                  boxShadow: inputMethod === 'MANUAL' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
                  color: inputMethod === 'MANUAL' ? '#0f172a' : '#64748b'
                }}
              >
                Type / Copy-Paste
              </button>
            </div>
          </div>

          {inputMethod === 'FILE' ? (
            <div>
              <span className="dropzone" style={isParsing ? {opacity:0.5} : {}}>
                {contactsFile ? (
                  <><Icon name="check"/><b>{contactsFile.name}</b><small>{isParsing ? "Scanning file..." : `${contactsCount} contacts found`}</small></>
                ) : (
                  <><Icon name="upload"/><b>Upload contact list file</b><small>Compatible with CSV, TXT, XLSX, PDF, etc.</small></>
                )}
                <input type="file" onChange={handleContactsFileChange} accept=".csv,.txt,.xlsx,.xls,.pdf"/>
              </span>
              {contactsFile && !isParsing && (
                <div style={{background: '#dcfce7', color: '#15803d', padding: '8px 12px', borderRadius: '6px', fontSize: '13px', marginTop: '6px', fontWeight: 600}}>
                  ✓ {contactsCount} contacts found from file
                </div>
              )}
            </div>
          ) : (
            <div>
              <textarea 
                rows={4} 
                placeholder="Paste or type phone numbers here (one number per line or separated by commas)..." 
                value={manualText}
                onChange={e => handleManualTextChange(e.target.value)}
                style={{width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', fontFamily: 'monospace'}}
              />
              {manualText.trim().length > 0 && (
                <div style={{background: '#dcfce7', color: '#15803d', padding: '8px 12px', borderRadius: '6px', fontSize: '13px', marginTop: '6px', fontWeight: 600}}>
                  ✓ {contactsCount} contacts entered manually
                </div>
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
        <div style={{background: '#f8fafc', padding: '15px', borderRadius: '8px', border: '1px solid #e2e8f0', margin: '15px 0'}}>
          <div style={{display:'flex', justifyContent:'space-between', marginBottom:'5px'}}><span>Selected Service:</span><strong>{currentService ? currentService.name : 'None selected'}</strong></div>
          <div style={{display:'flex', justifyContent:'space-between', marginBottom:'5px'}}><span>Selected Voice:</span><strong>{voiceType === 'FEMALE' ? 'Female Voice' : 'Male Voice'}</strong></div>
          <div style={{display:'flex', justifyContent:'space-between', marginBottom:'5px'}}><span>Target Contacts:</span><strong>{contactsCount > 0 ? `${contactsCount} contacts` : '-'}</strong></div>
          <div style={{display:'flex', justifyContent:'space-between', marginTop:'10px', paddingTop:'10px', borderTop:'1px solid #cbd5e1', fontSize:'16px'}}><span>Total Charge:</span><strong style={{color: '#0f172a'}}>₹{calculatedCost.toFixed(2)}</strong></div>
          {!canAfford && currentService && (
            <p style={{color: '#ef4444', fontSize: '12px', marginTop: '10px', textAlign: 'right', fontWeight: 600}}>
              Insufficient balance (₹{balance.toFixed(2)} available)
            </p>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="outline" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={isParsing || !selectedServiceId || !canAfford}>
            Confirm Order & Debit ₹{calculatedCost.toFixed(2)} <Icon name="arrow" size={16}/>
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
  if (currentStatus === "Partial") steps[2] = { label: "Partial", key: "Partial" };
  if (currentStatus === "On hold") steps[1] = { label: "On hold", key: "On hold" };

  const getStatusClass = (stepKey: string, current: string) => {
    if (stepKey === current) return `active ${stepKey.toLowerCase().replace(" ", "-")}`;
    if (current === "Completed" || current === "Partial" || current === "Refunded" || (current === "In progress" && stepKey === "Placed")) return "completed";
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
    if (pAmt > 0 && (status === "Completed" || status === "Placed" || status === "In progress")) {
      targetStatus = "Partial";
    }

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
      <div className="modal compact-modal" style={{maxWidth: '650px'}}>
        <div className="modal-head">
          <div><p className="eyebrow">{order.broadcastNo}</p><h2>{order.name}</h2><p>{order.customer} · {order.contacts}</p></div>
          <button className="close" onClick={onClose}><Icon name="close"/></button>
        </div>

        <StatusTimeline currentStatus={order.status}/>

        <div className="detail-grid">
          <div><small>Current status</small><Badge status={order.status}/></div>
          <div><small>Voice Type</small><strong>{order.voiceType === 'FEMALE' ? '👩 Female Voice' : '👨 Male Voice'}</strong></div>
          <div><small>Category & Service</small><strong>{order.categoryName || 'General'}</strong><br/><small style={{color: '#2563eb'}}>{order.serviceName}</small></div>
          <div><small>Total Charge</small><strong style={{color: '#16a34a'}}>₹{(order.charge || 0).toFixed(2)}</strong></div>
          <div>
            <small>Audio asset</small>
            {order.audioKey ? (
              <button className="text-button" onClick={() => handleDownload(order.audioKey!)} title={order.audioKey}><Icon name="download" size={14}/>Download Audio</button>
            ) : <span className="text-muted">No file</span>}
          </div>
          <div>
            <small>Contacts Data</small>
            {order.contactsKey ? (
              <button className="text-button" onClick={() => handleDownload(order.contactsKey!)} title={order.contactsKey}><Icon name="download" size={14}/>Download Contacts File</button>
            ) : order.manualContacts ? (
              <span style={{fontSize: '12px', fontWeight: 600, color: '#0f172a'}}>Text paste ({order.contactCount} numbers)</span>
            ) : <span className="text-muted">No data</span>}
          </div>
        </div>

        {/* Display manual contacts to admin or customer if text paste was used */}
        {order.manualContacts && (
          <div className="detail-note" style={{marginTop: '10px'}}>
            <strong>Target Phone Numbers (Text Paste)</strong>
            <textarea readOnly rows={3} value={order.manualContacts} style={{width: '100%', marginTop: '6px', fontSize: '12px', fontFamily: 'monospace', background: '#f8fafc'}}/>
          </div>
        )}

        {order.notes && (
          <div className="detail-note">
            <strong>Customer instructions / message</strong>
            <p>{order.notes}</p>
          </div>
        )}

        {order.adminComment && (
          <div className="detail-note" style={{background: '#f0f9ff', borderColor: '#bae6fd'}}>
            <strong>Admin Remarks / Report Note</strong>
            <p>{order.adminComment}</p>
          </div>
        )}

        {order.partialRefundAmount && order.partialRefundAmount > 0 && (
          <div className="refund-box">
            <Icon name="check" size={18}/>
            <div>
              <strong>Partial Refund Credited (₹{order.partialRefundAmount.toFixed(2)})</strong>
              <p>Amount has been automatically credited back to customer wallet balance.</p>
            </div>
          </div>
        )}

        {order.report && (
          <div className="report-ready">
            <Icon name="check"/>
            <div><strong>Performance report ready</strong><p>Report file has been uploaded to this order.</p></div>
            <button className="outline" onClick={() => handleDownload(order.reportKey!)}><Icon name="download" size={14}/>Download Report</button>
          </div>
        )}

        {!admin && order.status === "On hold" && order.holdReason && (
          <div className="hold-reason-box"><Icon name="pause" size={18}/><div><strong>Order on hold — Action required</strong><p>{order.holdReason}</p></div></div>
        )}

        {!admin && order.status === "On hold" && (
          <div className="resubmit-section">
            <h3>Resubmit files to resolve the issue</h3>
            <p style={{fontSize:'12px',color:'#78350f',margin:'0 0 12px'}}>Upload a corrected audio file and/or contact list. Your order will be moved back to &quot;Placed&quot; for review.</p>
            <div className="form-grid">
              <label>Audio file <span className="dropzone">{resubmitAudio ? <><Icon name="check"/><b>{resubmitAudio.name}</b><small>Ready</small></> : <><Icon name="upload"/><b>Replace audio</b><small>Optional</small></>}<input type="file" onChange={e => setResubmitAudio(e.target.files?.[0] || null)}/></span></label>
              <label>Contact list <span className="dropzone">{resubmitContacts ? <><Icon name="check"/><b>{resubmitContacts.name}</b><small>Ready</small></> : <><Icon name="upload"/><b>Replace contacts</b><small>Optional</small></>}<input type="file" onChange={e => setResubmitContacts(e.target.files?.[0] || null)}/></span></label>
            </div>
            <button className="primary" onClick={() => onResubmit(order.id, resubmitAudio || undefined, resubmitContacts || undefined)} disabled={!resubmitAudio && !resubmitContacts}>Resubmit files <Icon name="arrow" size={16}/></button>
          </div>
        )}

        {/* Admin fulfillment & status update modal form */}
        {admin && (
          <div className="admin-update" style={{background: '#f8fafc', padding: '16px', borderRadius: '10px', border: '1px solid #cbd5e1', marginTop: '15px'}}>
            <h3 style={{margin: '0 0 12px', fontSize: '15px', color: '#0f172a'}}>Admin Fulfillment & Status Update</h3>
            
            <label>Update Order Status
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

            {(status === "Completed" || status === "Partial" || status === "Placed" || status === "In progress") && (
              <div style={{background: 'white', padding: '14px', borderRadius: '8px', border: '1px solid #e2e8f0', margin: '10px 0'}}>
                <h4 style={{margin: '0 0 8px', fontSize: '14px', color: '#0f172a'}}>Partial Refund Section (Optional)</h4>
                <p style={{fontSize: '12px', color: '#64748b', margin: '0 0 12px'}}>If some calls were undelivered/unanswered, enter the refund amount. You must type the amount 2 times for double-verification.</p>
                
                <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px'}}>
                  <label style={{fontSize: '13px'}}>Partial Refund Amount (₹)
                    <input 
                      type="number" 
                      step="0.01" 
                      placeholder="0.00" 
                      value={partialRefundAmount} 
                      onChange={e => setPartialRefundAmount(e.target.value)}
                      style={{padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1'}}
                    />
                  </label>
                  <label style={{fontSize: '13px'}}>Confirm Refund Amount (₹)
                    <input 
                      type="number" 
                      step="0.01" 
                      placeholder="0.00" 
                      value={confirmPartialRefundAmount} 
                      onChange={e => setConfirmPartialRefundAmount(e.target.value)}
                      style={{
                        padding: '8px 10px', 
                        borderRadius: '6px', 
                        border: partialRefundMismatch ? '2px solid #ef4444' : '1px solid #cbd5e1'
                      }}
                    />
                  </label>
                </div>

                {partialRefundMismatch && (
                  <div style={{color: '#dc2626', fontSize: '12px', fontWeight: 600, marginTop: '8px'}}>
                    ⚠️ Mismatch warning: Both partial refund amounts must match exactly!
                  </div>
                )}

                {partialRefundAmount && !partialRefundMismatch && parseFloat(partialRefundAmount) > 0 && (
                  <div style={{color: '#16a34a', fontSize: '12px', fontWeight: 600, marginTop: '8px'}}>
                    ✓ Valid: ₹{parseFloat(partialRefundAmount).toFixed(2)} will be credited back to customer's wallet balance.
                  </div>
                )}
              </div>
            )}

            {(status === "Completed" || status === "Partial") && (
              <label>Campaign Report File
                <input type="file" accept=".csv,.pdf,.zip,.xlsx" onChange={e => setReportFile(e.target.files?.[0] || null)}/>
              </label>
            )}

            <label>Admin Comment / Remarks for Customer
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
              <label>Cancellation reason<textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)} rows={3} placeholder="Why is this order cancelled?"/></label>
            )}

            <button 
              className="primary" 
              onClick={handleAdminSubmit}
              disabled={partialRefundMismatch}
              style={{marginTop: '10px'}}
            >
              Save & Process Fulfillment
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
        <div className="detail-note"><strong>Customer Message</strong><p>{ticket.message}</p></div>
        {ticket.reply && !admin && <div className="detail-note" style={{background: '#f0f9ff', borderColor: '#bae6fd'}}><strong>Admin Reply</strong><p>{ticket.reply}</p></div>}
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
