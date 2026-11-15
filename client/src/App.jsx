import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  ClipboardList,
  Wallet,
  Download,
  LogOut,
  Plus,
  Banknote,
  MessageCircle,
  X,
  Check,
  Droplets,
  RefreshCw,
  FileSpreadsheet,
  AlertCircle,
  Edit3,
} from "lucide-react";
import {
  PRODUCTS,
  TYPES,
  METHODS,
  INVALID_MOBILE_MESSAGE,
  isValidIndianMobile,
  normalizeIndianMobile,
  blankCustomer,
} from "./constants.js";
import {
  money,
  makeRequestId,
  localDateInput,
  date,
  dateTime,
  reportingDateKey,
} from "./utils/formatters.js";
import { openWhatsApp, whatsappUrl } from "./utils/whatsapp.js";
import { buildCustomerLedgerWhatsAppMessage } from "./utils/customerLedgerWhatsApp.js";
import {
  buildCustomerDueReminderMessage,
  buildCustomerPaymentWhatsAppMessage,
} from "./utils/customerPaymentWhatsApp.js";
import { customerPaymentHistory, dueCustomers } from "./utils/customerPayments.js";

import { Login } from "./pages/LoginPage.jsx";
import { Dashboard } from "./pages/DashboardPage.jsx";
import { OrderTable } from "./components/orders/OrderTable.jsx";
import { SearchBox } from "./components/common/SearchBox.jsx";
import { Empty } from "./components/common/Empty.jsx";
import { Modal, Field, ModalActions } from "./components/common/Modal.jsx";

const API = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "") + "/api";

