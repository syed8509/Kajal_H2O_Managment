import test from "node:test";
import assert from "node:assert/strict";
import {
  compareCustomers,
  compareOrders,
  customerDue,
  customerAvailableAdvance,
  customerLedgerTotals,
  customerLedgerRows,
  calculateFifoAccounting,
  fifoPaymentAllocations,
  findPaymentByIdempotencyKey,
  isValidMoney,
  isValidIndianMobile,
  initialOrderPaymentLimit,
  orderPaymentValidationError,
  orderDue,
  ordersForDate,
  paymentRowsForDate,
  pendingDeliveryOrders,
  previousUnpaidDate,
} from "../src/business.js";
import { Order } from "../src/models.js";
import {
  buildCustomerLedgerExport,
  parseIndiaDateRange,
  paymentDetailsExportRows,
  paymentDetailsHeaders,
} from "../src/exports.js";

const order = (status, orderDate, amount = 100, paid = 0) => ({
  deliveryStatus: status,
  orderDate,
  items: [{ quantity: 1, unitPrice: amount }],
  payments: paid ? [{ amount: paid }] : [],
});

test("orders sort by status priority, then newest order date", () => {
  const orders = [
    order("Delivered", "2026-03-03"),
    order("Pending", "2026-03-01"),
    order("Pending", "2026-03-05"),
    order("Cancelled", "2026-03-06"),
  ];

  orders.sort(compareOrders);

  assert.deepEqual(
    orders.map((item) => `${item.deliveryStatus}:${item.orderDate}`),
    [
      "Pending:2026-03-05",
      "Pending:2026-03-01",
      "Delivered:2026-03-03",
      "Cancelled:2026-03-06",
    ],
  );
});

test("Indian mobile validation accepts only valid 10-digit numbers", () => {
  assert.equal(isValidIndianMobile("9876543210"), true);
  assert.equal(isValidIndianMobile("6123456789"), true);
  for (const value of [
    "1234567890",
    "987654321",
    "98765432101",
    "12345ABCDE",
    "98765 43210",
    "",
  ]) {
    assert.equal(isValidIndianMobile(value), false, value);
  }
});

test("customer due and available advance remain separate", () => {
  const totals = customerLedgerTotals([
    order("Pending", "2026-03-01", 100, 150),
    order("Delivered", "2026-03-02", 200, 50),
    order("Cancelled", "2026-03-03", 100, 0),
  ]);

  assert.equal(totals.sales, 300);
  assert.equal(totals.netBalance, 100);
  assert.equal(totals.due, 150);
  assert.equal(totals.availableAdvance, 50);
  assert.equal(
    customerDue([{ ...order("Pending", "2026-03-01", 100, 150) }]),
    0,
  );
  assert.equal(
    customerAvailableAdvance([order("Pending", "2026-03-01", 100, 150)]),
    50,
  );
});

test("previous due, an applied advance, and a partial payment calculate once", () => {
  const records = [
    order("Delivered", "2026-01-01", 2000, 1200), // 800 previous due
    { ...order("Delivered", "2026-01-02", 1000, 1300), _id: "advance-source" }, // 300 available advance
    {
      ...order("Pending", "2026-03-05", 1500, 500),
      advanceApplications: [{ sourceOrderId: "advance-source", amount: 300 }],
    },
  ];

  assert.equal(customerDue(records), 1500);
  assert.equal(customerAvailableAdvance(records), 0);
});

test("a payment can clear the current order first and apply its remainder to previous due", () => {
  const oldInvoice = order("Delivered", "2026-01-01", 2000, 1200);
  const sourceAdvance = {
    ...order("Delivered", "2026-01-02", 1000, 1300),
    _id: "advance-source",
  };
  const newOrder = {
    ...order("Pending", "2026-03-05", 1500, 1400),
    advanceApplications: [{ sourceOrderId: "advance-source", amount: 300 }],
    payments: [{ amount: 1400, appliedToPreviousDue: 200 }],
  };

  assert.equal(customerDue([oldInvoice, sourceAdvance, newOrder]), 600);
  assert.equal(
    customerAvailableAdvance([oldInvoice, sourceAdvance, newOrder]),
    0,
  );
});

test("manual previous-due corrections affect the balance without changing old orders", () => {
  const oldOrder = order("Delivered", "2026-01-01", 1000, 200);
  const correctedOrder = {
    ...order("Pending", "2026-03-05", 1500, 500),
    previousDueAdjustment: {
      originalAmount: 800,
      adjustedAmount: 700,
      amount: -100,
      reason: "Old bill correction",
    },
  };

  assert.equal(customerDue([oldOrder, correctedOrder]), 1700);
  assert.equal(oldOrder.items[0].unitPrice, 1000);
  assert.equal(oldOrder.payments[0].amount, 200);
  assert.equal(
    customerDue([
      oldOrder,
      {
        ...correctedOrder,
        previousDueAdjustment: {
          ...correctedOrder.previousDueAdjustment,
          amount: 100,
        },
      },
    ]),
    1900,
  );
});

