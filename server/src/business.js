import { performance } from "node:perf_hooks";

export const ORDER_STATUS_PRIORITY = {
  Pending: 0,
  Delivered: 1,
  Cancelled: 2,
};

export const INVALID_MOBILE_MESSAGE = "Please enter a valid mobile number.";
export const DUPLICATE_CUSTOMER_PHONE_MESSAGE =
  "An active customer already uses this phone number.";

export function normalizeIndianMobile(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return raw.replace(/[\s().-]/g, "");
}

export function isValidIndianMobile(value) {
  return /^[6-9][0-9]{9}$/.test(normalizeIndianMobile(value));
}

export function orderTotal(order) {
  return (order.items || []).reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0,
  );
}

export function orderPaid(order) {
  return (order.payments || []).reduce(
    (sum, payment) => sum + payment.amount,
    0,
  );
}

export function customerPaymentDueSnapshot(previousDue, amount) {
  const before = Math.round(Number(previousDue) * 100) / 100;
  const received = Math.round(Number(amount) * 100) / 100;
  return {
    previousDue: before,
    currentDue: Math.max(0, Math.round((before - received) * 100) / 100),
  };
}

const stableOrderCompare = (a, b) =>
  new Date(a.orderDate || a.createdAt || 0) -
    new Date(b.orderDate || b.createdAt || 0) ||
  new Date(a.createdAt || a.orderDate || 0) -
    new Date(b.createdAt || b.orderDate || 0) ||
  String(a._id || "").localeCompare(String(b._id || ""));

const orderId = (order) => String(order?._id ?? order?.id ?? "");

function validTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function objectIdTimestamp(id) {
  if (typeof id?.getTimestamp === "function")
    return validTimestamp(id.getTimestamp());
  const value = String(id || "");
  if (!/^[a-f\d]{24}$/i.test(value)) return null;
  return new Date(Number.parseInt(value.slice(0, 8), 16) * 1000);
}

export function transactionTimestamp(primary, fallback, id) {
  return (
    validTimestamp(primary) || validTimestamp(fallback) || objectIdTimestamp(id)
  );
}

const orderCreatedTimestamp = (order) =>
  transactionTimestamp(order.createdAt, null, order._id || order.id);

const EVENT_PRIORITY = {
  adjustment: 0,
  advance: 1,
  payment: 2,
  "replacement-allocation": 3,
};

function compareAccountingEvents(a, b) {
  const aTime = validTimestamp(a.date)?.getTime() ?? Number.POSITIVE_INFINITY;
  const bTime = validTimestamp(b.date)?.getTime() ?? Number.POSITIVE_INFINITY;
  if (aTime !== bTime) return aTime - bTime;
  const orderDifference = stableOrderCompare(a.order, b.order);
  if (orderDifference) return orderDifference;
  const priorityDifference =
    (EVENT_PRIORITY[a.kind] ?? 9) - (EVENT_PRIORITY[b.kind] ?? 9);
  if (priorityDifference) return priorityDifference;
  const key = (event) =>
    [
      orderId(event.order),
      String(event.payment?._id || ""),
      String(event.allocation?.paymentId || ""),
      String(
        event.allocation?.targetOrder?._id ||
          event.allocation?.targetOrder ||
          "",
      ),
      String(
        event.application?.sourceOrder?._id ||
          event.application?.sourceOrder ||
          "",
      ),
      String(
        event.amount ??
          event.application?.amount ??
          event.allocation?.amount ??
          0,
      ),
    ].join("|");
  return key(a).localeCompare(key(b));
}

/**
 * Deterministic, read-only accounting projection. Explicit allocations are
 * authoritative. Legacy receipts are reconstructed at their historical
 * payment time using appliedToPreviousDue and FIFO, without mutating records.
 */
