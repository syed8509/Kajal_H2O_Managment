import {
  calculateFifoAccounting,
  customerLedgerRows,
  customerLedgerTotals,
  orderTotal,
  transactionTimestamp,
} from "./business.js";

const timezoneOffsetMinutes = 330;
const indiaDateLabel = (timestamp) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date(timestamp));
const indiaTimestamp = (value) => value instanceof Date && Number.isFinite(value.getTime())
  ? new Date(value.getTime() + timezoneOffsetMinutes * 60_000).toISOString().replace("Z", "+05:30")
  : "";

function exportError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export function parseIndiaDateRange(from, to) {
  const parseDay = (value, field) => {
    if (!value) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
    if (!match) throw exportError(`Enter a valid ${field} date.`, 400);
    const [year, month, day] = match.slice(1).map(Number);
    const utcDay = Date.UTC(year, month - 1, day);
    const check = new Date(utcDay);
    if (
      check.getUTCFullYear() !== year ||
      check.getUTCMonth() + 1 !== month ||
      check.getUTCDate() !== day
    ) {
      throw exportError(`Enter a valid ${field} date.`, 400);
    }
    return utcDay - timezoneOffsetMinutes * 60_000;
  };

  const start = parseDay(from, "start");
  const endDay = parseDay(to, "end");
  const endExclusive = endDay === null ? null : endDay + 24 * 60 * 60_000;
  if (start !== null && endExclusive !== null && start >= endExclusive)
    throw exportError("The start date must be on or before the end date.", 400);
  return { start, endExclusive };
}

function transactionInRange(date, { start, endExclusive }) {
  if (!start && !endExclusive) return true;
  const timestamp = date instanceof Date ? date.getTime() : new Date(date).getTime();
  if (!Number.isFinite(timestamp)) return false;
  return (start === null || timestamp >= start) &&
    (endExclusive === null || timestamp < endExclusive);
}

function cents(value) {
  return Math.round(Number(value || 0) * 100);
}

function ensureTimestampedForRange(rows, range) {
  if ((range.start !== null || range.endExclusive !== null) && rows.some((row) => !row.date)) {
    throw exportError(
      "This customer has transactions without reliable timestamps. Export all transactions to preserve the complete history.",
      422,
    );
  }
}

export function buildCustomerLedgerExport(orders, customer, range = { start: null, endExclusive: null }) {
  const allRows = customerLedgerRows(orders);
  const totals = customerLedgerTotals(orders);
  ensureTimestampedForRange(allRows, range);

  const included = allRows.filter((row) => transactionInRange(row.date, range));
  const openingBalance = allRows
    .filter((row) => range.start !== null && row.date && row.date.getTime() < range.start)
    .reduce((balance, row) => balance + Number(row.debit || 0) - Number(row.credit || 0), 0);
  const totalDebit = included.reduce((sum, row) => sum + Number(row.debit || 0), 0);
  const totalCredit = included.reduce((sum, row) => sum + Number(row.credit || 0), 0);
  const closingBalance = openingBalance + totalDebit - totalCredit;

  if (
    range.start === null && range.endExclusive === null &&
    cents(closingBalance) !== cents(totals.netBalance)
  ) {
    throw exportError("The customer ledger does not reconcile to the accounting projection.", 500);
  }

  let runningBalance = openingBalance;
  const transactionRows = included.map((row) => {
    runningBalance += Number(row.debit || 0) - Number(row.credit || 0);
    const description = describeLedgerEvent(row);
    return [
      "Transaction",
      indiaTimestamp(row.date),
      description,
      row.type.startsWith("Payment Allocation")
        ? row.targetReference || ""
        : row.reference || "",
      row.paymentReference || "",
      indiaTimestamp(row.businessOrderDate),
      Number(row.debit || 0),
      Number(row.credit || 0),
      runningBalance,
      "",
    ];
  });
  const period = range.start === null && range.endExclusive === null
    ? "All transactions"
    : `${range.start === null ? "Beginning" : indiaDateLabel(range.start)} to ${range.endExclusive === null ? "Latest" : indiaDateLabel(range.endExclusive - 1)}`;
  const rows = [
    ["Record Type", "Transaction Date/Time", "Description", "Order Number", "Payment Reference", "Business Order Date", "Debit INR", "Credit INR", "Running Balance INR", "Current Available Advance INR"],
    ["Customer", "", customer.name || "", "", "", "", "", "", "", ""],
    ["Period", "", period, "", "", "", "", "", "", ""],
    ["Opening Balance", "", "Balance before selected period", "", "", "", 0, 0, openingBalance, ""],
    ...transactionRows,
    ["Total Debit", "", "", "", "", "", totalDebit, 0, "", ""],
    ["Total Credit", "", "", "", "", "", 0, totalCredit, "", ""],
    ["Closing Balance", "", "Opening + Debit - Credit", "", "", "", "", "", closingBalance, ""],
    ["Available Advance", "", "Shown separately from outstanding due", "", "", "", "", "", "", totals.availableAdvance],
  ];

  if (cents(runningBalance) !== cents(closingBalance))
    throw exportError("The exported running balance does not reconcile.", 500);
  return { rows, openingBalance, totalDebit, totalCredit, closingBalance, availableAdvance: totals.availableAdvance };
}