test("zero due, full payment, and consecutive orders preserve the running due", () => {
  const first = order("Delivered", "2026-03-01", 500, 500);
  const second = order("Pending", "2026-03-02", 1000, 250);
  const third = order("Pending", "2026-03-03", 600, 0);

  assert.equal(customerDue([first]), 0);
  assert.equal(customerDue([first, second]), 750);
  assert.equal(customerDue([first, second, third]), 1350);
});

test("fully paid customers and cancelled receipt orders reject payments", () => {
  const paid = order("Delivered", "2026-03-01", 500, 500);
  const cancelled = order("Cancelled", "2026-03-02", 500, 0);

  assert.equal(orderDue(paid), 0);
  assert.equal(
    orderPaymentValidationError(paid, 1),
    "This customer has no outstanding order balance.",
  );
  assert.equal(
    orderPaymentValidationError(cancelled, 1),
    "Cancelled orders cannot receive payments.",
  );
});

test("payment may exceed the selected order due but not customer-wide due", () => {
  const partiallyPaid = order("Pending", "2026-03-01", 500, 200);
  const otherOrder = order("Delivered", "2026-03-02", 1000, 0);

  assert.equal(orderDue(partiallyPaid), 300);
  assert.equal(orderPaymentValidationError(partiallyPaid, 150), null);
  assert.equal(
    orderPaymentValidationError(partiallyPaid, 800, [
      partiallyPaid,
      otherOrder,
    ]),
    null,
  );
  assert.equal(
    orderPaymentValidationError(partiallyPaid, 1300.01, [
      partiallyPaid,
      otherOrder,
    ]),
    "Payment cannot exceed the customer's total outstanding due.",
  );
});

test("no order means no eligible standalone payment", () => {
  assert.equal(orderPaymentValidationError(null, 100), "Order not found.");
  assert.equal(orderPaymentValidationError(undefined, 100), "Order not found.");
});

test("new-order initial payment stays within payable while existing advance use remains supported", () => {
  assert.equal(initialOrderPaymentLimit(1500, 800, 300), 2000);
  assert.equal(initialOrderPaymentLimit(1500, 0, 0), 1500);
  assert.equal(initialOrderPaymentLimit(1500, 800, 1700), 600);
});

test("cancellation reverses the sale while retaining its payment as advance", () => {
  const cancelled = order("Cancelled", "2026-03-01", 1000, 400);
  cancelled.previousDueAdjustment = {
    originalAmount: 0,
    adjustedAmount: 100,
    amount: 100,
    reason: "Manual balance correction",
  };

  assert.equal(customerDue([cancelled]), 0);
  assert.equal(customerAvailableAdvance([cancelled]), 400);
  assert.equal(cancelled.payments[0].amount, 400);
});

test("cancelling a paid order keeps its cash while prior-due payments stay applied", () => {
  const priorDue = order("Delivered", "2026-01-01", 2000, 1200);
  const cancelled = {
    ...order("Cancelled", "2026-03-01", 1000, 1200),
    payments: [{ amount: 1200, appliedToPreviousDue: 200 }],
    cancellationReversal: {
      date: "2026-03-02T10:00:00.000Z",
      orderAmount: 1000,
      adjustmentAmount: 0,
      releasedAdvance: 0,
      reason: "Order cancelled",
      owner: { name: "Owner" },
    },
  };

  assert.equal(customerDue([priorDue, cancelled]), 600);
  assert.equal(customerAvailableAdvance([priorDue, cancelled]), 1000);
  assert.equal(customerLedgerRows([priorDue, cancelled]).at(-1).balance, -400);
});

test("advance applications reduce available credit and cannot be reused", () => {
  const source = {
    ...order("Delivered", "2026-01-01", 1000, 1300),
    _id: "source",
  };
  const firstUse = {
    ...order("Pending", "2026-03-01", 200, 0),
    advanceApplications: [{ sourceOrderId: "source", amount: 250 }],
  };
  const secondUse = {
    ...order("Pending", "2026-03-02", 100, 0),
    advanceApplications: [{ sourceOrderId: "source", amount: 100 }],
  };

  assert.equal(customerAvailableAdvance([source, firstUse]), 50);
  assert.equal(customerAvailableAdvance([source, firstUse, secondUse]), 0);
});

