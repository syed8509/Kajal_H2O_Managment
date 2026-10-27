import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard,
  Users,
  ClipboardList,
  Wallet,
  Download,
  LogOut,
  Plus,
  Search,
  MessageCircle,
  Truck,
  X,
  Check,
  Droplets,
  RefreshCw,
  FileSpreadsheet,
  AlertCircle,
  Edit3,
} from "lucide-react";

const API = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "") + "/api";
const PRODUCTS = ["250ml", "500ml", "1L", "2L", "20L"];
const TYPES = ["Shop", "Hotel", "Home", "Office", "special event", "Other"];
const METHODS = ["Cash", "UPI", "Bank Transfer", "Other"];
const money = (n) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(n || 0));
const date = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";
const blankCustomer = {
  name: "",
  phone: "",
  whatsappPhone: "",
  type: "Shop",
  address: "",
  notes: "",
};

export default function App() {
  const [token, setToken] = useState(
    () => localStorage.getItem("kh_token") || "",
  );
  const [owner, setOwner] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("kh_owner") || "null");
    } catch {
      return null;
    }
  });
  const [page, setPage] = useState("Dashboard");
  const [dashboard, setDashboard] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [customerModal, setCustomerModal] = useState(null);
  const [orderModal, setOrderModal] = useState(false);
  const [paymentOrder, setPaymentOrder] = useState(null);
  const [ledgerCustomer, setLedgerCustomer] = useState(null);

  const api = useCallback(
    async (path, options = {}) => {
      const headers = {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      };
      const res = await fetch(`${API}${path}`, { ...options, headers });
      if (res.status === 401 && path !== "/auth/login") {
        localStorage.removeItem("kh_token");
        setToken("");
        setOwner(null);
      }
      const type = res.headers.get("content-type") || "";
      if (!res.ok) {
        const body = type.includes("application/json")
          ? await res.json()
          : { message: "Request failed." };
        throw new Error(body.message || "Request failed.");
      }
      if (options.raw) return res;
      return type.includes("application/json") ? res.json() : res.text();
    },
    [token],
  );

  const refresh = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      const [d, c, o] = await Promise.all([
        api("/dashboard"),
        api("/customers"),
        api("/orders"),
      ]);
      setDashboard(d);
      setCustomers(c);
      setOrders(o);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [api, token]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 3000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  async function login(email, password) {
    setBusy(true);
    setError("");
    try {
      const result = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      localStorage.setItem("kh_token", result.token);
      localStorage.setItem("kh_owner", JSON.stringify(result.owner));
      setToken(result.token);
      setOwner(result.owner);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function logout() {
    localStorage.removeItem("kh_token");
    localStorage.removeItem("kh_owner");
    setToken("");
    setOwner(null);
    setDashboard(null);
    setCustomers([]);
    setOrders([]);
  }
  async function saveCustomer(data) {
    try {
      if (data._id)
        await api(`/customers/${data._id}`, {
          method: "PUT",
          body: JSON.stringify(data),
        });
      else
        await api("/customers", { method: "POST", body: JSON.stringify(data) });
      setCustomerModal(null);
      setToast("Customer saved successfully.");
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }
  async function archiveCustomer(c) {
    if (!confirm(`Archive ${c.name}? Their financial history will be kept.`))
      return;
    try {
      await api(`/customers/${c._id}`, { method: "DELETE" });
      setToast("Customer archived.");
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }
  async function createOrder(data) {
    try {
      await api("/orders", { method: "POST", body: JSON.stringify(data) });
      setOrderModal(false);
      setToast("Order created.");
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }
  async function addPayment(id, data) {
    try {
      await api(`/orders/${id}/payments`, {
        method: "POST",
        body: JSON.stringify(data),
      });
      setPaymentOrder(null);
      setToast("Payment recorded.");
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }
  async function updateDelivery(order, status) {
    try {
      await api(`/orders/${order._id}/delivery`, {
        method: "PATCH",
        body: JSON.stringify({ deliveryStatus: status }),
      });
      setToast(`Delivery marked ${status.toLowerCase()}.`);
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }
  async function openLedger(c) {
    try {
      const data = await api(`/customers/${c._id}/ledger`);
      setLedgerCustomer(data);
    } catch (e) {
      setError(e.message);
    }
  }
  async function downloadExport(path, filename) {
    try {
      const res = await api(path, { raw: true });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setToast("Export downloaded.");
    } catch (e) {
      setError(e.message);
    }
  }

  const filteredCustomers = useMemo(
    () =>
      customers.filter((c) =>
        `${c.name} ${c.phone} ${c.address}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [customers, search],
  );
  const filteredOrders = useMemo(
    () =>
      orders.filter((o) =>
        `${o.orderNumber} ${o.customer?.name || ""} ${o.customer?.phone || ""}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [orders, search],
  );

  if (!token) return <Login onLogin={login} busy={busy} error={error} />;

  const nav = [
    { name: "Dashboard", icon: LayoutDashboard },
    { name: "Customers", icon: Users },
    { name: "Orders", icon: ClipboardList },
    { name: "Ledger", icon: Wallet },
    { name: "Backup", icon: Download },
  ];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <Droplets size={25} />
          </div>
          <div>
            <b>KAJAL H2O</b>
            <small>Business Manager</small>
          </div>
        </div>
        <nav>
          {nav.map((n) => (
            <button
              key={n.name}
              className={`nav-item ${page === n.name ? "active" : ""}`}
              onClick={() => {
                setPage(n.name);
                setSearch("");
              }}
            >
              <n.icon size={18} />
              <span>{n.name}</span>
            </button>
          ))}
        </nav>
        <div className="side-bottom">
          <div className="owner-dot">
            {(owner?.name || "O").slice(0, 1).toUpperCase()}
          </div>
          <div className="owner-meta">
            <b>{owner?.name || "Owner"}</b>
            <small>Owner access</small>
          </div>
          <button className="icon-btn" aria-label="Log out" onClick={logout}>
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            <div className="eyebrow">KAJAL H2O / MANAGEMENT</div>
            <h1>{page}</h1>
          </div>
          <div className="top-actions">
            <span className="live-dot">● Connected</span>
            <button
              className="icon-btn refresh"
              onClick={refresh}
              title="Refresh"
            >
              <RefreshCw size={18} />
            </button>
          </div>
        </header>
        {error && (
          <div className="alert">
            <AlertCircle size={18} />
            <span>{error}</span>
            <button onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {busy && <div className="loading-line" />}
        {page === "Dashboard" && (
          <Dashboard
            data={dashboard}
            orders={orders}
            onNew={() => setOrderModal(true)}
            onOrders={() => setPage("Orders")}
            onCustomers={() => setPage("Customers")}
          />
        )}
        {page === "Customers" && (
          <section className="panel">
            <div className="section-head">
              <div>
                <h2>Customers</h2>
                <p>Manage your shops, hotels, homes and offices.</p>
              </div>
              <button
                className="primary"
                onClick={() => setCustomerModal(blankCustomer)}
              >
                <Plus size={17} /> Add customer
              </button>
            </div>
            <SearchBox
              value={search}
              onChange={setSearch}
              placeholder="Search name, phone or address"
            />
            <CustomerTable
              customers={filteredCustomers}
              onEdit={(c) => setCustomerModal(c)}
              onArchive={archiveCustomer}
              onLedger={openLedger}
            />
          </section>
        )}
        {page === "Orders" && (
          <section className="panel">
            <div className="section-head">
              <div>
                <h2>Orders & delivery</h2>
                <p>Order totals, payments, balances and delivery status.</p>
              </div>
              <button className="primary" onClick={() => setOrderModal(true)}>
                <Plus size={17} /> New order
              </button>
            </div>
            <SearchBox
              value={search}
              onChange={setSearch}
              placeholder="Search order number or customer"
            />
            <OrderTable
              orders={filteredOrders}
              onPayment={setPaymentOrder}
              onDelivery={updateDelivery}
              onWhatsApp={openWhatsApp}
            />
          </section>
        )}
        {page === "Ledger" && (
          <section className="panel">
            <div className="section-head">
              <div>
                <h2>Customer ledger</h2>
                <p>Select a customer to view the running account statement.</p>
              </div>
            </div>
            <SearchBox
              value={search}
              onChange={setSearch}
              placeholder="Search customer"
            />
            <CustomerTable
              customers={filteredCustomers}
              onEdit={(c) => setCustomerModal(c)}
              onArchive={archiveCustomer}
              onLedger={openLedger}
            />
          </section>
        )}
        {page === "Backup" && <BackupPage onDownload={downloadExport} />}
      </main>
      <nav className="mobile-nav">
        {nav.map((n) => (
          <button
            key={n.name}
            className={page === n.name ? "active" : ""}
            onClick={() => {
              setPage(n.name);
              setSearch("");
            }}
          >
            <n.icon size={19} />
            <small>{n.name}</small>
          </button>
        ))}
      </nav>
      {customerModal && (
        <CustomerModal
          initial={customerModal}
          onClose={() => setCustomerModal(null)}
          onSave={saveCustomer}
        />
      )}
      {orderModal && (
        <OrderModal
          customers={customers}
          onClose={() => setOrderModal(false)}
          onSave={createOrder}
        />
      )}
      {paymentOrder && (
        <PaymentModal
          order={paymentOrder}
          onClose={() => setPaymentOrder(null)}
          onSave={(data) => addPayment(paymentOrder._id, data)}
        />
      )}
      {ledgerCustomer && (
        <LedgerModal
          data={ledgerCustomer}
          onClose={() => setLedgerCustomer(null)}
        />
      )}
      {toast && (
        <div className="toast">
          <Check size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}

function Login({ onLogin, busy, error }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <Droplets size={30} />
        </div>
        <div className="eyebrow center">OWNER ACCESS</div>
        <h1>KAJAL H2O</h1>
        <p className="login-sub">Business Manager</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onLogin(email, password);
          }}
        >
          <label>Email address</label>
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="owner@example.com"
          />
          <label>Password</label>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
          />
          {error && <div className="form-error">{error}</div>}
          <button className="primary full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in securely"}
          </button>
        </form>
        <small className="muted">Single-owner account • INR ledger</small>
      </div>
    </div>
  );
}
function Dashboard({ data, orders, onNew, onOrders, onCustomers }) {
  const stats = [
    {
      label: "Today's sales",
      value: money(data?.todaySales),
      icon: ClipboardList,
      tone: "blue",
    },
    {
      label: "Collected today",
      value: money(data?.todayCollected),
      icon: Wallet,
      tone: "green",
    },
    {
      label: "Total customer due",
      value: money(data?.totalDue),
      icon: AlertCircle,
      tone: "orange",
    },
    {
      label: "Pending deliveries",
      value: data?.pendingDeliveries ?? 0,
      icon: Truck,
      tone: "purple",
    },
  ];
  return (
    <div className="dashboard">
      <div className="welcome">
        <div>
          <span className="welcome-tag">YOUR BUSINESS AT A GLANCE</span>
          <h2>Good business starts with clear records.</h2>
          <p>Keep every order, payment and delivery in one place.</p>
        </div>
        <div className="welcome-mark">
          <Droplets size={56} />
        </div>
      </div>
      <div className="stat-grid">
        {stats.map((s) => (
          <div className="stat-card" key={s.label}>
            <div className={`stat-icon ${s.tone}`}>
              <s.icon size={20} />
            </div>
            <span>{s.label}</span>
            <strong>{s.value}</strong>
          </div>
        ))}
      </div>
      <div className="quick-grid">
        <button onClick={onNew}>
          <div className="quick-icon">
            <Plus />
          </div>
          <span>
            <b>Create an order</b>
            <small>Record water products and price</small>
          </span>
        </button>
        <button onClick={onCustomers}>
          <div className="quick-icon teal">
            <Users />
          </div>
          <span>
            <b>Add or find a customer</b>
            <small>View contact and outstanding due</small>
          </span>
        </button>
        <button onClick={onOrders}>
          <div className="quick-icon amber">
            <Truck />
          </div>
          <span>
            <b>Manage deliveries</b>
            <small>Update pending orders</small>
          </span>
        </button>
      </div>
      <section className="panel recent-panel">
        <div className="section-head">
          <div>
            <h2>Recent orders</h2>
            <p>Latest customer activity</p>
          </div>
          <button className="text-btn" onClick={onOrders}>
            View all <span>→</span>
          </button>
        </div>
        <OrderTable
          orders={(data?.recentOrders || orders).slice(0, 6)}
          compact
        />
      </section>
    </div>
  );
}
function SearchBox({ value, onChange, placeholder }) {
  return (
    <div className="searchbox">
      <Search size={18} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {value && (
        <button onClick={() => onChange("")}>
          <X size={15} />
        </button>
      )}
    </div>
  );
}
function CustomerTable({ customers, onEdit, onArchive, onLedger }) {
  if (!customers.length)
    return (
      <Empty
        title="No customers found"
        detail="Add your first customer to start keeping records."
      />
    );
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Customer</th>
            <th>Type</th>
            <th>Phone</th>
            <th>Lifetime sales</th>
            <th>Due balance</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {customers.map((c) => (
            <tr key={c._id}>
              <td>
                <div className="customer-cell">
                  <div className="avatar">
                    {c.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <b>{c.name}</b>
                    <small>{c.address || "No address added"}</small>
                  </div>
                </div>
              </td>
              <td>
                <span className="type-pill">{c.type}</span>
              </td>
              <td>{c.phone}</td>
              <td>{money(c.lifetimeSales)}</td>
              <td>
                <b className={c.balance > 0 ? "due-text" : "paid-text"}>
                  {money(c.balance)}
                </b>
              </td>
              <td>
                <div className="action-row">
                  <button
                    className="small-btn"
                    title="Ledger"
                    onClick={() => onLedger(c)}
                  >
                    <Wallet size={15} />
                  </button>
                  <button
                    className="small-btn"
                    title="Edit"
                    onClick={() => onEdit(c)}
                  >
                    <Edit3 size={15} />
                  </button>

                  <a
                    className="small-btn wa"
                    title="WhatsApp"
                    href={whatsappUrl(
                      c,
                      `*Hello Dear ${c.name}!* 

*KAJAL H2O (Water Distibutor)*

Aapko paani ki bottles chahiye? 

Agar haan, toh kripya humein ye details batayein:

📦 *Bottle Quantity:* 
🕒 *Delivery Time:* 
🕒 *Delivery Place:* 

Apna order confirm karne ke liye WhatsApp par reply karein.

*Call Now: 8509022744*

*Thank You!*
* Team KAJAL H2O *
* Your Trusted Water Distributor*`,
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <MessageCircle size={15} />
                  </a>

                  <button
                    className="small-btn danger-btn"
                    title="Archive customer"
                    onClick={() => onArchive(c)}
                  >
                    <X size={15} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function OrderTable({
  orders,
  onPayment,
  onDelivery,
  onWhatsApp,
  compact = false,
}) {
  if (!orders?.length)
    return (
      <Empty title="No orders yet" detail="Create an order to see it here." />
    );
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Order / Customer</th>
            <th>Date</th>
            <th>Items</th>
            <th>Total</th>
            <th>Paid / Due</th>
            <th>Delivery</th>
            {!compact && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o._id}>
              <td>
                <b>{o.orderNumber}</b>
                <small className="block">
                  {o.customer?.name || "Customer"}
                </small>
              </td>
              <td>{date(o.orderDate)}</td>
              <td>
                <div className="items-text">
                  {(o.items || [])
                    .map((i) => `${i.product} × ${i.quantity}`)
                    .join(", ")}
                </div>
              </td>
              <td>
                <b>
                  {money(
                    o.total ??
                      (o.items || []).reduce(
                        (s, i) => s + i.quantity * i.unitPrice,
                        0,
                      ),
                  )}
                </b>
              </td>
              <td>
                <span className="paid-text">
                  {money(
                    o.paid ??
                      (o.payments || []).reduce((s, p) => s + p.amount, 0),
                  )}{" "}
                  paid
                </span>
                <small className="block due-text">
                  {money(o.due ?? Math.max(0, (o.total || 0) - (o.paid || 0)))}{" "}
                  due
                </small>
              </td>
              <td>
                <span className={`status ${o.deliveryStatus?.toLowerCase()}`}>
                  {o.deliveryStatus}
                </span>
              </td>
              {!compact && (
                <td>
                  <div className="action-row">
                    {o.due > 0 && (
                      <button
                        className="small-btn"
                        title="Record payment"
                        onClick={() => onPayment(o)}
                      >
                        <Wallet size={15} />
                      </button>
                    )}
                    {o.deliveryStatus === "Pending" && (
                      <button
                        className="small-btn"
                        title="Mark delivered"
                        onClick={() => onDelivery(o, "Delivered")}
                      >
                        <Truck size={15} />
                      </button>
                    )}
                    {onWhatsApp && (
                      <button
                        className="small-btn wa"
                        title="WhatsApp"
                        onClick={() => onWhatsApp(o)}
                      >
                        <MessageCircle size={15} />
                      </button>
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Empty({ title, detail }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <ClipboardList size={24} />
      </div>
      <b>{title}</b>
      <p>{detail}</p>
    </div>
  );
}
function CustomerModal({ initial, onClose, onSave }) {
  const [form, setForm] = useState({ ...blankCustomer, ...initial });
  const [saving, setSaving] = useState(false);
  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  return (
    <Modal
      title={form._id ? "Edit customer" : "Add customer"}
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          await onSave(form);
          setSaving(false);
        }}
      >
        <div className="form-grid">
          <Field label="Customer name *">
            <input
              required
              value={form.name || ""}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Shop or customer name"
            />
          </Field>
          <Field label="Phone number *">
            <input
              required
              inputMode="tel"
              value={form.phone || ""}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="10-digit mobile number"
            />
          </Field>

          <Field label="WhatsApp number (with country code)">
            <input
              value={form.whatsappPhone || ""}
              onChange={(e) => set("whatsappPhone", e.target.value)}
              placeholder="10-digit Whatsapp number"
            />
          </Field>
          <Field label="Customer type">
            <select
              value={form.type || "Shop"}
              onChange={(e) => set("type", e.target.value)}
            >
              {TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Address" wide>
            <textarea
              rows="2"
              value={form.address || ""}
              onChange={(e) => set("address", e.target.value)}
              placeholder="Delivery address"
            />
          </Field>
          <Field label="Notes" wide>
            <textarea
              rows="2"
              value={form.notes || ""}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Delivery preferences or other notes"
            />
          </Field>
        </div>
        <ModalActions onClose={onClose} saving={saving} />
      </form>
    </Modal>
  );
}
function OrderModal({ customers, onClose, onSave }) {
  const [customerId, setCustomerId] = useState("");
  const [items, setItems] = useState([
    { product: "500ml", quantity: 1, unitPrice: 0 },
  ]);
  const [address, setAddress] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [initialPayment, setInitialPayment] = useState("0");
  const [initialPaymentMethod, setInitialPaymentMethod] = useState("Cash");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const total = items.reduce(
    (s, i) =>
      s +
      Math.max(0, Number(i.quantity) || 0) *
        Math.max(0, Number(i.unitPrice) || 0),
    0,
  );
  const selected = customers.find((c) => c._id === customerId);
  function changeItem(idx, key, value) {
    setItems((old) =>
      old.map((it, i) => (i === idx ? { ...it, [key]: value } : it)),
    );
  }
  return (
    <Modal title="Create new order" onClose={onClose} wide>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          await onSave({
            customerId,
            items: items.map((i) => ({
              ...i,
              quantity: Number(i.quantity),
              unitPrice: Number(i.unitPrice),
            })),
            address,
            deliveryDate: deliveryDate || null,
            initialPayment: Number(initialPayment) || 0,
            initialPaymentMethod,
            notes,
          });
          setSaving(false);
        }}
      >
        <div className="form-grid">
          <Field label="Customer *" wide>
            <select
              required
              value={customerId}
              onChange={(e) => {
                setCustomerId(e.target.value);
                const c = customers.find((x) => x._id === e.target.value);
                setAddress(c?.address || "");
              }}
            >
              <option value="">Choose customer</option>
              {customers.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name} — {c.phone}
                </option>
              ))}
            </select>
            {!customers.length && (
              <small className="form-hint">
                Add a customer before creating an order.
              </small>
            )}
          </Field>
          <Field label="Delivery date">
            <input
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
            />
          </Field>

          <Field label="Order Date">
            <input
              type="date"
              value={new Date().toLocaleDateString("en-CA")}
              onChange={(e) =>
                new Date().toLocaleDateString("en-CA")(e.target.value)
              }
            />
          </Field>
          <Field label="Delivery address">
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Delivery address"
            />
          </Field>
        </div>
        <div className="items-heading">
          <b>Order items</b>
          <button
            type="button"
            className="text-btn"
            onClick={() =>
              setItems((a) => [
                ...a,
                { product: "500ml", quantity: 1, unitPrice: 0 },
              ])
            }
          >
            <Plus size={15} /> Add item
          </button>
        </div>
        {items.map((it, idx) => (
          <div className="item-row" key={idx}>
            <select
              value={it.product}
              onChange={(e) => changeItem(idx, "product", e.target.value)}
            >
              {PRODUCTS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            <input
              aria-label="Quantity"
              type="number"
              min="1"
              step="1"
              required
              value={it.quantity}
              onChange={(e) => changeItem(idx, "quantity", e.target.value)}
              placeholder="Qty"
            />
            <input
              aria-label="Unit price"
              type="number"
              min="0"
              step="0.01"
              required
              value={it.unitPrice}
              onChange={(e) => changeItem(idx, "unitPrice", e.target.value)}
              placeholder="Price ₹"
            />
            <b>
              {money((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0))}
            </b>
            {items.length > 1 && (
              <button
                type="button"
                className="icon-btn"
                onClick={() => setItems((a) => a.filter((_, i) => i !== idx))}
              >
                <X size={16} />
              </button>
            )}
          </div>
        ))}
        <div className="total-strip">
          <span>Order total</span>
          <strong>{money(total)}</strong>
        </div>
        <div className="form-grid">
          <Field label="Payment received now (₹)">
            <input
              type="number"
              min="0"
              step="0.01"
              max={total}
              value={initialPayment}
              onChange={(e) => setInitialPayment(e.target.value)}
            />
          </Field>
          <Field label="Payment method">
            <select
              value={initialPaymentMethod}
              onChange={(e) => setInitialPaymentMethod(e.target.value)}
            >
              {METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="Notes" wide>
            <textarea
              rows="2"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes"
            />
          </Field>
        </div>
        <ModalActions
          onClose={onClose}
          saving={saving}
          disabled={!customers.length || total <= 0}
        />
      </form>
    </Modal>
  );
}
function PaymentModal({ order, onClose, onSave }) {
  const [amount, setAmount] = useState(String(order.due || ""));
  const [method, setMethod] = useState("Cash");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <Modal title="Record payment" onClose={onClose}>
      <p className="modal-context">
        {order.orderNumber} · {order.customer?.name}
      </p>
      <div className="balance-banner">
        <span>Remaining due</span>
        <strong>{money(order.due)}</strong>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          await onSave({ amount: Number(amount), method, reference, note });
          setSaving(false);
        }}
      >
        <Field label="Amount received (₹)">
          <input
            type="number"
            min="0.01"
            step="0.01"
            max={order.due}
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Payment method">
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            {METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </Field>
        <Field label="Reference (optional)">
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="UPI transaction ID"
          />
        </Field>
        <Field label="Note (optional)">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Payment note"
          />
        </Field>
        <ModalActions onClose={onClose} saving={saving} />
      </form>
    </Modal>
  );
}
function LedgerModal({ data, onClose }) {
  return (
    <Modal title="Customer ledger" onClose={onClose} wide>
      <div className="ledger-profile">
        <div className="avatar big">
          {data.customer.name.slice(0, 1).toUpperCase()}
        </div>
        <div>
          <h3>{data.customer.name}</h3>
          <p>
            {data.customer.phone} · {data.customer.address || "No address"}
          </p>
        </div>
        <div className="ledger-balance">
          <small>Current due</small>
          <b>{money(data.balance)}</b>
        </div>
      </div>
      <div className="table-wrap ledger-table">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Reference</th>
              <th>Debit</th>
              <th>Credit</th>
              <th>Balance</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={i}>
                <td>{date(r.date)}</td>
                <td>
                  <span
                    className={`type-pill ${r.type === "Payment" ? "payment-pill" : ""}`}
                  >
                    {r.type}
                  </span>
                </td>
                <td>
                  {r.reference}
                  {r.method && <small className="block">{r.method}</small>}
                </td>
                <td>{r.debit ? money(r.debit) : "—"}</td>
                <td>{r.credit ? money(r.credit) : "—"}</td>
                <td>
                  <b>{money(r.balance)}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data.rows.length && (
        <Empty
          title="No ledger entries"
          detail="Orders and payments will appear here."
        />
      )}
    </Modal>
  );
}
function BackupPage({ onDownload }) {
  return (
    <div className="backup-grid">
      <div className="backup-intro">
        <div className="backup-art">
          <Download size={35} />
        </div>
        <h2>Your records, safely backed up.</h2>
        <p>
          Export your customer and sales data regularly. Store backup files
          somewhere private and secure.
        </p>
      </div>
      <div className="backup-options">
        <button
          onClick={() =>
            onDownload("/export/backup.json", "kajal-h2o-backup.json")
          }
        >
          <div className="export-icon">
            <Download />
          </div>
          <div>
            <b>Full JSON backup</b>
            <small>Customers, orders, payments and delivery records</small>
          </div>
          <span>↓</span>
        </button>
        <button
          onClick={() =>
            onDownload("/export/customers.csv", "kajal-h2o-customers.csv")
          }
        >
          <div className="export-icon green">
            <FileSpreadsheet />
          </div>
          <div>
            <b>Customers CSV</b>
            <small>Open in Excel or Google Sheets</small>
          </div>
          <span>↓</span>
        </button>
        <button
          onClick={() =>
            onDownload("/export/orders.csv", "kajal-h2o-orders.csv")
          }
        >
          <div className="export-icon amber">
            <FileSpreadsheet />
          </div>
          <div>
            <b>Orders CSV</b>
            <small>Order totals, payments, delivery and due</small>
          </div>
          <span>↓</span>
        </button>
        <div className="security-note">
          <AlertCircle size={17} />
          <p>
            Backups contain private customer information. Do not share them
            publicly. Test restoring your records before relying on backups for
            business continuity.
          </p>
        </div>
      </div>
    </div>
  );
}
function Modal({ title, onClose, children, wide = false }) {
  useEffect(() => {
    const f = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section className={`modal ${wide ? "modal-wide" : ""}`}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}
function Field({ label, children, wide = false }) {
  return (
    <label className={`field ${wide ? "field-wide" : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}
function ModalActions({ onClose, saving, disabled = false }) {
  return (
    <div className="modal-actions">
      <button type="button" className="secondary" onClick={onClose}>
        Cancel
      </button>
      <button type="submit" className="primary" disabled={saving || disabled}>
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
function whatsappUrl(c, message) {
  let number = String(c?.whatsappPhone || c?.phone || "").replace(/\D/g, "");
  if (number.length === 10) number = "91" + number;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

function formatDate(date) {
  if (!date) return "";

  const d = new Date(date);

  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();

  return `${day}/${month}/${year}`;
}

function openWhatsApp(order) {
  const c = order.customer || {};
  const msg = `*KAJAL H2O*
🚰 _Pure Water • Safe Water • Home Delivery_

━━━━━━━━━━━━━━━━━━
🌟 *ORDER & PAYMENT RECEIPT*
━━━━━━━━━━━━━━━━━━

👋 Dear *${c.name || "Valued Customer"}*,

🙏 Thank you for choosing *KAJAL H2O*!
We truly appreciate your trust in our service. ❤️

🧾 *ORDER SUMMARY*
━━━━━━━━━━━━━━━━━━
💰 Total Amount : *${money(order.total)}*
✅ Paid Amount  : *${money(order.paid)}*
⏳ Due Amount   : *${money(order.due)}*
━━━━━━━━━━━━━━━━━━

📅 *DELIVERY DETAILS*
🛍️ Order Date    : ${formatDate(order.orderDate)}
🚚 Delivery Date : ${formatDate(order.deliveryDate)}

━━━━━━━━━━━━━━━━━━
💳 *PAYMENT INFORMATION*
━━━━━━━━━━━━━━━━━━

📱 *UPI ID*
${"8509022744@pnb"}

📲 *GPay / PhonePe*
${"8509022744"}

💡 Please verify the payment details before making a transfer.

━━━━━━━━━━━━━━━━━━
🤝 *THANK YOU FOR YOUR TRUST!*
━━━━━━━━━━━━━━━━━━

💧 *KAJAL H2O*
✨ Your Trusted Water Partner
📍 Kharagpur
📞 Contact: 8509022744

💙 *Pure Water • Safe Water • Happy Family*
  `;

  window.open(whatsappUrl(c, msg), "_blank", "noopener,noreferrer");
}