export function calculateFifoAccounting(orders) {
  const sorted = [...orders].sort(stableOrderCompare);
  const ids = new Map(
    sorted.map((order, index) => [
      order,
      String(
        order._id ?? order.id ?? order.orderNumber ?? `legacy-order-${index}`,
      ),
    ]),
  );
  const getId = (order) => ids.get(order) ?? orderId(order);
  const balances = new Map();
  const orderBalances = new Map();
  const allocations = [];
  const legacyAllocations = [];
  const paymentEvents = [];
  const adjustmentEvents = [];
  const advanceEvents = [];
  const advances = new Map();
  const advanceUsage = new Map();

  for (const order of sorted) {
    const id = getId(order);
    const cancelled = order.deliveryStatus === "Cancelled";
    balances.set(id, cancelled ? 0 : orderTotal(order));
    orderBalances.set(order, cancelled ? 0 : orderTotal(order));
    advances.set(id, 0);
    if (!cancelled && Number(order.previousDueAdjustment?.amount || 0)) {
      adjustmentEvents.push({
        order,
        date: transactionTimestamp(
          order.previousDueAdjustment.date,
          order.createdAt,
          order._id || order.id,
        ),
        amount: Number(order.previousDueAdjustment.amount),
      });
    }
    for (const payment of order.payments || []) {
      paymentEvents.push({ order, payment });
    }
    if (!cancelled) {
      for (const application of order.advanceApplications || []) {
        advanceEvents.push({
          order,
          application,
          date: transactionTimestamp(
            application.appliedAt,
            order.createdAt,
            order._id || order.id,
          ),
          kind: "advance",
        });
      }
    }
  }

  const fifoTargets = (beforeOrder) =>
    sorted.filter((candidate) => {
      if (candidate.deliveryStatus === "Cancelled") return false;
      if (getId(candidate) === getId(beforeOrder)) return false;
      if (stableOrderCompare(candidate, beforeOrder) >= 0) return false;
      return (balances.get(getId(candidate)) || 0) > 0;
    });

  const applyFifo = (amount, targets, record) => {
    let remaining = Math.max(0, amount);
    for (const target of targets) {
      if (remaining <= 0) break;
      const id = getId(target);
      const due = balances.get(id) || 0;
      const allocated = Math.min(due, remaining);
      if (!allocated) continue;
      balances.set(id, due - allocated);
      orderBalances.set(target, due - allocated);
      record({ targetOrderId: id, amount: allocated });
      remaining -= allocated;
    }
    return remaining;
  };

  // Account adjustments are applied by effective date. A credit reduces the
  // oldest open invoices; a debit is attached to the order that recorded it.
  const events = [
    ...adjustmentEvents.map((event) => ({ ...event, kind: "adjustment" })),
    ...advanceEvents,
    ...paymentEvents.map(({ order, payment }) => ({
      order,
      payment,
      date: transactionTimestamp(
        payment.paidAt,
        payment.createdAt,
        payment._id,
      ),
      kind: "payment",
    })),
    ...sorted.flatMap((order) =>
      (order.cancellationReversal?.replacementAllocations || []).map(
        (allocation) => ({
          order,
          allocation,
          date: transactionTimestamp(
            allocation.date,
            order.cancellationReversal?.date || order.updatedAt,
            order._id || order.id,
          ),
          kind: "replacement-allocation",
        }),
      ),
    ),
  ].sort(compareAccountingEvents);

  for (const event of events) {
    const ownId = getId(event.order);
    if (event.kind === "replacement-allocation") {
      const targetOrderId = String(
        event.allocation.targetOrder?._id || event.allocation.targetOrder,
      );
      const amount = Number(event.allocation.amount || 0);
      const target = sorted.find((item) => getId(item) === targetOrderId);
      if (target && target.deliveryStatus !== "Cancelled" && amount > 0) {
        balances.set(
          targetOrderId,
          Math.max(0, (balances.get(targetOrderId) || 0) - amount),
        );
        orderBalances.set(
          target,
          Math.max(0, (orderBalances.get(target) || 0) - amount),
        );
        allocations.push({
          paymentOrderId: String(event.allocation.paymentOrderId),
          targetOrderId,
          amount,
          paymentId: String(event.allocation.paymentId),
          allocationType: "cancellation-replacement",
        });
      }
      continue;
    }
    if (event.kind === "advance") {
      let remaining = Number(event.application.amount || 0);
      const ownDue = balances.get(ownId) || 0;
      const ownApplied = Math.min(ownDue, remaining);
      if (ownApplied > 0) {
        balances.set(ownId, ownDue - ownApplied);
        orderBalances.set(event.order, ownDue - ownApplied);
        remaining -= ownApplied;
      }
      if (remaining > 0) {
        remaining = applyFifo(remaining, fifoTargets(event.order), () => {});
      }
      const sourceId = String(
        event.application.sourceOrder?._id ||
          event.application.sourceOrder ||
          event.application.sourceOrderId,
      );
      advanceUsage.set(
        sourceId,
        (advanceUsage.get(sourceId) || 0) +
          Number(event.application.amount || 0),
      );
      continue;
    }
    if (event.kind === "adjustment") {
      if (event.amount > 0) {
        balances.set(ownId, (balances.get(ownId) || 0) + event.amount);
        orderBalances.set(
          event.order,
          (orderBalances.get(event.order) || 0) + event.amount,
        );
      } else applyFifo(-event.amount, fifoTargets(event.order), () => {});
      continue;
    }
    const payment = event.payment;
    const reversalRecords = sorted
      .flatMap((item) => item.cancellationReversal?.reversedAllocations || [])
      .filter(
        (record) =>
          String(record.paymentOrderId) === ownId &&
          String(record.paymentId) === String(payment._id || ""),
      );
    const reversedAmountFor = (targetId) =>
      reversalRecords
        .filter(
          (record) =>
            String(record.targetOrder?._id || record.targetOrder) === targetId,
        )
        .reduce((sum, record) => sum + Number(record.amount || 0), 0);
    const replacementAmount = sorted
      .flatMap(
        (item) => item.cancellationReversal?.replacementAllocations || [],
      )
      .filter(
        (record) =>
          String(record.paymentOrderId) === ownId &&
          String(record.paymentId) === String(payment._id || ""),
      )
      .reduce((sum, record) => sum + Number(record.amount || 0), 0);
    const explicit =
      Array.isArray(payment.allocations) && payment.allocations.length > 0;
    if (explicit) {
      let effectiveAmount = 0;
      for (const allocation of payment.allocations) {
        const targetOrderId = String(
          allocation.targetOrder?._id || allocation.targetOrder,
        );
        const amount = Math.max(
          0,
          Number(allocation.amount || 0) - reversedAmountFor(targetOrderId),
        );
        const target = sorted.find((item) => getId(item) === targetOrderId);
        if (!target || target.deliveryStatus === "Cancelled" || amount <= 0)
          continue;
        balances.set(
          targetOrderId,
          Math.max(0, (balances.get(targetOrderId) || 0) - amount),
        );
        orderBalances.set(
          target,
          Math.max(0, (orderBalances.get(target) || 0) - amount),
        );
        effectiveAmount += amount;
        allocations.push({
          paymentOrderId: ownId,
          targetOrderId,
          amount,
          paymentId: String(payment._id || ""),
          allocationType: "explicit",
        });
      }
      advances.set(
        ownId,
        (advances.get(ownId) || 0) +
          Math.max(
            0,
            Number(payment.amount || 0) - effectiveAmount - replacementAmount,
          ),
      );
      continue;
    }

    // Existing appliedToPreviousDue is the only historical clue about
    // cross-order receipt allocation. Project it to oldest eligible invoices.
    const reversedLegacyAmount = reversalRecords.reduce(
      (sum, record) => sum + Number(record.amount || 0),
      0,
    );
    let toPrior = Math.max(
      0,
      Number(payment.appliedToPreviousDue || 0) - reversedLegacyAmount,
    );
    if (toPrior > 0) {
      const applied = [];
      const left = applyFifo(toPrior, fifoTargets(event.order), (allocation) =>
        applied.push(allocation),
      );
      legacyAllocations.push(
        ...applied.map((allocation) => ({
          ...allocation,
          paymentOrderId: ownId,
          paymentId: String(payment._id || ""),
          allocationType: "reconstructed-legacy",
        })),
      );
      toPrior -= left;
    }
    const ownDue = balances.get(ownId) || 0;
    const ownAmount = Math.min(
      ownDue,
      Math.max(
        0,
        Number(payment.amount || 0) - Number(payment.appliedToPreviousDue || 0),
      ),
    );
    if (ownAmount > 0) {
      balances.set(ownId, ownDue - ownAmount);
      orderBalances.set(event.order, ownDue - ownAmount);
      legacyAllocations.push({
        paymentOrderId: ownId,
        targetOrderId: ownId,
        amount: ownAmount,
        paymentId: String(payment._id || ""),
        allocationType: "reconstructed-legacy",
      });
    }
    const unallocated =
      Math.max(
        0,
        Number(payment.amount || 0) -
          Number(payment.appliedToPreviousDue || 0) -
          ownAmount,
      ) + Math.max(0, reversedLegacyAmount - replacementAmount);
    advances.set(ownId, (advances.get(ownId) || 0) + unallocated);
  }

  // Source credits are derived from the complete receipt history. Apply the
  // recorded uses after receipts so a legacy receipt with no timestamp cannot
  // be incorrectly ordered after the application that references it.
  for (const [sourceId, amount] of advanceUsage) {
    advances.set(sourceId, Math.max(0, (advances.get(sourceId) || 0) - amount));
  }

  allocations.push(...legacyAllocations);
  const due = [...balances.values()].reduce((sum, value) => sum + value, 0);
  const availableAdvance = [...advances.values()].reduce(
    (sum, value) => sum + value,
    0,
  );
  return {
    balances,
    orderBalances,
    allocations,
    legacyAllocations,
    due,
    availableAdvance,
    advanceSources: [...advances].map(([sourceOrderId, amount]) => ({
      sourceOrderId,
      amount,
    })),
    netBalance: due - availableAdvance,
  };
}