function clientRequestId() {
  return globalThis.crypto?.randomUUID?.() ||
    `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function performanceEndpoint(path) {
  const cleanPath = path.split("?")[0];
  if (cleanPath === "/auth/login") return "POST /api/auth/login";
  if (cleanPath === "/dashboard") return "GET /api/dashboard";
  if (/^\/orders\/[^/]+\/delivery$/.test(cleanPath))
    return "PATCH /api/orders/:id/delivery";
  if (/^\/orders\/[^/]+\/payments$/.test(cleanPath))
    return "POST /api/orders/:id/payments";
  if (/^\/customers\/[^/]+\/payments$/.test(cleanPath))
    return "POST /api/customers/:id/payments";
  if (/^\/customers\/[^/]+\/ledger$/.test(cleanPath))
    return "GET /api/customers/:id/ledger";
  return null;
}

function routeFromPath(pathname) {
  const routes = {
    "/": { page: "Dashboard", filter: "" },
    "/dashboard": { page: "Dashboard", filter: "" },
    "/customers": { page: "Customers", filter: "" },
    "/customers/due": { page: "Customers", filter: "due" },
    "/orders": { page: "Orders", filter: "" },
    "/orders/today": { page: "Orders", filter: "today" },
    "/orders/pending": { page: "Orders", filter: "pending" },
    "/collections/today": { page: "Collections", filter: "today-collection" },
    "/ledger": { page: "Ledger", filter: "" },
    "/backup": { page: "Backup", filter: "" },
  };
  return routes[pathname] || routes["/"];
}

function navPath(page) {
  return (
    {
      Dashboard: "/",
      Customers: "/customers",
      Orders: "/orders",
      Ledger: "/ledger",
      Backup: "/backup",
    }[page] || "/"
  );
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const route = routeFromPath(location.pathname);
  const page = route.page;
  const listFilter = route.filter;
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
  const [dashboard, setDashboard] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [exporting, setExporting] = useState("");
  const [customerModal, setCustomerModal] = useState(null);
  const [orderModal, setOrderModal] = useState(false);
  const [paymentOrder, setPaymentOrder] = useState(null);
  const [customerPayment, setCustomerPayment] = useState(null);
  const [paymentReceipt, setPaymentReceipt] = useState(null);
  const [ledgerCustomer, setLedgerCustomer] = useState(null);

  const api = useCallback(
    async (path, options = {}) => {
      const requestId = clientRequestId();
      const endpoint = performanceEndpoint(path);
      const startedAt = performance.now();
      let status = 0;
      const headers = {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
        "X-Request-ID": requestId,
      };
      try {
        const res = await fetch(`${API}${path}`, { ...options, headers });
        status = res.status;
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
        return type.includes("application/json") ? await res.json() : await res.text();
      } finally {
        if (endpoint) {
          console.info(JSON.stringify({
            event: "frontend.api.performance",
            timestamp: new Date().toISOString(),
            requestId,
            endpoint,
            durationMs: Number((performance.now() - startedAt).toFixed(2)),
            status,
          }));
        }
      }
    },
    [token],
  );

  const refresh = useCallback(async () => {
    if (!token) return;
    const requestId = clientRequestId();
    const startedAt = performance.now();
    let status = "success";
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
      status = "error";
      setError(e.message);
    } finally {
      console.info(JSON.stringify({
        event: "frontend.dashboard_load.performance",
        timestamp: new Date().toISOString(),
        requestId,
        endpoint: "dashboard-load",
        durationMs: Number((performance.now() - startedAt).toFixed(2)),
        status,
      }));
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
    navigate("/", { replace: true });
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
      return true;
    } catch (e) {
      return e.message || "Could not save customer. Please try again.";
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
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  }
  const loadCustomerAccount = useCallback(
    (customerId) => {
      return api(`/customers/${customerId}/account-summary`);
    },
    [api],
  );
  async function addPayment(id, data) {
    try {
      await api(`/orders/${id}/payments`, {
        method: "POST",
        body: JSON.stringify({
          ...data,
          idempotencyKey: data.idempotencyKey || makeRequestId(),
        }),
      });
      setPaymentOrder(null);
      setToast("Payment recorded.");
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }
  async function openCustomerPayment(c) {
    try {
      const ledger = await api(`/customers/${c._id}/ledger`);
      if (!(ledger.due > 0)) {
        setError("This customer has no outstanding balance.");
        await refresh();
        return;
      }
      setCustomerPayment({ customer: c, ledger });
    } catch (e) {
      setError(e.message);
    }
  }
  async function addCustomerPayment(customerId, data) {
    try {
      const result = await api(`/customers/${customerId}/payments`, {
        method: "POST",
        body: JSON.stringify({ ...data, idempotencyKey: data.idempotencyKey || makeRequestId() }),
      });
      setCustomerPayment(null);
      setToast("Payment recorded.");
      await refresh();
      setPaymentReceipt(result);
      return true;
    } catch (e) {
      setError(e.message);
      return false;
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
  function openCustomerLedgerWhatsApp(c) {
    const phone = String(c?.whatsappPhone || c?.phone || "").replace(/\D/g, "");
    if (!(phone.length === 10 || (phone.length >= 11 && phone.length <= 15))) {
      setError("This customer does not have a valid WhatsApp number. Update the customer details and try again.");
      return;
    }
    const popup = window.open("about:blank", "_blank");
    if (!popup) {
      setError("The WhatsApp window was blocked. Allow pop-ups for this site and try again.");
      return;
    }
    setError("");
    (async () => {
      try {
        const ledger = await api(`/customers/${c._id}/ledger`);
        const message = buildCustomerLedgerWhatsAppMessage(ledger);
        if (encodeURIComponent(message).length > 60000) {
          popup.close();
          setError("This ledger is too large to fit safely in a WhatsApp link. Download the full ledger statement instead.");
          return;
        }
        popup.location.href = whatsappUrl(ledger.customer || c, message);
      } catch (e) {
        popup.close();
        setError(e.message || "Could not load this customer’s ledger statement.");
      }
    })();
  }
  function openCustomerDueReminder(c) {
    const phone = String(c?.whatsappPhone || c?.phone || "").replace(/\D/g, "");
    if (!(phone.length === 10 || (phone.length >= 11 && phone.length <= 15))) {
      setError("This customer does not have a valid WhatsApp number. Update the customer details and try again.");
      return;
    }
    const popup = window.open("about:blank", "_blank");
    if (!popup) {
      setError("The WhatsApp window was blocked. Allow pop-ups for this site and try again.");
      return;
    }
    setError("");
    (async () => {
      try {
        const ledger = await api(`/customers/${c._id}/ledger`);
        if (!(ledger.due > 0)) {
          popup.close();
          setError("This customer has no outstanding balance.");
          await refresh();
          return;
        }
        const customer = ledger.customer || c;
        const message = buildCustomerDueReminderMessage({ customer, due: ledger.due });
        popup.location.href = whatsappUrl(customer, message);
      } catch (e) {
        popup.close();
        setError(e.message || "Could not load this customer’s due balance.");
      }
    })();
  }
  async function downloadExport(path, filename) {
    if (exporting)
      return { ok: false, message: "An export is already in progress." };
    setExporting(filename);
    setError("");
    try {
      const res = await api(path, { raw: true });
      const blob = await res.blob();
      const file =
        typeof File === "function"
          ? new File([blob], filename, {
              type: blob.type || "text/csv;charset=utf-8",
            })
          : null;
      let canShareFile = false;
      try {
        canShareFile = Boolean(
          file &&
          typeof navigator.share === "function" &&
          typeof navigator.canShare === "function" &&
          navigator.canShare({ files: [file] }),
        );
      } catch {
        canShareFile = false;
      }
      if (canShareFile && typeof navigator.share === "function") {
        try {
          await navigator.share({ files: [file], title: filename });
          setToast(
            "Export ready. Save it to Files or share it from the iPhone sheet.",
          );
          return {
            ok: true,
            message: "Export ready in the iPhone share sheet.",
          };
        } catch (shareError) {
          if (shareError.name === "AbortError")
            return {
              ok: false,
              message: "Sharing was cancelled. You can try the export again.",
            };
          if (shareError.name !== "NotAllowedError") throw shareError;
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
      setToast("Export downloaded.");
      return { ok: true, message: "Export downloaded." };
    } catch (e) {
      setError(e.message);
      return { ok: false, message: e.message || "Export failed." };
    } finally {
      setExporting("");
    }
  }

  const filteredCustomers = useMemo(
    () => {
      const eligible = listFilter === "due" ? dueCustomers(customers) : customers;
      return eligible.filter((c) => {
        return `${c.name} ${c.phone} ${c.address}`
          .toLowerCase()
          .includes(search.toLowerCase());
      });
    },
    [customers, search, listFilter],
  );
  const todayKey = reportingDateKey(new Date());
  const filteredOrders = useMemo(
    () =>
      orders.filter((o) => {
        if (
          listFilter === "today" &&
          reportingDateKey(o.orderDate) !== todayKey
        )
          return false;
        if (listFilter === "pending" && o.deliveryStatus !== "Pending")
          return false;
        if (listFilter === "today" && o.deliveryStatus === "Cancelled")
          return false;
        return `${o.orderNumber} ${o.customer?.name || ""} ${o.customer?.phone || ""} ${o.customer?.address || ""} ${o.address || ""}`
          .toLowerCase()
          .includes(search.toLowerCase());
      }),
    [orders, search, listFilter, todayKey],
  );
  const todayPayments = useMemo(
    () =>
      orders
        .flatMap((o) =>
          (o.payments || [])
            .filter((p) => reportingDateKey(p.paidAt) === todayKey)
            .map((p) => ({
              ...p,
              customerName: o.customer?.name || "Customer",
              reference: o.orderNumber,
            })),
        )
        .sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt)),
    [orders, todayKey],
  );

  if (!token) return <Login onLogin={login} busy={busy} error={error} />;

  const nav = [
    { name: "Dashboard", icon: LayoutDashboard },
    { name: "Customers", icon: Users },
    { name: "Orders", icon: ClipboardList },
    { name: "Ledger", icon: Wallet },
    { name: "Backup", icon: Download },
  ];
  const goTo = (path) => {
    setSearch("");
    navigate(path);
  };
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
                goTo(navPath(n.name));
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
            onOrders={() => goTo("/orders")}
            onCustomers={() => goTo("/customers")}
            onTodayCollection={() => goTo("/collections/today")}
            onDue={() => goTo("/customers/due")}
            onTodayOrders={() => goTo("/orders/today")}
            onPendingDeliveries={() => goTo("/orders/pending")}
          />
        )}
        {page === "Customers" && (
          <section className="panel">
            <div className="section-head">
              <div>
                <h2>{listFilter === "due" ? "Due Customers" : "Customers"}</h2>
                <p>
                  {listFilter === "due"
                    ? "Customers with outstanding positive balances."
                    : "Manage your shops, hotels, homes and offices."}
                </p>
              </div>
              <div className="action-row">
                <button
                  className="secondary"
                  onClick={() => goTo(listFilter === "due" ? "/customers" : "/customers/due")}
                >
                  {listFilter === "due" ? "All customers" : "Due customers"}
                </button>
                {listFilter !== "due" && (
                  <button
                    className="primary"
                    onClick={() => setCustomerModal(blankCustomer)}
                  >
                    <Plus size={17} /> Add customer
                  </button>
                )}
              </div>
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
              showManagement={listFilter !== "due"}
              onPayment={listFilter === "due" ? openCustomerPayment : undefined}
              onWhatsApp={listFilter === "due" ? openCustomerDueReminder : undefined}
              emptyTitle={listFilter === "due" ? "No matching due customers" : undefined}
              emptyDetail={listFilter === "due" ? "No customers have an outstanding balance." : undefined}
            />
          </section>
        )}
        {page === "Orders" && (
          <section className="panel">
            <div className="section-head">
              <div>
                <h2>
                  {listFilter === "today"
                    ? "Today’s Orders"
                    : listFilter === "pending"
                      ? "Pending Delivery"
                      : "Orders & delivery"}
                </h2>
                <p>
                  {listFilter === "today"
                    ? "Orders created today."
                    : listFilter === "pending"
                      ? "Orders awaiting delivery."
                      : "Order totals, payments, balances and delivery status."}
                </p>
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
        {page === "Collections" && (
          <section className="panel">
            <div className="section-head">
              <div>
                <h2>Today Collection</h2>
                <p>Payments received today from existing order records.</p>
              </div>
            </div>
            <CollectionTable payments={todayPayments} />
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
              onLedgerWhatsApp={openCustomerLedgerWhatsApp}
            />
          </section>
        )}
        {page === "Backup" && (
          <BackupPage
            onDownload={downloadExport}
            customers={customers}
            exporting={exporting}
          />
        )}
      </main>
      <nav className="mobile-nav">
        {nav.map((n) => (
          <button
            key={n.name}
            className={page === n.name ? "active" : ""}
            onClick={() => {
              goTo(navPath(n.name));
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
          onLoadAccount={loadCustomerAccount}
        />
      )}
      {paymentOrder && (
        <PaymentModal
          order={paymentOrder}
          onClose={() => setPaymentOrder(null)}
          onSave={(data) => addPayment(paymentOrder._id, data)}
        />
      )}
      {customerPayment && (
        <CustomerPaymentModal
          customer={customerPayment.customer}
          ledger={customerPayment.ledger}
          onClose={() => setCustomerPayment(null)}
          onSave={(data) => addCustomerPayment(customerPayment.customer._id, data)}
        />
      )}
      {paymentReceipt && (
        <CustomerPaymentReceiptModal
          receipt={paymentReceipt}
          onClose={() => setPaymentReceipt(null)}
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



function CollectionTable({ payments }) {
  if (!payments.length)
    return (
      <Empty
        title="No payments today"
        detail="Payments received today will appear here."
      />
    );
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Customer</th>
            <th>Date / time</th>
            <th>Amount</th>
            <th>Method</th>
            <th>Order / reference</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((payment) => (
            <tr key={`${payment._id}-${payment.reference}`}>
              <td>{payment.customerName}</td>
              <td>{new Date(payment.paidAt).toLocaleString("en-IN")}</td>
              <td>
                <b>{money(payment.amount)}</b>
              </td>
              <td>{payment.method}</td>
              <td>{payment.reference}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CustomerTable({ customers, onEdit, onArchive, onLedger, onLedgerWhatsApp, onWhatsApp, onPayment, showManagement = true, emptyTitle, emptyDetail }) {
  if (!customers.length)
    return (
      <Empty
        title={emptyTitle || "No customers found"}
        detail={emptyDetail || "Add your first customer to start keeping records."}
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
                {(c.availableAdvance || 0) > 0 && (
                  <small className="block advance-text">
                    Advance: {money(c.availableAdvance)}
                  </small>
                )}
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
                  {showManagement && (
                    <button
                      className="small-btn"
                      title="Edit"
                      onClick={() => onEdit(c)}
                    >
                      <Edit3 size={15} />
                    </button>
                  )}
                  {onPayment && c.balance > 0 && (
                    <button
                      className="small-btn"
                      title={`Add payment for ${c.name}`}
                      aria-label={`Add payment for ${c.name}`}
                      onClick={() => onPayment(c)}
                    >
                      <Banknote size={15} />
                    </button>
                  )}

                  {onWhatsApp ? (
                    <button
                      className="small-btn wa"
                      title="Send current due reminder on WhatsApp"
                      aria-label={`Send current due reminder to ${c.name}`}
                      onClick={() => onWhatsApp(c)}
                    >
                      <MessageCircle size={15} />
                    </button>
                  ) : onLedgerWhatsApp ? (
                    <button
                      className="small-btn wa"
                      title="Send ledger statement on WhatsApp"
                      aria-label={`Send ${c.name}'s ledger statement on WhatsApp`}
                      onClick={() => onLedgerWhatsApp(c)}
                    >
                      <MessageCircle size={15} />
                    </button>
                  ) : <a
                    className="small-btn wa"
                    title="WhatsApp"
                    href={whatsappUrl(
                      c,
                      `*Hello Dear ${c.name}!* 
*KAJAL H2O | WATER DISTRIBUTOR*

Need Water Bottels? 

Place your order by sharing:

📦 *Quantity:* 
🕒 *Delivery Location:* 
🕒 *Preferred Delivery Time:* 

*Order Now: 8509022744*

*Thank You!*
*Team KAJAL H2O *
*Your Trusted Water Distributor*`,
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <MessageCircle size={15} />
                  </a>}

                  {showManagement && (
                    <button
                      className="small-btn danger-btn"
                      title="Archive customer"
                      onClick={() => onArchive(c)}
                    >
                      <X size={15} />
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


function CustomerModal({ initial, onClose, onSave }) {
  const [form, setForm] = useState({ ...blankCustomer, ...initial });
  const [saving, setSaving] = useState(false);
  const [phoneError, setPhoneError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [whatsappEdited, setWhatsappEdited] = useState(
    Boolean(initial?._id || initial?.whatsappPhone),
  );
  function set(k, v) {
    setForm((f) => ({
      ...f,
      [k]: v,
      ...(k === "phone" && !whatsappEdited ? { whatsappPhone: v } : {}),
    }));
    if (k === "whatsappPhone") setWhatsappEdited(true);
    if (k === "phone" && isValidIndianMobile(normalizeIndianMobile(v))) setPhoneError("");
  }

  return (
    <Modal
      title={form._id ? "Edit customer" : "Add customer"}
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const phone = normalizeIndianMobile(form.phone);
          if (phone && !isValidIndianMobile(phone)) {
            setPhoneError(INVALID_MOBILE_MESSAGE);
            return;
          }
          setSaving(true);
          const result = await onSave({ ...form, phone });
          if (result !== true) setSaveError(result || "Could not save customer.");
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
          <Field label="Phone number">
            <input
              inputMode="tel"
              maxLength={20}
              value={form.phone || ""}
              onChange={(e) => { set("phone", e.target.value); setSaveError(""); }}
              placeholder="Optional, 10-digit Indian mobile"
            />
            {phoneError && <small className="form-error">{phoneError}</small>}
            {saveError && <small className="form-error">{saveError}</small>}
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
function OrderModal({ customers, onClose, onSave, onLoadAccount }) {
  const [customerId, setCustomerId] = useState("");
  const [items, setItems] = useState([
    { product: "500ml", quantity: 1, unitPrice: 0 },
  ]);
  const [address, setAddress] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [deliveryShift, setDeliveryShift] = useState("Day");
  const [orderDate, setOrderDate] = useState(localDateInput(new Date()));
  const [initialPayment, setInitialPayment] = useState("0");
  const [initialPaymentMethod, setInitialPaymentMethod] = useState("Cash");
  const [account, setAccount] = useState(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [previousDue, setPreviousDue] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [advanceToApply, setAdvanceToApply] = useState("0");
  const [requestId] = useState(makeRequestId);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const total = items.reduce(
    (s, i) =>
      s +
      Math.max(0, Number(i.quantity) || 0) *
        Math.max(0, Number(i.unitPrice) || 0),
    0,
  );
  const systemPreviousDue = Number(account?.previousDue || 0);
  const adjustedPreviousDue = Math.max(0, Number(previousDue) || 0);
  const changedPreviousDue =
    Math.round(adjustedPreviousDue * 100) !==
    Math.round(systemPreviousDue * 100);
  const advanceAmount = Math.max(0, Number(advanceToApply) || 0);
  const totalPayable = adjustedPreviousDue + total;
  const maxAdvance = Math.min(
    100000000,
    Number(account?.availableAdvance || 0),
    totalPayable,
  );
  const maxPayment = Math.min(
    100000000,
    Math.max(0, totalPayable - advanceAmount),
  );
  const finalOutstandingDue = Math.max(
    0,
    totalPayable - advanceAmount - (Number(initialPayment) || 0),
  );
  useEffect(() => {
    if (!customerId) {
      setAccount(null);
      setPreviousDue("");
      setAdvanceToApply("0");
      setAccountLoading(false);
      return;
    }
    let current = true;
    setAccountLoading(true);
    setAccount(null);
    onLoadAccount(customerId)
      .then((summary) => {
        if (!current) return;
        setAccount(summary);
        setPreviousDue(String(summary.previousDue || 0));
        setAdvanceToApply("0");
      })
      .catch(() => {
        if (current) setAccount(null);
      })
      .finally(() => {
        if (current) setAccountLoading(false);
      });
    return () => {
      current = false;
    };
  }, [customerId, onLoadAccount]);
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
          if (!account || accountLoading) return;
          if (changedPreviousDue && !adjustmentReason.trim()) return;
          setSaving(true);
          const saved = await onSave({
            requestId,
            customerId,
            items: items.map((i) => ({
              ...i,
              quantity: Number(i.quantity),
              unitPrice: Number(i.unitPrice),
            })),
            address,
            orderDate,
            deliveryDate: deliveryDate || null,
            deliveryShift,
            initialPayment: Number(initialPayment) || 0,
            initialPaymentMethod,
            expectedPreviousDue: systemPreviousDue,
            previousDueAmount: adjustedPreviousDue,
            adjustmentReason: changedPreviousDue ? adjustmentReason.trim() : "",
            advanceToApply: advanceAmount,
            notes,
          });
          if (!saved && customerId) {
            try {
              const latest = await onLoadAccount(customerId);
              setAccount(latest);
              setPreviousDue(String(latest.previousDue || 0));
              setAdvanceToApply("0");
              setAdjustmentReason("");
            } catch {
              setAccount(null);
            }
          }
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
                setInitialPayment("0");
                setAdjustmentReason("");
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
          <Field label="Delivery shift">
            <select
              value={deliveryShift}
              onChange={(e) => setDeliveryShift(e.target.value)}
            >
              <option value="Day">Day</option>
              <option value="Night">Night</option>
            </select>
          </Field>

          <Field label="Order Date">
            <input
              type="date"
              required
              value={orderDate}
              onChange={(e) => setOrderDate(e.target.value)}
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
        {customerId && (
          <section className="account-summary" aria-live="polite">
            <div className="account-summary-head">
              <div>
                <b>Customer account</b>
                <small>
                  {accountLoading
                    ? "Fetching latest balance…"
                    : account?.previousUnpaidDate
                      ? `Oldest unpaid transaction: ${date(account.previousUnpaidDate)}`
                      : "No previous unpaid transaction"}
                </small>
              </div>
              <div className="account-system-due">
                <small>System-calculated Previous Due</small>
                <b>{account ? money(systemPreviousDue) : "—"}</b>
              </div>
            </div>
            {account ? (
              <div className="form-grid">
                <Field label="Previous Due (editable)">
                  <input
                    type="number"
                    min="0"
                    max="100000000"
                    step="0.01"
                    required
                    value={previousDue}
                    onChange={(e) => setPreviousDue(e.target.value)}
                  />
                </Field>
                <Field label="Available Advance">
                  <div className="advance-control">
                    <span>{money(account.availableAdvance || 0)}</span>
                    <input
                      aria-label="Advance to use"
                      type="number"
                      min="0"
                      max={maxAdvance}
                      step="0.01"
                      value={advanceToApply}
                      onChange={(e) => setAdvanceToApply(e.target.value)}
                    />
                  </div>
                </Field>
                {changedPreviousDue && (
                  <Field label="Reason for Previous Due adjustment" wide>
                    <input
                      required
                      maxLength={500}
                      value={adjustmentReason}
                      onChange={(e) => setAdjustmentReason(e.target.value)}
                      placeholder="Old bill correction, Previous payment correction, Manual balance correction"
                    />
                    <small className="form-hint">
                      Separate ledger adjustment: {money(systemPreviousDue)} →{" "}
                      {money(adjustedPreviousDue)}
                    </small>
                  </Field>
                )}
              </div>
            ) : (
              <p className="form-hint">
                {accountLoading
                  ? "Please wait while the customer ledger is fetched."
                  : "Could not load this customer’s ledger. Change the customer or try again."}
              </p>
            )}
          </section>
        )}
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
              max="100000"
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
              max="1000000"
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
        {account && (
          <div className="account-totals" aria-live="polite">
            <div>
              <span>Previous Due</span>
              <b>{money(adjustedPreviousDue)}</b>
            </div>
            <div>
              <span>Current Order Amount</span>
              <b>{money(total)}</b>
            </div>
            <div className="account-total-payable">
              <span>Total Payable</span>
              <b>{money(totalPayable)}</b>
            </div>
            <div>
              <span>Available Advance</span>
              <b>{money(account.availableAdvance || 0)}</b>
            </div>
            <div>
              <span>Advance applied</span>
              <b>{money(advanceAmount)}</b>
            </div>
            <div>
              <span>Payment Received</span>
              <b>{money(Number(initialPayment) || 0)}</b>
            </div>
            <div className="account-final-due">
              <span>Final Outstanding Due</span>
              <b>{money(finalOutstandingDue)}</b>
            </div>
          </div>
        )}
        <div className="form-grid">
          <Field label="Payment received now (₹)">
            <input
              type="number"
              min="0"
              step="0.01"
              max={maxPayment}
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
          disabled={
            !customers.length ||
            !account ||
            accountLoading ||
            total <= 0 ||
            advanceAmount > maxAdvance ||
            (changedPreviousDue && !adjustmentReason.trim()) ||
            Number(initialPayment) > maxPayment
          }
        />
      </form>
    </Modal>
  );
}
function CustomerPaymentModal({ customer, ledger, onClose, onSave }) {
  const [amount, setAmount] = useState(String(ledger.due || ""));
  const [idempotencyKey] = useState(makeRequestId);
  const [method, setMethod] = useState("Cash");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const history = customerPaymentHistory(ledger.rows);
  return (
    <Modal title={`Add payment · ${customer.name}`} onClose={onClose} wide>
      <div className="balance-banner">
        <span>Current outstanding due</span>
        <strong>{money(ledger.due)}</strong>
      </div>
      <h3>Previous payments</h3>
      {history.length ? (
        <div className="table-wrap ledger-table">
          <table>
            <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th></tr></thead>
            <tbody>
              {history.map((row, i) => (
                <tr key={`${row.date}-${row.reference}-${i}`}>
                  <td>{dateTime(row.date)}</td>
                  <td>{money(row.credit)}</td>
                  <td>{row.method || "—"}</td>
                  <td>{row.paymentReference || row.reference || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="form-hint">No previous payments recorded.</p>}
      <form onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        const saved = await onSave({ amount: Number(amount), method, reference, note, idempotencyKey });
        if (!saved) setSaving(false);
      }}>
        <Field label="Amount received (₹)">
          <input type="number" min="0.01" step="0.01" max={ledger.due} required value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <p className="form-hint">Payment will be applied to the oldest outstanding orders first.</p>
        <Field label="Payment method">
          <select value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select>
        </Field>
        <Field label="Reference (optional)">
          <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UPI transaction ID" />
        </Field>
        <Field label="Note (optional)">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Payment note" />
        </Field>
        <ModalActions onClose={onClose} saving={saving} />
      </form>
    </Modal>
  );
}

function CustomerPaymentReceiptModal({ receipt, onClose }) {
  const [message, setMessage] = useState(() => buildCustomerPaymentWhatsAppMessage(receipt));
  const phone = String(receipt.customer?.whatsappPhone || receipt.customer?.phone || "").replace(/\D/g, "");
  const canWhatsApp = phone.length >= 10 && phone.length <= 15;
  return (
    <Modal title="Payment recorded" onClose={onClose}>
      <div className="balance-banner">
        <span>Due before payment</span><strong>{money(receipt.previousDue)}</strong>
      </div>
      <p>Received <b>{money(receipt.amount)}</b> · Remaining due <b>{money(receipt.currentDue)}</b></p>
      <Field label="WhatsApp message (editable)">
        <textarea rows="6" value={message} onChange={(e) => setMessage(e.target.value)} />
      </Field>
      {!canWhatsApp && <p className="form-error">Add a valid WhatsApp number to this customer before sending.</p>}
      <div className="modal-actions">
        <button type="button" className="secondary" onClick={onClose}>Close</button>
      </div>
      <button
        className="primary payment-whatsapp-button"
        disabled={!canWhatsApp}
        onClick={() => window.open(whatsappUrl(receipt.customer, message), "_blank", "noopener,noreferrer")}
      >
        <MessageCircle size={17} /> Open WhatsApp
      </button>
    </Modal>
  );
}

function PaymentModal({ order, onClose, onSave }) {
  const customerDue = Number(order.customerDue ?? order.due ?? 0);
  const [amount, setAmount] = useState(String(customerDue || ""));
  const [idempotencyKey] = useState(makeRequestId);
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
        <span>Customer total outstanding</span>
        <strong>{money(customerDue)}</strong>
      </div>
      <p className="form-hint">
        Selected order remaining due: {money(order.due)}. This payment will be
        allocated to the oldest outstanding orders first.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          await onSave({
            amount: Number(amount),
            method,
            reference,
            note,
            idempotencyKey,
          });
          setSaving(false);
        }}
      >
        <Field label="Amount received (₹)">
          <input
            type="number"
            min="0.01"
            step="0.01"
            max={customerDue}
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <p className="form-hint">
          Maximum payment is the customer total outstanding balance. FIFO
          allocation applies it across orders as needed.
        </p>
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
          <b>{money(data.due ?? data.balance)}</b>
          <small className="advance-text">Available advance</small>
          <b className="advance-text">{money(data.availableAdvance || 0)}</b>
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
                <td>{dateTime(r.date)}</td>
                <td>
                  <span
                    className={`type-pill ${r.type === "Payment" ? "payment-pill" : r.type.includes("Adjustment") ? "adjustment-pill" : ""}`}
                  >
                    {r.type}
                  </span>
                  {r.businessOrderDate && (
                    <small className="block">
                      Business order date: {date(r.businessOrderDate)}
                    </small>
                  )}
                  {r.reason && <small className="block">{r.reason}</small>}
                  {r.owner?.name && (
                    <small className="block">By {r.owner.name}</small>
                  )}
                </td>
                <td>
                  {r.reference}
                  {r.method && <small className="block">{r.method}</small>}
                  {r.paymentReference && (
                    <small className="block">
                      Payment reference: {r.paymentReference}
                    </small>
                  )}
                  {r.appliedToPreviousDue > 0 && (
                    <small className="block">
                      Applied to previous due: {money(r.appliedToPreviousDue)}
                    </small>
                  )}
                  {r.allocations?.map((allocation, allocationIndex) => (
                    <small
                      className="block"
                      key={`${r.reference}-${allocationIndex}`}
                    >
                      {allocation.allocationType === "reconstructed-legacy"
                        ? "Reconstructed legacy allocation"
                        : "Recorded allocation"}
                      : {money(allocation.amount)} to{" "}
                      {allocation.targetReference}
                    </small>
                  ))}
                  {r.amount > 0 && r.type.startsWith("Payment Allocation") && (
                    <small className="block">
                      {money(r.amount)}{" "}
                      {r.type === "Payment Allocation Reversal"
                        ? "reversed from"
                        : "reallocated to"}{" "}
                      {r.targetReference}
                    </small>
                  )}
                  {r.amount > 0 && r.type === "Advance Application" && (
                    <small className="block">
                      Applied advance: {money(r.amount)}
                    </small>
                  )}
                  {r.sourceReference && (
                    <small className="block">Source: {r.sourceReference}</small>
                  )}
                  {r.targetReference &&
                    !r.type.startsWith("Payment Allocation") && (
                      <small className="block">
                        Applied to: {r.targetReference}
                      </small>
                    )}
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
function BackupPage({ onDownload, customers, exporting }) {
  const [customerId, setCustomerId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [feedback, setFeedback] = useState(null);
  useEffect(() => {
    if (!customerId && customers.length) setCustomerId(customers[0]._id);
  }, [customerId, customers]);

  const selectedCustomer = customers.find(
    (customer) => customer._id === customerId,
  );
  const periodLabel =
    fromDate || toDate
      ? `${fromDate || "Beginning"} → ${toDate || "Latest"}`
      : "All transactions";
  const exportParams = new URLSearchParams();
  if (fromDate) exportParams.set("from", fromDate);
  if (toDate) exportParams.set("to", toDate);
  const query = exportParams.toString();

  async function runCsvExport(kind) {
    if (!customerId) {
      setFeedback({ ok: false, message: "Select a customer first." });
      return;
    }
    setFeedback(null);
    const suffix = `${fromDate || "all"}-to-${toDate || "latest"}`;
    const path =
      kind === "ledger"
        ? `/export/customers/${customerId}/ledger.csv${query ? `?${query}` : ""}`
        : `/export/customers/${customerId}/payment-details.csv${query ? `?${query}` : ""}`;
    const filename =
      kind === "ledger"
        ? `kajal-${selectedCustomer?.name || "customer"}-ledger-${suffix}.csv`
        : `kajal-${selectedCustomer?.name || "customer"}-payment-details-${suffix}.csv`;
    const result = await onDownload(
      path,
      filename.replace(/[^a-zA-Z0-9._-]+/g, "-"),
    );
    setFeedback(
      result?.ok
        ? { ok: true, message: result.message }
        : { ok: false, message: result?.message || "Export failed." },
    );
  }

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
        <section className="export-filter-card" aria-label="CSV export options">
          <div>
            <h3>CSV export details</h3>
            <p>
              Choose a customer and optional date range. Dates use India
              Standard Time.
            </p>
          </div>
          <div className="export-filter-grid">
            <Field label="Customer">
              <select
                value={customerId}
                onChange={(event) => setCustomerId(event.target.value)}
              >
                <option value="">Select customer</option>
                {customers.map((customer) => (
                  <option key={customer._id} value={customer._id}>
                    {customer.name} · {customer.phone}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="From date">
              <input
                type="date"
                value={fromDate}
                max={toDate || undefined}
                onChange={(event) => setFromDate(event.target.value)}
              />
            </Field>
            <Field label="To date">
              <input
                type="date"
                value={toDate}
                min={fromDate || undefined}
                onChange={(event) => setToDate(event.target.value)}
              />
            </Field>
          </div>
          <div className="export-selection-summary">
            <span>
              <b>Customer:</b> {selectedCustomer?.name || "Select a customer"}
            </span>
            <span>
              <b>Period:</b> {periodLabel}
            </span>
            {selectedCustomer && (
              <span>
                <b>Current:</b> Due {money(selectedCustomer.balance)} · Advance{" "}
                {money(selectedCustomer.availableAdvance)}
              </span>
            )}
          </div>
        </section>

        <button
          className="csv-export-action"
          disabled={!customerId || Boolean(exporting)}
          onClick={() => runCsvExport("ledger")}
        >
          <div className="export-icon green">
            <FileSpreadsheet />
          </div>
          <div>
            <b>Customer Ledger CSV</b>
            <small>
              Readable statement with period opening, closing, debit, credit and
              running balance
            </small>
          </div>
          <span>
            {exporting?.includes("ledger") ? "Preparing…" : "Download"}
          </span>
        </button>
        <button
          className="csv-export-action"
          disabled={!customerId || Boolean(exporting)}
          onClick={() => runCsvExport("payments")}
        >
          <div className="export-icon amber">
            <FileSpreadsheet />
          </div>
          <div>
            <b>Payment Details CSV · Internal</b>
            <small>
              Payment IDs, FIFO allocations, idempotency references and
              adjustment/cancellation audit
            </small>
          </div>
          <span>
            {exporting?.includes("payment-details") ? "Preparing…" : "Download"}
          </span>
        </button>
        {exporting && (
          <div className="export-progress" role="status" aria-live="polite">
            <span className="export-spinner" /> Preparing {exporting}…
          </div>
        )}
        {feedback && (
          <div
            className={`export-feedback ${feedback.ok ? "success" : "failure"}`}
            role="status"
            aria-live="polite"
          >
            {feedback.message}
          </div>
        )}
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