function describeLedgerEvent(row) {
  switch (row.type) {
    case "Order":
      return `Order created${row.deliveryStatus ? ` (${row.deliveryStatus})` : ""}`;
    case "Payment": {
      const targets = (row.allocations || []).map((allocation) =>
        `${allocation.targetReference}: INR ${Number(allocation.amount).toFixed(2)}`,
      );
      const details = [row.method].filter(Boolean).join("; ");
      return ["Payment received", details, targets.length ? `Allocated to ${targets.join(", ")}` : ""].filter(Boolean).join(" - ");
    }
    case "Previous Due Adjustment":
      return row.reason ? `Previous due adjustment: ${row.reason}` : "Previous due adjustment";
    case "Advance Application":
      return `Advance applied${row.targetReference ? ` to ${row.targetReference}` : ""}`;
    case "Cancellation Reversal":
      return row.reason ? `Cancellation reversal: ${row.reason}` : "Cancellation reversal";
    case "Adjustment Reversal":
      return "Adjustment reversal";
    case "Payment Allocation Reversal":
      return `Payment allocation reversed${row.targetReference ? ` from ${row.targetReference}` : ""}`;
    case "Payment Allocation Replacement":
      return `Payment allocation reassigned${row.targetReference ? ` to ${row.targetReference}` : ""}`;
    default:
      return row.type;
  }
}