test("ledger rows keep adjustment, advance use, and cancellation reversals auditable", () => {
  const cancelled = order("Cancelled", "2026-03-01", 1000, 400);
  cancelled.orderNumber = "KH-CANCELLED";
  cancelled.previousDueAdjustment = {
    originalAmount: 0,
    adjustedAmount: 100,
    amount: 100,
    date: "2026-03-01T10:00:00.000Z",
    reason: "Manual balance correction",
    owner: { name: "Owner" },
  };
  cancelled.cancellationReversal = {
    date: "2026-03-02T10:00:00.000Z",
    orderAmount: 1000,
    adjustmentAmount: 100,
    releasedAdvance: 0,
    reason: "Order cancelled",
    owner: { name: "Owner" },
  };
  const rows = customerLedgerRows([cancelled]);

  assert.ok(rows.some((row) => row.type === "Previous Due Adjustment"));
  assert.ok(rows.some((row) => row.type === "Adjustment Reversal"));
  assert.ok(rows.some((row) => row.type === "Cancellation Reversal"));
  assert.equal(rows.at(-1).balance, -400);
  assert.equal(
    rows.at(-1).balance,
    customerLedgerTotals([cancelled]).netBalance,
  );
  assert.equal(
    rows.find((row) => row.type === "Cancellation Reversal").date.toISOString(),
    "2026-03-02T10:00:00.000Z",
  );
  assert.equal(
    rows.find((row) => row.type === "Previous Due Adjustment").reason,
    "Manual balance correction",
  );
});

test("ledger order transaction uses creation time, not business order date", () => {
  const invoice = {
    ...order("Pending", "2025-01-01", 100),
    _id: "invoice-ledger",
    orderNumber: "KH-LEDGER-1",
    createdAt: "2026-04-02T09:00:00.000Z",
    payments: [
      {
        _id: "payment-ledger-1",
        amount: 40,
        paidAt: "2026-04-02T10:00:00.000Z",
        allocations: [{ targetOrder: "invoice-ledger", amount: 40 }],
      },
    ],
  };
  const rows = customerLedgerRows([invoice]);
  assert.deepEqual(
    rows.map((row) => row.type),
    ["Order", "Payment"],
  );
  assert.equal(rows[0].date.toISOString(), "2026-04-02T09:00:00.000Z");
  assert.equal(
    rows[0].businessOrderDate.toISOString(),
    "2025-01-01T00:00:00.000Z",
  );
});

test("multiple same-day payments sort by paidAt rather than embedded array order", () => {
  const invoice = {
    ...order("Pending", "2026-04-02", 300),
    _id: "same-day-order",
    orderNumber: "KH-SAME-DAY",
    createdAt: "2026-04-02T08:00:00.000Z",
    payments: [
      {
        _id: "later-payment",
        amount: 100,
        paidAt: "2026-04-02T12:00:00.000Z",
        allocations: [{ targetOrder: "same-day-order", amount: 100 }],
      },
      {
        _id: "earlier-payment",
        amount: 50,
        paidAt: "2026-04-02T09:00:00.000Z",
        allocations: [{ targetOrder: "same-day-order", amount: 50 }],
      },
    ],
  };
  const payments = customerLedgerRows([invoice]).filter(
    (row) => row.type === "Payment",
  );
  assert.deepEqual(
    payments.map((row) => row.reference),
    ["KH-SAME-DAY", "KH-SAME-DAY"],
  );
  assert.deepEqual(
    payments.map((row) => row.credit),
    [50, 100],
  );
  assert.deepEqual(
    payments.map((row) => row.date.toISOString()),
    ["2026-04-02T09:00:00.000Z", "2026-04-02T12:00:00.000Z"],
  );
});

test("order sorts before payment when their actual timestamps are identical", () => {
  const invoice = {
    ...order("Pending", "2026-04-02", 100),
    _id: "same-time-order",
    createdAt: "2026-04-02T10:00:00.000Z",
    payments: [
      {
        _id: "same-time-payment",
        amount: 20,
        paidAt: "2026-04-02T10:00:00.000Z",
        allocations: [{ targetOrder: "same-time-order", amount: 20 }],
      },
    ],
  };
  assert.deepEqual(
    customerLedgerRows([invoice]).map((row) => row.type),
    ["Order", "Payment"],
  );
});

test("adjustment and FIFO payment ledger rows preserve signed due and allocation references", () => {
  const first = {
    ...order("Delivered", "2026-04-01", 100),
    _id: "first-ledger-order",
    orderNumber: "KH-FIRST",
    createdAt: "2026-04-01T08:00:00.000Z",
    payments: [],
  };
  const second = {
    ...order("Pending", "2026-04-02", 100),
    _id: "second-ledger-order",
    orderNumber: "KH-SECOND",
    createdAt: "2026-04-02T08:00:00.000Z",
    previousDueAdjustment: {
      amount: -10,
      date: "2026-04-02T09:00:00.000Z",
      reason: "Old bill correction",
    },
    payments: [
      {
        _id: "fifo-ledger-payment",
        amount: 50,
        paidAt: "2026-04-02T10:00:00.000Z",
        allocations: [{ targetOrder: "first-ledger-order", amount: 50 }],
      },
    ],
  };
  const rows = customerLedgerRows([second, first]);
  const adjustment = rows.find((row) => row.type === "Previous Due Adjustment");
  const payment = rows.find((row) => row.type === "Payment");
  assert.equal(adjustment.date.toISOString(), "2026-04-02T09:00:00.000Z");
  assert.equal(adjustment.credit, 10);
  assert.equal(payment.allocations[0].targetReference, "KH-FIRST");
  assert.equal(payment.allocations[0].allocationType, "explicit");
  assert.equal(
    rows.at(-1).balance,
    customerLedgerTotals([first, second]).netBalance,
  );
});