export function fifoPaymentAllocations(
  orders,
  amount,
  balanceOverrides = null,
) {
  let remainingCents = Math.round(Number(amount) * 100);
  const { balances } = calculateFifoAccounting(orders);
  const dueBalances = balanceOverrides || balances;
  const byId = new Map(orders.map((order) => [orderId(order), order]));
  const targets = [...orders]
    .filter((order) => order.deliveryStatus !== "Cancelled")
    .sort(stableOrderCompare);
  const allocations = [];
  for (const target of targets) {
    if (remainingCents <= 0) break;
    const id = orderId(target);
    const dueCents = Math.max(0, Math.round((dueBalances.get(id) || 0) * 100));
    const allocatedCents = Math.min(dueCents, remainingCents);
    if (!allocatedCents) continue;
    allocations.push({
      targetOrder: byId.get(id)?._id,
      amount: allocatedCents / 100,
    });
    dueBalances.set(id, (dueCents - allocatedCents) / 100);
    remainingCents -= allocatedCents;
  }
  if (remainingCents !== 0)
    throw new Error(
      "Payment allocation does not match the outstanding customer balance.",
    );
  return allocations;
}

export function findPaymentByIdempotencyKey(orders, key) {
  if (!key) return null;
  return (
    orders.find((order) =>
      (order.payments || []).some((payment) => payment.idempotencyKey === key),
    ) || null
  );
}