export function buildPaymentDetailsExport(orders, range = { start: null, endExclusive: null }) {
  const accounting = calculateFifoAccounting(orders);
  const allEntries = [];
  const orderById = new Map(orders.map((order) => [String(order._id), order]));
  const add = (date, stableId, row) => allEntries.push({ date, stableId, row });

  for (const order of orders) {
    const orderId = String(order._id);
    const orderDate = transactionTimestamp(order.createdAt, null, order._id);
    add(orderDate, `order|${orderId}`, {
      recordType: "Order",
      transactionId: orderId,
      transactionDate: orderDate,
      businessOrderDate: order.orderDate || "",
      customerId: String(order.customer?._id || order.customer || ""),
      orderId,
      orderNumber: order.orderNumber,
      orderAmount: orderTotal(order),
      deliveryStatus: order.deliveryStatus,
    });

    for (const payment of order.payments || []) {
      const paymentId = String(payment._id || "");
      const paymentDate = transactionTimestamp(payment.paidAt, payment.createdAt, payment._id);
      const projectedAllocations = accounting.allocations.filter((allocation) =>
        allocation.paymentOrderId === orderId && allocation.paymentId === paymentId,
      );
      const allocationDetails = projectedAllocations.map((allocation) => {
        const target = orderById.get(allocation.targetOrderId);
        return {
          allocationType: allocation.allocationType,
          targetOrderId: allocation.targetOrderId,
          targetOrderNumber: target?.orderNumber || "",
          amount: Number(allocation.amount),
        };
      });
      const allocatedAmount = allocationDetails.reduce((sum, item) => sum + item.amount, 0);
      const unallocatedAdvance = Math.max(0, Number(payment.amount || 0) - allocatedAmount);
      if (unallocatedAdvance > 0) {
        allocationDetails.push({
          allocationType: "customer-advance-credit",
          targetOrderId: "",
          targetOrderNumber: "Available Customer Advance",
          amount: unallocatedAdvance,
        });
      }
      if (cents(allocationDetails.reduce((sum, item) => sum + item.amount, 0)) !== cents(payment.amount))
        throw exportError(`Payment ${paymentId} allocations do not equal the received amount.`, 500);

      const reversedAllocations = orders.flatMap((item) => item.cancellationReversal?.reversedAllocations || [])
        .filter((item) => String(item.paymentOrderId) === orderId && String(item.paymentId) === paymentId)
        .map((item) => ({
          targetOrderId: String(item.targetOrder),
          targetOrderNumber: orderById.get(String(item.targetOrder))?.orderNumber || "",
          amount: Number(item.amount),
          date: item.date || "",
          owner: item.owner || {},
        }));
      const replacementAllocations = orders.flatMap((item) => item.cancellationReversal?.replacementAllocations || [])
        .filter((item) => String(item.paymentOrderId) === orderId && String(item.paymentId) === paymentId)
        .map((item) => ({
          targetOrderId: String(item.targetOrder),
          targetOrderNumber: orderById.get(String(item.targetOrder))?.orderNumber || "",
          amount: Number(item.amount),
          date: item.date || "",
          owner: item.owner || {},
        }));
      add(paymentDate, `payment|${orderId}|${paymentId}`, {
        recordType: "Payment",
        transactionId: paymentId,
        transactionDate: paymentDate,
        customerId: String(order.customer?._id || order.customer || ""),
        orderId,
        orderNumber: order.orderNumber,
        paymentId,
        paymentAmount: Number(payment.amount),
        paymentMethod: payment.method || "",
        paymentReference: payment.reference || "",
        paymentNote: payment.note || "",
        recordedById: payment.recordedBy?.id || "",
        recordedByName: payment.recordedBy?.name || "",
        recordedByEmail: payment.recordedBy?.email || "",
        legacyAppliedToPreviousDue: Number(payment.appliedToPreviousDue || 0),
        idempotencyKey: payment.idempotencyKey || "",
        allocationDetails: JSON.stringify(allocationDetails),
        reversedAllocations: JSON.stringify(reversedAllocations),
        replacementAllocations: JSON.stringify(replacementAllocations),
      });
    }

    const adjustment = order.previousDueAdjustment;
    if (adjustment) {
      const date = transactionTimestamp(adjustment.date, order.createdAt, order._id);
      add(date, `adjustment|${orderId}`, {
        recordType: "Previous Due Adjustment",
        transactionId: `adjustment:${orderId}`,
        transactionDate: date,
        customerId: String(order.customer?._id || order.customer || ""),
        orderId,
        orderNumber: order.orderNumber,
        adjustmentOriginalAmount: adjustment.originalAmount,
        adjustmentAdjustedAmount: adjustment.adjustedAmount,
        adjustmentAmount: adjustment.amount,
        reason: adjustment.reason || "",
        recordedById: adjustment.owner?.id || "",
        recordedByName: adjustment.owner?.name || "",
        recordedByEmail: adjustment.owner?.email || "",
      });
    }

    for (const [index, application] of (order.advanceApplications || []).entries()) {
      const date = transactionTimestamp(application.appliedAt, order.createdAt, order._id);
      add(date, `advance|${orderId}|${index}`, {
        recordType: "Advance Application",
        transactionId: `advance:${orderId}:${index}`,
        transactionDate: date,
        customerId: String(order.customer?._id || order.customer || ""),
        orderId,
        orderNumber: order.orderNumber,
        advanceSourceOrderId: String(application.sourceOrder?._id || application.sourceOrder || ""),
        advanceAmount: Number(application.amount),
        recordedById: application.owner?.id || "",
        recordedByName: application.owner?.name || "",
        recordedByEmail: application.owner?.email || "",
      });
    }

    const reversal = order.cancellationReversal;
    if (reversal) {
      const date = transactionTimestamp(reversal.date, order.updatedAt, order._id);
      add(date, `cancellation|${orderId}`, {
        recordType: "Cancellation Reversal",
        transactionId: `cancellation:${orderId}`,
        transactionDate: date,
        customerId: String(order.customer?._id || order.customer || ""),
        orderId,
        orderNumber: order.orderNumber,
        cancellationOrderAmount: reversal.orderAmount,
        cancellationAdjustmentAmount: reversal.adjustmentAmount,
        cancellationReleasedAdvance: reversal.releasedAdvance,
        reason: reversal.reason || "",
        recordedById: reversal.owner?.id || "",
        recordedByName: reversal.owner?.name || "",
        recordedByEmail: reversal.owner?.email || "",
      });
      for (const [index, allocation] of (reversal.reversedAllocations || []).entries()) {
        const allocationDate = transactionTimestamp(allocation.date, date, order._id);
        add(allocationDate, `allocation-reversal|${orderId}|${index}`, {
          recordType: "Payment Allocation Reversal",
          transactionId: `allocation-reversal:${orderId}:${index}`,
          transactionDate: allocationDate,
          orderId,
          orderNumber: order.orderNumber,
          paymentId: allocation.paymentId,
          allocationTargetOrderId: String(allocation.targetOrder),
          allocationAmount: allocation.amount,
          recordedById: allocation.owner?.id || "",
          recordedByName: allocation.owner?.name || "",
          recordedByEmail: allocation.owner?.email || "",
        });
      }
      for (const [index, allocation] of (reversal.replacementAllocations || []).entries()) {
        const allocationDate = transactionTimestamp(allocation.date, date, order._id);
        add(allocationDate, `allocation-replacement|${orderId}|${index}`, {
          recordType: "Payment Allocation Replacement",
          transactionId: `allocation-replacement:${orderId}:${index}`,
          transactionDate: allocationDate,
          orderId,
          orderNumber: order.orderNumber,
          paymentId: allocation.paymentId,
          allocationTargetOrderId: String(allocation.targetOrder),
          allocationAmount: allocation.amount,
          recordedById: allocation.owner?.id || "",
          recordedByName: allocation.owner?.name || "",
          recordedByEmail: allocation.owner?.email || "",
        });
      }
    }
  }

  ensureTimestampedForRange(allEntries.map((entry) => ({ date: entry.date })), range);
  return allEntries
    .filter((entry) => transactionInRange(entry.date, range))
    .sort((a, b) => {
      const aTime = a.date?.getTime() ?? Number.POSITIVE_INFINITY;
      const bTime = b.date?.getTime() ?? Number.POSITIVE_INFINITY;
      return aTime - bTime || a.stableId.localeCompare(b.stableId);
    })
    .map(({ row }) => row);
}

