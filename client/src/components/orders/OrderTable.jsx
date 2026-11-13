import React from "react";
import { MessageCircle, Truck, Wallet } from "lucide-react";
import { Empty } from "../common/Empty.jsx";
import {
  date,
  money,
  reportingDateKey,
} from "../../utils/formatters.js";

export function OrderTable({
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
  const todayKey = reportingDateKey(new Date());
  const sortedOrders = orders
    .map((order, index) => ({
      order,
      index,
      isToday: order.orderDate && reportingDateKey(order.orderDate) === todayKey,
      isPendingTodayDelivery:
        order.deliveryStatus === "Pending" &&
        order.deliveryDate &&
        reportingDateKey(order.deliveryDate) === todayKey,
    }))
    .sort(
      (a, b) =>
        Number(b.isPendingTodayDelivery) - Number(a.isPendingTodayDelivery) ||
        Number(b.isToday) - Number(a.isToday) ||
        a.index - b.index,
    )
    .map(({ order }) => order);
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Order / Customer/ Address</th>
            <th>Order Date</th>
            <th>Delivery Date / Shift</th>
            <th>Items</th>
            <th>Total</th>
            <th>Payments Allocated / Due</th>
            <th>Delivery</th>
            {!compact && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {sortedOrders.map((o) => {
            const address = o.address || o.customer?.address || "No address added";
            const isPendingTodayDelivery =
              o.deliveryStatus === "Pending" &&
              o.deliveryDate &&
              reportingDateKey(o.deliveryDate) === todayKey;
            return (
              <tr
                key={o._id}
                className={isPendingTodayDelivery ? "today-delivery-pending" : ""}
              >
                <td>
                  <b>{o.orderNumber}</b>
                  <small className="block">
                    {o.customer?.name || "Customer"}
                  </small>
                  <small className="block">{address}</small>
                </td>
                <td>{date(o.orderDate)}</td>
                <td>
                  {date(o.deliveryDate)}
                  <small className="block">
                    Shift: {o.deliveryShift || "Day"}
                  </small>
                </td>
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
                    {money(o.allocatedPaid ?? o.paid ?? 0)} Payments Allocated
                  </span>
                  <small className="block due-text">
                    {money(o.due ?? Math.max(0, (o.total || 0) - (o.paid || 0)))}{" "}
                    due
                  </small>
                  <small className="block">
                    Payment status:{" "}
                    {o.paymentStatus || (o.due > 0 ? "Partially Paid" : "Paid")}
                  </small>
                  <small className="block">
                    Previous due: {money(o.previousDue || 0)}
                    {o.previousUnpaidDate && ` · ${date(o.previousUnpaidDate)}`}
                  </small>
                  {o.previousDueAdjustment && (
                    <small className="block">
                      Adjusted previous due: {money(o.adjustedPreviousDue || 0)}
                      {o.previousDueAdjustment.reason &&
                        ` · ${o.previousDueAdjustment.reason}`}
                    </small>
                  )}
                  <small className="block">
                    Total payable: {money(o.totalPayable ?? o.total ?? 0)}
                  </small>
                  {(o.availableAdvanceAtCreation || 0) > 0 && (
                    <small className="block advance-text">
                      Available advance: {money(o.availableAdvanceAtCreation)}
                    </small>
                  )}
                  {(o.advanceApplied || 0) > 0 && (
                    <small className="block advance-text">
                      Advance used: {money(o.advanceApplied)}
                    </small>
                  )}
                  <small className="block due-text">
                    Final outstanding:{" "}
                    {money(o.finalOutstandingDue ?? o.due ?? 0)}
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
                      {o.deliveryStatus !== "Cancelled" &&
                        (o.customerDue ?? o.due) > 0 && (
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
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