export function orderDue(order) {
  if (order.deliveryStatus === "Cancelled") return 0;
  const appliedAdvance = (order.advanceApplications || []).reduce(
    (sum, application) => sum + Number(application.amount || 0),
    0,
  );
  const invoicePayable = Math.max(0, orderTotal(order) - appliedAdvance);
  const priorDuePayment = (order.payments || []).reduce(
    (sum, payment) => sum + Number(payment.appliedToPreviousDue || 0),
    0,
  );
  const cashAppliedToOrder = Math.min(
    invoicePayable,
    Math.max(0, orderPaid(order) - priorDuePayment),
  );
  return Math.max(0, invoicePayable - cashAppliedToOrder);
}

export function orderPaymentValidationError(
  order,
  amount,
  customerOrders = [order],
) {
  if (!order) return "Order not found.";
  if (order.deliveryStatus === "Cancelled")
    return "Cancelled orders cannot receive payments.";
  if (!isValidMoney(amount, { allowZero: false }))
    return "Enter a valid payment amount greater than zero.";
  const remainingDue = customerDue(customerOrders.filter(Boolean));
  if (remainingDue <= 0)
    return "This customer has no outstanding order balance.";
  if (amount > remainingDue + 0.00001)
    return "Payment cannot exceed the customer's total outstanding due.";
  return null;
}