const ledgerCsvHeaders = [
  "Record Type",
  "Transaction Date/Time",
  "Description",
  "Order Number",
  "Payment Reference",
  "Business Order Date",
  "Debit INR",
  "Credit INR",
  "Running Balance INR",
  "Current Available Advance INR",
];

const paymentDetailsCsvHeaders = [
  "Record Type",
  "Transaction ID",
  "Transaction Timestamp",
  "Customer ID",
  "Order ID",
  "Order Number",
  "Business Order Date",
  "Order Amount INR",
  "Delivery Status",
  "Payment ID",
  "Payment Amount INR",
  "Payment Method",
  "Payment Reference",
  "Payment Note",
  "Legacy Previous Due Applied INR",
  "Idempotency Key",
  "Allocation Details JSON",
  "Reversed Allocations JSON",
  "Replacement Allocations JSON",
  "Adjustment Original INR",
  "Adjustment Adjusted INR",
  "Adjustment Amount INR",
  "Advance Source Order ID",
  "Advance Amount INR",
  "Cancellation Order Amount INR",
  "Cancellation Adjustment INR",
  "Cancellation Released Advance INR",
  "Allocation Target Order ID",
  "Allocation Amount INR",
  "Reason",
  "Recorded By ID",
  "Recorded By Name",
  "Recorded By Email",
];

export const paymentDetailsHeaders = paymentDetailsCsvHeaders;
export const customerLedgerHeaders = ledgerCsvHeaders;

export const paymentDetailsFields = [
  "recordType",
  "transactionId",
  "transactionDate",
  "customerId",
  "orderId",
  "orderNumber",
  "businessOrderDate",
  "orderAmount",
  "deliveryStatus",
  "paymentId",
  "paymentAmount",
  "paymentMethod",
  "paymentReference",
  "paymentNote",
  "legacyAppliedToPreviousDue",
  "idempotencyKey",
  "allocationDetails",
  "reversedAllocations",
  "replacementAllocations",
  "adjustmentOriginalAmount",
  "adjustmentAdjustedAmount",
  "adjustmentAmount",
  "advanceSourceOrderId",
  "advanceAmount",
  "cancellationOrderAmount",
  "cancellationAdjustmentAmount",
  "cancellationReleasedAdvance",
  "allocationTargetOrderId",
  "allocationAmount",
  "reason",
  "recordedById",
  "recordedByName",
  "recordedByEmail",
];

export function paymentDetailsExportRows(orders, range = { start: null, endExclusive: null }) {
  return buildPaymentDetailsExport(orders, range).map((record) =>
    paymentDetailsFields.map((field) => {
      const value = record[field];
      return value instanceof Date ? indiaTimestamp(value) : value ?? "";
    }),
  );
}
