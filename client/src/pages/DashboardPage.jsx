import React from "react";
import { AlertCircle, ClipboardList, Droplets, Plus, Truck, Users, Wallet } from "lucide-react";
import { money } from "../utils/formatters.js";
import { OrderTable } from "../components/orders/OrderTable.jsx";

export function Dashboard({
  data,
  orders,
  onNew,
  onOrders,
  onCustomers,
  onTodayCollection,
  onDue,
  onTodayOrders,
  onPendingDeliveries,
}) {
  const stats = [
    {
      label: "Today's sales",
      value: money(data?.todaySales),
      icon: ClipboardList,
      tone: "blue",
    },
    {
      label: "Monthly sales",
      value: money(data?.monthlySales),
      icon: ClipboardList,
      tone: "purple",
    },
    {
      label: "Today collection",
      value: money(data?.todayCollected),
      icon: Wallet,
      tone: "green",
      onClick: onTodayCollection,
    },
    {
      label: "Total collection",
      value: money(data?.totalCollection),
      icon: Wallet,
      tone: "teal",
    },
    {
      label: "Total customer due",
      value: money(data?.totalDue),
      icon: AlertCircle,
      tone: "orange",
      onClick: onDue,
    },
    {
      label: "Today's orders",
      value: data?.todayOrders ?? 0,
      icon: ClipboardList,
      tone: "blue",
      onClick: onTodayOrders,
    },
    {
      label: "Pending deliveries",
      value: data?.pendingDeliveries ?? 0,
      icon: Truck,
      tone: "purple",
      onClick: onPendingDeliveries,
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
          <button className="stat-card" key={s.label} onClick={s.onClick}>
            <div className={`stat-icon ${s.tone}`}>
              <s.icon size={20} />
            </div>
            <span>{s.label}</span>
            <strong>{s.value}</strong>
          </button>
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