export function initialOrderPaymentLimit(total, previousDue, advanceApplied) {
  const currentInvoicePayable = Math.max(0, total - advanceApplied);
  const previousDueAfterAdvance = Math.max(
    0,
    previousDue - Math.max(0, advanceApplied - total),
  );
  return currentInvoicePayable + previousDueAfterAdvance;
}

function calculateLedgerFifo(orders, onFifoCalculation) {
  const startedAt = performance.now();
  try {
    return calculateFifoAccounting(orders);
  } finally {
    onFifoCalculation?.(Number((performance.now() - startedAt).toFixed(2)));
  }
}

export function customerLedgerTotals(orders, instrumentation = null) {
  const fifo = calculateLedgerFifo(orders, instrumentation?.onFifoCalculation);
  const sales = orders
    .filter((order) => order.deliveryStatus !== "Cancelled")
    .reduce((sum, order) => sum + orderTotal(order), 0);
  return {
    sales,
    due: fifo.due,
    availableAdvance: fifo.availableAdvance,
    netBalance: fifo.netBalance,
  };
}

export function customerDue(orders) {
  return customerLedgerTotals(orders).due;
}

export function customerAvailableAdvance(orders) {
  return customerLedgerTotals(orders).availableAdvance;
}

export function customerAdvanceSources(orders) {
  return calculateFifoAccounting(orders).advanceSources.filter(
    ({ amount }) => amount > 0,
  );
}