test("ledger preserves allocation references when one payment spans multiple invoices", () => {
  const first = {
    ...order("Delivered", "2026-04-01", 80),
    _id: "ledger-fifo-first",
    orderNumber: "KH-FIFO-1",
    createdAt: "2026-04-01T08:00:00.000Z",
    payments: [],
  };
  const second = {
    ...order("Pending", "2026-04-02", 60),
    _id: "ledger-fifo-second",
    orderNumber: "KH-FIFO-2",
    createdAt: "2026-04-02T08:00:00.000Z",
    payments: [
      {
        _id: "ledger-fifo-receipt",
        amount: 100,
        paidAt: "2026-04-02T09:00:00.000Z",
        allocations: [
          { targetOrder: "ledger-fifo-first", amount: 80 },
          { targetOrder: "ledger-fifo-second", amount: 20 },
        ],
      },
    ],
  };
  const rows = customerLedgerRows([second, first]);
  const payment = rows.find((row) => row.type === "Payment");
  assert.deepEqual(
    payment.allocations.map((allocation) => [
      allocation.targetReference,
      allocation.amount,
    ]),
    [
      ["KH-FIFO-1", 80],
      ["KH-FIFO-2", 20],
    ],
  );
  assert.equal(
    rows.at(-1).balance,
    customerLedgerTotals([first, second]).netBalance,
  );
});

test("advance application is informational and does not change customer running balance twice", () => {
  const source = {
    ...order("Delivered", "2026-04-01", 100, 150),
    _id: "advance-ledger-source",
    orderNumber: "KH-ADVANCE-SOURCE",
    createdAt: "2026-04-01T08:00:00.000Z",
    payments: [
      {
        _id: "advance-payment",
        amount: 150,
        paidAt: "2026-04-01T09:00:00.000Z",
      },
    ],
  };
  const target = {
    ...order("Pending", "2026-04-02", 100),
    _id: "advance-ledger-target",
    orderNumber: "KH-ADVANCE-TARGET",
    createdAt: "2026-04-02T08:00:00.000Z",
    advanceApplications: [
      {
        sourceOrder: "advance-ledger-source",
        amount: 50,
        appliedAt: "2026-04-02T09:00:00.000Z",
      },
    ],
  };
  const rows = customerLedgerRows([source, target]);
  const application = rows.find((row) => row.type === "Advance Application");
  assert.ok(application);
  assert.equal(application.amount, 50);
  assert.equal(application.debit, 0);
  assert.equal(application.credit, 0);
  assert.equal(
    rows.at(-1).balance,
    customerLedgerTotals([source, target]).netBalance,
  );
});

test("legacy payment without paidAt uses its own creation timestamp", () => {
  const invoice = {
    ...order("Pending", "2025-01-01", 100),
    _id: "legacy-date-order",
    createdAt: "2026-04-02T08:00:00.000Z",
    payments: [
      {
        _id: "legacy-payment-id",
        amount: 20,
        createdAt: "2026-04-02T09:00:00.000Z",
      },
    ],
  };
  const rows = customerLedgerRows([invoice]);
  const payment = rows.find((row) => row.type === "Payment");
  assert.equal(payment.date.toISOString(), "2026-04-02T09:00:00.000Z");
  assert.equal(rows.at(-1).balance, customerLedgerTotals([invoice]).netBalance);
});

test("missing and invalid transaction timestamps remain undated and balances still reconcile", () => {
  const invoice = {
    ...order("Pending", "2025-01-01", 100),
    _id: "unknown-time-order",
    createdAt: "not-a-date",
    payments: [
      {
        _id: "unknown-time-payment",
        amount: 20,
        paidAt: "also-not-a-date",
        createdAt: "invalid",
        allocations: [{ targetOrder: "unknown-time-order", amount: 20 }],
      },
    ],
  };
  const rows = customerLedgerRows([invoice]);
  assert.equal(rows[0].date, null);
  assert.equal(rows[1].date, null);
  assert.equal(rows.at(-1).balance, customerLedgerTotals([invoice]).netBalance);
});

test("previous unpaid date identifies the oldest still-open order", () => {
  assert.equal(
    previousUnpaidDate([
      order("Delivered", "2026-03-01", 100, 100),
      order("Pending", "2026-03-03", 100, 0),
      order("Delivered", "2026-03-02", 100, 50),
      order("Cancelled", "2026-02-01", 100, 0),
    ]),
    "2026-03-02",
  );
});

test("money validation rejects negative, excessive precision, and non-finite values", () => {
  assert.equal(isValidMoney(0), true);
  assert.equal(isValidMoney("700.50"), true);
  assert.equal(isValidMoney(-1), false);
  assert.equal(isValidMoney("1.001"), false);
  assert.equal(isValidMoney("Infinity"), false);
});