export function customerLedgerRows(orders, instrumentation = null) {
  const events = [];
  const accounting = calculateLedgerFifo(
    orders,
    instrumentation?.onFifoCalculation,
  );
  const orderReferences = new Map(
    orders.map((order) => [
      orderId(order),
      order.orderNumber || orderId(order),
    ]),
  );
  const addEvent = (row, id, tie = "") => {
    const date = validTimestamp(row.date);
    events.push({
      ...row,
      date,
      debit: Number(row.debit || 0),
      credit: Number(row.credit || 0),
      eventId: `${id}|${tie}`,
    });
  };

  for (const order of orders) {
    const reference = order.orderNumber;
    const total = orderTotal(order);
    const createdAt = orderCreatedTimestamp(order);
    const thisOrderId = orderId(order);
    addEvent(
      {
        date: createdAt,
        type: "Order",
        reference,
        debit: total,
        credit: 0,
        deliveryStatus: order.deliveryStatus,
        businessOrderDate: validTimestamp(order.orderDate),
      },
      "order",
      thisOrderId,
    );

    const adjustment = order.previousDueAdjustment;
    if (adjustment?.amount) {
      addEvent(
        {
          date: transactionTimestamp(
            adjustment.date,
            order.createdAt,
            order._id || order.id,
          ),
          type: "Previous Due Adjustment",
          reference,
          debit: Math.max(0, adjustment.amount),
          credit: Math.max(0, -adjustment.amount),
          reason: adjustment.reason,
          owner: adjustment.owner,
        },
        "adjustment",
        `${thisOrderId}|${String(adjustment.date || "")}|${adjustment.amount}`,
      );
    }

    for (const payment of order.payments || []) {
      const paymentId = String(payment._id || "");
      const paymentAllocations = (
        Array.isArray(payment.allocations) && payment.allocations.length
          ? payment.allocations.map((allocation) => ({
              targetOrderId: String(
                allocation.targetOrder?._id || allocation.targetOrder,
              ),
              amount: Number(allocation.amount || 0),
              allocationType: "explicit",
            }))
          : accounting.allocations.filter(
              (allocation) =>
                allocation.paymentOrderId === orderId(order) &&
                allocation.paymentId === paymentId &&
                allocation.allocationType === "reconstructed-legacy",
            )
      ).map((allocation) => ({
        targetReference:
          orderReferences.get(allocation.targetOrderId) ||
          allocation.targetOrderId,
        amount: allocation.amount,
        allocationType: allocation.allocationType,
      }));
      addEvent(
        {
          date: transactionTimestamp(
            payment.paidAt,
            payment.createdAt,
            payment._id,
          ),
          type: "Payment",
          reference,
          paymentReference: payment.reference || "",
          method: payment.method,
          debit: 0,
          credit: payment.amount,
          note: payment.note,
          appliedToPreviousDue: Number(payment.appliedToPreviousDue || 0),
          allocations: paymentAllocations,
        },
        "payment",
        `${thisOrderId}|${paymentId}`,
      );
    }

    for (const application of order.advanceApplications || []) {
      const sourceReference = String(
        application.sourceOrder?.orderNumber || application.sourceOrder,
      );
      addEvent(
        {
          date: transactionTimestamp(
            application.appliedAt,
            order.createdAt,
            order._id || order.id,
          ),
          type: "Advance Application",
          reference,
          amount: application.amount,
          sourceReference,
          targetReference: reference,
          owner: application.owner,
        },
        "advance",
        `${thisOrderId}|${sourceReference}|${application.amount}`,
      );
    }

    if (order.cancellationReversal || order.deliveryStatus === "Cancelled") {
      const reversal = order.cancellationReversal || {
        date:
          order.updatedAt ||
          order.createdAt ||
          objectIdTimestamp(order._id || order.id),
        orderAmount: total,
        adjustmentAmount: Number(adjustment?.amount || 0),
        reason: "Legacy cancellation reversal",
        owner: { name: "System" },
      };
      const reversalDate = transactionTimestamp(
        reversal.date,
        order.updatedAt,
        order._id || order.id,
      );
      addEvent(
        {
          date: reversalDate,
          type: "Cancellation Reversal",
          reference,
          debit: 0,
          credit: reversal.orderAmount,
          reason: reversal.reason,
          owner: reversal.owner,
        },
        "cancellation",
        thisOrderId,
      );
      if (reversal.adjustmentAmount) {
        addEvent(
          {
            date: reversalDate,
            type: "Adjustment Reversal",
            reference,
            debit: Math.max(0, -reversal.adjustmentAmount),
            credit: Math.max(0, reversal.adjustmentAmount),
            owner: reversal.owner,
          },
          "adjustment-reversal",
          thisOrderId,
        );
      }
      for (const allocation of reversal.reversedAllocations || []) {
        addEvent(
          {
            date: transactionTimestamp(
              allocation.date,
              reversalDate,
              order._id || order.id,
            ),
            type: "Payment Allocation Reversal",
            reference: String(allocation.paymentId),
            amount: allocation.amount,
            targetReference: orderReferences.get(
              String(allocation.targetOrder?._id || allocation.targetOrder),
            ),
            owner: allocation.owner || reversal.owner,
          },
          "allocation-reversal",
          `${allocation.paymentOrderId}|${allocation.paymentId}|${allocation.targetOrder}`,
        );
      }
      for (const allocation of reversal.replacementAllocations || []) {
        addEvent(
          {
            date: transactionTimestamp(
              allocation.date,
              reversalDate,
              order._id || order.id,
            ),
            type: "Payment Allocation Replacement",
            reference: String(allocation.paymentId),
            amount: allocation.amount,
            targetReference: orderReferences.get(
              String(allocation.targetOrder?._id || allocation.targetOrder),
            ),
            owner: allocation.owner || reversal.owner,
          },
          "allocation-replacement",
          `${allocation.paymentOrderId}|${allocation.paymentId}|${allocation.targetOrder}`,
        );
      }
    }
  }

  const eventPriority = {
    Order: 0,
    "Previous Due Adjustment": 1,
    "Advance Application": 2,
    Payment: 3,
    "Payment Allocation Reversal": 4,
    "Cancellation Reversal": 5,
    "Adjustment Reversal": 6,
    "Payment Allocation Replacement": 7,
  };
  events.sort((a, b) => {
    const aTime = validTimestamp(a.date)?.getTime() ?? Number.POSITIVE_INFINITY;
    const bTime = validTimestamp(b.date)?.getTime() ?? Number.POSITIVE_INFINITY;
    return (
      aTime - bTime ||
      (eventPriority[a.type] ?? 99) - (eventPriority[b.type] ?? 99) ||
      a.eventId.localeCompare(b.eventId)
    );
  });
  let balance = 0;
  return events.map(({ eventId: _eventId, ...row }) => {
    balance += row.debit - row.credit;
    return { ...row, balance };
  });
}