test("order and payment retry keys are unique so retries cannot duplicate ledger entries", () => {
  const requestId = Order.schema.path("requestId");
  const paymentSchema = Order.schema.path("payments").schema;
  assert.equal(requestId.options.unique, true);
  assert.equal(requestId.options.sparse, true);
  assert.equal(paymentSchema.path("idempotencyKey").options.type, String);
  assert.equal(paymentSchema.path("appliedToPreviousDue").options.default, 0);
  assert.ok(paymentSchema.path("allocations"));
});

test("FIFO projection applies explicit allocations across orders and keeps paid orders", () => {
  const first = {
    ...order("Delivered", "2026-03-01", 80),
    _id: "order-1",
    createdAt: "2026-03-01T10:00:00.000Z",
    payments: [],
  };
  const second = {
    ...order("Pending", "2026-03-02", 60),
    _id: "order-2",
    createdAt: "2026-03-02T10:00:00.000Z",
    payments: [
      {
        _id: "payment-1",
        amount: 100,
        paidAt: "2026-03-02T11:00:00.000Z",
        allocations: [
          { targetOrder: "order-1", amount: 80 },
          { targetOrder: "order-2", amount: 20 },
        ],
      },
    ],
  };

  const projection = calculateFifoAccounting([second, first]);
  assert.equal(projection.balances.get("order-1"), 0);
  assert.equal(projection.balances.get("order-2"), 40);
  assert.equal(projection.due, 40);
  assert.equal(
    projection.allocations.every(
      (entry) => entry.allocationType === "explicit",
    ),
    true,
  );
});

test("one unpaid order becomes paid with a payment equal to its balance", () => {
  const invoice = {
    ...order("Pending", "2026-03-01", 80),
    _id: "single-order",
    payments: [],
  };
  const before = calculateFifoAccounting([invoice]);
  assert.equal(before.due, 80);
  const paid = {
    ...invoice,
    payments: [
      {
        _id: "single-payment",
        amount: 80,
        allocations: [{ targetOrder: "single-order", amount: 80 }],
      },
    ],
  };
  const after = calculateFifoAccounting([paid]);
  assert.equal(after.balances.get("single-order"), 0);
  assert.equal(after.due, 0);
});

test("a payment exactly covering the oldest invoice leaves only newer invoices due", () => {
  const oldest = {
    ...order("Delivered", "2026-03-01", 80),
    _id: "oldest",
    payments: [],
  };
  const newer = {
    ...order("Pending", "2026-03-02", 60),
    _id: "newer",
    payments: [],
  };
  const allocations = fifoPaymentAllocations([newer, oldest], 80);
  assert.deepEqual(allocations, [{ targetOrder: "oldest", amount: 80 }]);
  const receipt = { ...newer, payments: [{ amount: 80, allocations }] };
  const result = calculateFifoAccounting([oldest, receipt]);
  assert.equal(result.balances.get("oldest"), 0);
  assert.equal(result.balances.get("newer"), 60);
});

test("payment allocation plan spans oldest balances and exactly equals the receipt", () => {
  const first = {
    ...order("Delivered", "2026-03-01", 80),
    _id: "order-1",
    createdAt: "2026-03-01T10:00:00.000Z",
    payments: [],
  };
  const second = {
    ...order("Pending", "2026-03-02", 60),
    _id: "order-2",
    createdAt: "2026-03-02T10:00:00.000Z",
    payments: [],
  };
  const allocations = fifoPaymentAllocations([second, first], 100);
  assert.deepEqual(allocations, [
    { targetOrder: "order-1", amount: 80 },
    { targetOrder: "order-2", amount: 20 },
  ]);
  assert.equal(
    allocations.reduce((sum, row) => sum + row.amount, 0),
    100,
  );
  assert.throws(() => fifoPaymentAllocations([first, second], 141));
});

test("partial payment stays with the oldest invoice when it does not cover it", () => {
  const first = {
    ...order("Pending", "2026-03-01", 80),
    _id: "order-1",
    payments: [],
  };
  const second = {
    ...order("Pending", "2026-03-02", 60),
    _id: "order-2",
    payments: [],
  };
  const allocations = fifoPaymentAllocations([first, second], 40);
  assert.deepEqual(allocations, [{ targetOrder: "order-1", amount: 40 }]);
  const afterPayment = {
    ...first,
    payments: [{ amount: 40, allocations }],
  };
  assert.equal(
    calculateFifoAccounting([afterPayment, second]).balances.get("order-1"),
    40,
  );
  assert.equal(
    calculateFifoAccounting([afterPayment, second]).balances.get("order-2"),
    60,
  );
});

test("initial payment on a new order allocates previous invoices before the new invoice", () => {
  const previous = {
    ...order("Delivered", "2026-03-01", 80),
    _id: "previous",
    payments: [],
  };
  const current = {
    ...order("Pending", "2026-03-02", 60),
    _id: "current",
    payments: [],
  };
  current.payments = [
    {
      _id: "initial-payment",
      amount: 100,
      paidAt: "2026-03-02T10:00:00.000Z",
      allocations: fifoPaymentAllocations([previous, current], 100),
    },
  ];
  const result = calculateFifoAccounting([previous, current]);
  assert.equal(result.balances.get("previous"), 0);
  assert.equal(result.balances.get("current"), 40);
});