export function previousUnpaidDate(orders) {
  const accounting = calculateFifoAccounting(orders);
  const candidates = orders
    .filter(
      (order) =>
        order.deliveryStatus !== "Cancelled" &&
        (accounting.orderBalances.get(order) || 0) > 0,
    )
    .sort(stableOrderCompare)
    .map((order) => ({
      date: order.orderDate || order.createdAt,
      amount: accounting.orderBalances.get(order) || 0,
    }));
  const stillUnpaid = candidates.find((item) => item.amount > 0);
  if (stillUnpaid) return stillUnpaid.date;
  return (
    orders
      .filter(
        (order) =>
          order.deliveryStatus !== "Cancelled" &&
          Number(order.previousDueAdjustment?.amount || 0) > 0,
      )
      .map((order) => order.previousDueAdjustment.date || order.createdAt)
      .sort((a, b) => new Date(a) - new Date(b))[0] || null
  );
}

export function isValidMoney(value, { allowZero = true } = {}) {
  if (value === "" || value === null || value === undefined) return false;
  const amount = Number(value);
  return (
    Number.isFinite(amount) &&
    amount >= (allowZero ? 0 : 0.01) &&
    amount <= 100000000 &&
    Math.abs(Math.round(amount * 100) - amount * 100) < 0.00001
  );
}

export function reportingDateKey(value, timeZone = "Asia/Kolkata") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export function paymentRowsForDate(orders, dateKey, timeZone = "Asia/Kolkata") {
  return orders.flatMap((order) => {
    return (order.payments || [])
      .filter(
        (payment) => reportingDateKey(payment.paidAt, timeZone) === dateKey,
      )
      .map((payment) => ({
        customer: order.customer,
        date: payment.paidAt,
        amount: payment.amount,
        method: payment.method,
        reference: order.orderNumber,
      }));
  });
}

export function ordersForDate(orders, dateKey, timeZone = "Asia/Kolkata") {
  return orders.filter(
    (order) =>
      order.deliveryStatus !== "Cancelled" &&
      reportingDateKey(order.orderDate, timeZone) === dateKey,
  );
}

export function pendingDeliveryOrders(orders) {
  return orders.filter((order) => order.deliveryStatus === "Pending");
}

export function compareOrders(a, b) {
  const priorityDifference =
    (ORDER_STATUS_PRIORITY[a.deliveryStatus] ?? Number.MAX_SAFE_INTEGER) -
    (ORDER_STATUS_PRIORITY[b.deliveryStatus] ?? Number.MAX_SAFE_INTEGER);
  if (priorityDifference) return priorityDifference;
  return (
    new Date(b.orderDate || b.createdAt) - new Date(a.orderDate || a.createdAt)
  );
}

export function compareCustomers(a, b) {
  const dueDifference = (b.balance || 0) - (a.balance || 0);
  if (dueDifference) return dueDifference;
  return new Date(b.createdAt) - new Date(a.createdAt);
}