test("advance exceeding the new invoice reduces older outstanding invoices", () => {
  const previous = {
    ...order("Delivered", "2026-01-01", 2000, 1200),
    _id: "previous",
  };
  const advanceSource = {
    ...order("Delivered", "2026-01-02", 2000, 3700),
    _id: "source",
  };
  const current = {
    ...order("Pending", "2026-03-01", 1500),
    _id: "current",
    advanceApplications: [
      {
        sourceOrder: "source",
        amount: 1700,
        appliedAt: "2026-03-01T10:00:00.000Z",
      },
    ],
  };
  const result = calculateFifoAccounting([previous, advanceSource, current]);
  assert.equal(result.balances.get("previous"), 600);
  assert.equal(result.balances.get("current"), 0);
  assert.equal(result.availableAdvance, 0);
});

test("equal order dates use creation time and order ID for stable FIFO", () => {
  const laterId = {
    ...order("Pending", "2026-03-01", 80),
    _id: "z-order",
    createdAt: "2026-03-01T10:00:00.000Z",
    payments: [],
  };
  const earlierId = {
    ...order("Pending", "2026-03-01", 60),
    _id: "a-order",
    createdAt: "2026-03-01T10:00:00.000Z",
    payments: [],
  };
  assert.deepEqual(fifoPaymentAllocations([laterId, earlierId], 40), [
    { targetOrder: "a-order", amount: 40 },
  ]);
});

test("duplicate payment idempotency keys resolve to the original order without a second posting", () => {
  const receipt = {
    ...order("Pending", "2026-03-01", 100, 40),
    _id: "receipt-order",
    payments: [
      {
        amount: 40,
        idempotencyKey: "request-1",
        allocations: [{ targetOrder: "receipt-order", amount: 40 }],
      },
    ],
  };
  assert.equal(findPaymentByIdempotencyKey([receipt], "request-1"), receipt);
  assert.equal(findPaymentByIdempotencyKey([receipt], "new-request"), null);
  assert.equal(receipt.payments.length, 1);
  assert.equal(receipt.payments[0].amount, 40);
});

test("due adjustment is applied before a later FIFO payment", () => {
  const first = {
    ...order("Delivered", "2026-03-01", 100),
    _id: "first",
    payments: [],
  };
  const second = {
    ...order("Pending", "2026-03-02", 100),
    _id: "second",
    previousDueAdjustment: { amount: -20, date: "2026-03-02T10:00:00.000Z" },
    payments: [
      {
        _id: "payment-adjusted",
        amount: 50,
        paidAt: "2026-03-02T11:00:00.000Z",
        allocations: [{ targetOrder: "first", amount: 50 }],
      },
    ],
  };
  const result = calculateFifoAccounting([first, second]);
  assert.equal(result.balances.get("first"), 30);
  assert.equal(result.balances.get("second"), 100);
  assert.equal(result.due, 130);
});

test("legacy appliedToPreviousDue is reconstructed FIFO without changing the stored payment", () => {
  const first = {
    ...order("Delivered", "2026-03-01", 80),
    _id: "order-1",
    createdAt: "2026-03-01T10:00:00.000Z",
    payments: [],
  };
  const second = {
    ...order("Pending", "2026-03-02", 60),
    _id: "order-2",
    createdAt: "2026-03-02T10:00:00.000Z",
    payments: [
      {
        _id: "payment-legacy",
        amount: 100,
        appliedToPreviousDue: 80,
        paidAt: "2026-03-02T11:00:00.000Z",
      },
    ],
  };

  const projection = calculateFifoAccounting([second, first]);
  assert.equal(projection.balances.get("order-1"), 0);
  assert.equal(projection.balances.get("order-2"), 40);
  assert.equal(
    projection.legacyAllocations.every(
      (entry) => entry.allocationType === "reconstructed-legacy",
    ),
    true,
  );
  assert.equal(second.payments[0].allocations, undefined);
  assert.equal(second.payments[0].amount, 100);
});

test("cancellation records an allocation reversal and an auditable replacement FIFO allocation", () => {
  const cancelled = {
    ...order("Cancelled", "2026-03-01", 80),
    _id: "order-1",
    createdAt: "2026-03-01T10:00:00.000Z",
    payments: [],
    cancellationReversal: {
      date: "2026-03-03T10:00:00.000Z",
      orderAmount: 80,
      adjustmentAmount: 0,
      releasedAdvance: 0,
      reversedAllocations: [
        {
          paymentOrderId: "order-2",
          paymentId: "payment-1",
          targetOrder: "order-1",
          amount: 80,
        },
      ],
      replacementAllocations: [
        {
          paymentOrderId: "order-2",
          paymentId: "payment-1",
          targetOrder: "order-2",
          amount: 40,
          date: "2026-03-03T10:00:00.000Z",
        },
      ],
    },
  };
  const second = {
    ...order("Pending", "2026-03-02", 60),
    _id: "order-2",
    createdAt: "2026-03-02T10:00:00.000Z",
    payments: [
      {
        _id: "payment-1",
        amount: 100,
        paidAt: "2026-03-02T11:00:00.000Z",
        allocations: [
          { targetOrder: "order-1", amount: 80 },
          { targetOrder: "order-2", amount: 20 },
        ],
      },
    ],
  };

  const projection = calculateFifoAccounting([cancelled, second]);
  assert.equal(projection.balances.get("order-2"), 0);
  assert.equal(projection.due, 0);
  assert.equal(projection.availableAdvance, 40);
  assert.ok(
    projection.allocations.some(
      (row) => row.allocationType === "cancellation-replacement",
    ),
  );
  assert.equal(second.payments[0].amount, 100);
  assert.equal(second.payments[0].allocations[0].amount, 80);
});

test("customers sort by highest due, then newest customer", () => {
  const customers = [
    { balance: 50, createdAt: "2026-03-01" },
    { balance: 100, createdAt: "2026-03-01" },
    { balance: 100, createdAt: "2026-03-05" },
    { balance: 0, createdAt: "2026-03-06" },
  ];

  customers.sort(compareCustomers);

  assert.deepEqual(
    customers.map((item) => `${item.balance}:${item.createdAt}`),
    ["100:2026-03-05", "100:2026-03-01", "50:2026-03-01", "0:2026-03-06"],
  );
});

test("dashboard filters today payments, today orders, and pending deliveries", () => {
  const orders = [
    {
      ...order("Pending", "2026-03-05T05:00:00.000Z", 100, 25),
      orderNumber: "KH-1",
      customer: { name: "Asha" },
      payments: [
        { amount: 25, method: "UPI", paidAt: "2026-03-05T06:00:00.000Z" },
      ],
    },
    {
      ...order("Delivered", "2026-03-05T10:00:00.000Z"),
      orderNumber: "KH-2",
      customer: { name: "Bina" },
      payments: [],
    },
    {
      ...order("Cancelled", "2026-03-05T10:00:00.000Z"),
      orderNumber: "KH-3",
      customer: { name: "Chetan" },
      payments: [
        { amount: 40, method: "Cash", paidAt: "2026-03-05T06:00:00.000Z" },
      ],
    },
  ];

  assert.equal(ordersForDate(orders, "2026-03-05").length, 2);
  assert.deepEqual(
    paymentRowsForDate(orders, "2026-03-05").map((row) => ({
      customer: row.customer.name,
      amount: row.amount,
      method: row.method,
      reference: row.reference,
    })),
    [
      { customer: "Asha", amount: 25, method: "UPI", reference: "KH-1" },
      { customer: "Chetan", amount: 40, method: "Cash", reference: "KH-3" },
    ],
  );
  assert.equal(pendingDeliveryOrders(orders).length, 1);
});

test("date-range customer ledger CSV balances reconcile and expose no internal fields", () => {
  const older = {
    ...order("Delivered", "2026-06-01", 200),
    _id: "csv-order-old",
    orderNumber: "KH-CSV-OLD",
    createdAt: "2026-06-01T04:00:00.000Z",
    payments: [
      {
        _id: "csv-payment-old",
        amount: 50,
        paidAt: "2026-06-01T05:00:00.000Z",
        allocations: [{ targetOrder: "csv-order-old", amount: 50 }],
        method: "UPI",
        reference: "UPI-OLD-123",
        idempotencyKey: "private-old-key",
        recordedBy: {
          id: "owner-id",
          name: "Owner Name",
          email: "owner@example.test",
        },
      },
    ],
  };
  const newer = {
    ...order("Pending", "2026-06-03", 100),
    _id: "csv-order-new",
    orderNumber: "KH-CSV-NEW",
    createdAt: "2026-06-03T04:00:00.000Z",
    payments: [
      {
        _id: "csv-payment-new",
        amount: 80,
        paidAt: "2026-06-03T05:00:00.000Z",
        reference: "CASH-NEW-456",
        allocations: [
          { targetOrder: "csv-order-old", amount: 50 },
          { targetOrder: "csv-order-new", amount: 30 },
        ],
      },
    ],
  };
  const customer = { name: "Asha Shop", phone: "9876543210" };
  const range = parseIndiaDateRange("2026-06-02", "2026-06-04");
  const statement = buildCustomerLedgerExport([older, newer], customer, range);
  assert.equal(statement.openingBalance, 150);
  assert.equal(statement.totalDebit, 100);
  assert.equal(statement.totalCredit, 80);
  assert.equal(statement.closingBalance, 170);
  assert.equal(
    statement.openingBalance + statement.totalDebit - statement.totalCredit,
    statement.closingBalance,
  );
  const serialized = JSON.stringify(statement.rows);
  assert.match(serialized, /CASH-NEW-456/);
  const transactionRow = statement.rows.find((row) => row[0] === "Transaction");
  assert.match(transactionRow[1], /\+05:30$/);
  assert.equal(
    statement.rows.every((row) => row.length === statement.rows[0].length),
    true,
  );
  assert.doesNotMatch(
    serialized,
    /owner-id|owner@example\.test|private-old-key|recordedBy/i,
  );
  assert.equal(
    statement.availableAdvance,
    customerLedgerTotals([older, newer]).availableAdvance,
  );
});

test("internal payment CSV keeps each receipt amount once and allocation detail sums exactly", () => {
  const first = {
    ...order("Delivered", "2026-06-01", 80),
    _id: "internal-order-1",
    orderNumber: "KH-INTERNAL-1",
    createdAt: "2026-06-01T04:00:00.000Z",
    payments: [],
  };
  const second = {
    ...order("Pending", "2026-06-02", 60),
    _id: "internal-order-2",
    orderNumber: "KH-INTERNAL-2",
    createdAt: "2026-06-02T04:00:00.000Z",
    payments: [
      {
        _id: "internal-payment-1",
        amount: 100,
        paidAt: "2026-06-02T05:00:00.000Z",
        method: "Cash",
        reference: "CASH-100",
        idempotencyKey: "retry-100",
        recordedBy: {
          id: "owner-1",
          name: "Owner",
          email: "owner@example.test",
        },
        allocations: [
          { targetOrder: "internal-order-1", amount: 80 },
          { targetOrder: "internal-order-2", amount: 20 },
        ],
      },
    ],
  };
  const before = structuredClone([first, second]);
  const exportRows = paymentDetailsExportRows([first, second]);
  const amountColumn = paymentDetailsHeaders.indexOf("Payment Amount INR");
  const allocationColumn = paymentDetailsHeaders.indexOf(
    "Allocation Details JSON",
  );
  const ownerColumn = paymentDetailsHeaders.indexOf("Recorded By Name");
  const paymentRows = exportRows.filter((row) => row[0] === "Payment");
  assert.equal(paymentRows.length, 1);
  assert.equal(
    exportRows.every((row) => row.length === paymentDetailsHeaders.length),
    true,
  );
  assert.equal(paymentRows[0][amountColumn], 100);
  assert.equal(
    JSON.parse(paymentRows[0][allocationColumn]).reduce(
      (sum, allocation) => sum + allocation.amount,
      0,
    ),
    100,
  );
  assert.equal(paymentRows[0][ownerColumn], "Owner");
  assert.equal(paymentDetailsHeaders.includes("Idempotency Key"), true);
  assert.equal(
    paymentDetailsHeaders.includes("Reversed Allocations JSON"),
    true,
  );
  assert.deepEqual(
    [first, second],
    before,
    "export must not mutate source records",
  );
});

test("customer ledger CSV separates available advance from outstanding due", () => {
  const credit = {
    ...order("Delivered", "2026-06-01", 100, 150),
    _id: "csv-credit-order",
    createdAt: "2026-06-01T04:00:00.000Z",
    payments: [
      {
        _id: "csv-credit-payment",
        amount: 150,
        paidAt: "2026-06-01T05:00:00.000Z",
      },
    ],
  };
  const due = {
    ...order("Pending", "2026-06-02", 100),
    _id: "csv-due-order",
    createdAt: "2026-06-02T04:00:00.000Z",
    payments: [],
  };
  const statement = buildCustomerLedgerExport([credit, due], {
    name: "Asha Shop",
  });
  assert.equal(statement.closingBalance, 50);
  assert.equal(statement.availableAdvance, 50);
  assert.equal(customerLedgerTotals([credit, due]).due, 100);
  assert.equal(customerLedgerTotals([credit, due]).netBalance, 50);
});

test("date range parser uses inclusive India dates and rejects invalid or reversed periods", () => {
  const range = parseIndiaDateRange("2026-06-01", "2026-06-02");
  assert.equal(new Date(range.start).toISOString(), "2026-05-31T18:30:00.000Z");
  assert.equal(
    new Date(range.endExclusive).toISOString(),
    "2026-06-02T18:30:00.000Z",
  );
  assert.throws(
    () => parseIndiaDateRange("2026-02-30", "2026-03-01"),
    /valid start date/,
  );
  assert.throws(
    () => parseIndiaDateRange("2026-06-03", "2026-06-02"),
    /on or before/,
  );
});

test("date-filtered CSV refuses to invent a date for an undated transaction", () => {
  const legacyOrder = {
    ...order("Pending", "2026-01-01", 100),
    _id: "unknown-csv-timestamp",
    createdAt: "invalid",
    payments: [],
  };
  assert.throws(
    () =>
      buildCustomerLedgerExport(
        [legacyOrder],
        { name: "Legacy Customer" },
        parseIndiaDateRange("2026-06-01", "2026-06-30"),
      ),
    (error) =>
      error.statusCode === 422 &&
      /without reliable timestamps/.test(error.message),
  );
});
