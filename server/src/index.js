import "dotenv/config";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import helmet from "helmet";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Customer, Order, Owner } from "./models.js";
import {
  buildCustomerLedgerExport,
  parseIndiaDateRange,
  paymentDetailsExportRows,
  paymentDetailsHeaders,
} from "./exports.js";
import { requireAuth } from "./auth.js";
import {
  compareCustomers,
  compareOrders,
  customerDue,
  customerAdvanceSources,
  customerLedgerRows,
  customerLedgerTotals,
  calculateFifoAccounting,
  customerPaymentDueSnapshot,
  fifoPaymentAllocations,
  findPaymentByIdempotencyKey,
  INVALID_MOBILE_MESSAGE,
  DUPLICATE_CUSTOMER_PHONE_MESSAGE,
  isValidMoney,
  isValidIndianMobile,
  normalizeIndianMobile,
  initialOrderPaymentLimit,
  orderDue,
  orderPaymentValidationError,
  orderPaid,
  orderTotal,
  previousUnpaidDate,
} from "./business.js";

const app = express();
const PORT = Number(process.env.PORT || 5000);
const processStartedAt = performance.now();

function writePerformanceLog(fields) {
  console.info(
    JSON.stringify({ timestamp: new Date().toISOString(), ...fields }),
  );
}

function measureOperation(req, name, operation) {
  const startedAt = performance.now();
  return Promise.resolve()
    .then(operation)
    .finally(() => {
      req.performanceTimings[name] = Number(
        (performance.now() - startedAt).toFixed(2),
      );
    });
}

function performanceEndpoint(method, path) {
  if (method === "POST" && path === "/api/auth/login") return "POST /api/auth/login";
  if (method === "GET" && path === "/api/dashboard") return "GET /api/dashboard";
  if (method === "PATCH" && /^\/api\/orders\/[^/]+\/delivery$/.test(path))
    return "PATCH /api/orders/:id/delivery";
  if (method === "POST" && /^\/api\/orders\/[^/]+\/payments$/.test(path))
    return "POST /api/orders/:id/payments";
  if (method === "POST" && /^\/api\/customers\/[^/]+\/payments$/.test(path))
    return "POST /api/customers/:id/payments";
  if (method === "GET" && /^\/api\/customers\/[^/]+\/ledger$/.test(path))
    return "GET /api/customers/:id/ledger";
  return null;
}

app.use(helmet());
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN
      ? process.env.CLIENT_ORIGIN.split(",").map((s) => s.trim())
      : "http://localhost:5173",
  }),
);
app.use((req, res, next) => {
  const suppliedId = req.get("x-request-id");
  req.requestId =
    suppliedId && /^[0-9a-f-]{36}$/i.test(suppliedId)
      ? suppliedId
      : randomUUID();
  req.performanceStartedAt = performance.now();
  req.performanceTimings = {};
  res.setHeader("X-Request-ID", req.requestId);
  res.on("finish", () => {
    const endpoint = performanceEndpoint(req.method, req.path);
    if (!endpoint) return;
    writePerformanceLog({
      event: "api.performance",
      requestId: req.requestId,
      endpoint,
      durationMs: Number(
        (performance.now() - req.performanceStartedAt).toFixed(2),
      ),
      status: res.statusCode,
      operationTimings: req.performanceTimings,
    });
  });
  next();
});
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) =>
  res.json({ ok: true, app: "KAJAL H2O Business Manager" }),
);

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const email = String(req.body.email || "")
      .toLowerCase()
      .trim();
    const password = String(req.body.password || "");

    const owner = await measureOperation(req, "ownerLookupMs", () =>
      Owner.findOne({ email }),
    );
    const isPasswordMatch = await measureOperation(req, "passwordVerifyMs", () =>
      bcrypt.compare(password, owner?.passwordHash),
    );

    if (!owner || !isPasswordMatch) {
      return res
        .status(401)
        .json({ message: "Email or password is incorrect." });
    }
    const token = await measureOperation(req, "jwtSignMs", () =>
      jwt.sign(
        { sub: owner._id.toString(), email: owner.email, name: owner.name },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || "12h" },
      ),
    );
    res.json({ token, owner: { name: owner.name, email: owner.email } });
  } catch (e) {
    next(e);
  }
});

app.use("/api", requireAuth);

app.get("/api/dashboard", async (_req, res, next) => {
  try {
    const [
      customerCount,
      summary,
      recentOrders,
      activeCustomers,
      ledgerOrders,
    ] = await Promise.all([
      Customer.countDocuments({ active: true }),
      Order.aggregate([
        {
          $project: {
            orderDate: 1,
            deliveryStatus: 1,
            isActiveSale: { $ne: ["$deliveryStatus", "Cancelled"] },
            total: {
              $sum: {
                $map: {
                  input: { $ifNull: ["$items", []] },
                  as: "item",
                  in: { $multiply: ["$$item.quantity", "$$item.unitPrice"] },
                },
              },
            },
            paid: { $sum: { $ifNull: ["$payments.amount", []] } },
            todayCollected: {
              $sum: {
                $map: {
                  input: {
                    $filter: {
                      input: { $ifNull: ["$payments", []] },
                      as: "payment",
                      cond: {
                        $eq: [
                          {
                            $dateToString: {
                              date: "$$payment.paidAt",
                              format: "%Y-%m-%d",
                              timezone: "Asia/Kolkata",
                            },
                          },
                          {
                            $dateToString: {
                              date: "$$NOW",
                              format: "%Y-%m-%d",
                              timezone: "Asia/Kolkata",
                            },
                          },
                        ],
                      },
                    },
                  },
                  as: "payment",
                  in: "$$payment.amount",
                },
              },
            },
            isToday: {
              $eq: [
                {
                  $dateToString: {
                    date: "$orderDate",
                    format: "%Y-%m-%d",
                    timezone: "Asia/Kolkata",
                  },
                },
                {
                  $dateToString: {
                    date: "$$NOW",
                    format: "%Y-%m-%d",
                    timezone: "Asia/Kolkata",
                  },
                },
              ],
            },
            isThisMonth: {
              $eq: [
                {
                  $dateToString: {
                    date: "$orderDate",
                    format: "%Y-%m",
                    timezone: "Asia/Kolkata",
                  },
                },
                {
                  $dateToString: {
                    date: "$$NOW",
                    format: "%Y-%m",
                    timezone: "Asia/Kolkata",
                  },
                },
              ],
            },
          },
        },
        {
          $group: {
            _id: null,
            todaySales: {
              $sum: {
                $cond: [{ $and: ["$isToday", "$isActiveSale"] }, "$total", 0],
              },
            },
            monthlySales: {
              $sum: {
                $cond: [
                  { $and: ["$isThisMonth", "$isActiveSale"] },
                  "$total",
                  0,
                ],
              },
            },
            todayOrders: {
              $sum: {
                $cond: [{ $and: ["$isToday", "$isActiveSale"] }, 1, 0],
              },
            },
            totalCollection: { $sum: "$paid" },
            todayCollected: { $sum: "$todayCollected" },
            pendingDeliveries: {
              $sum: { $cond: [{ $eq: ["$deliveryStatus", "Pending"] }, 1, 0] },
            },
          },
        },
      ]),
      Order.find({ deliveryStatus: { $ne: "Cancelled" } })
        .populate("customer", "name phone")
        .sort({ orderDate: -1 })
        .limit(6)
        .lean(),
      Customer.find({ active: true }).select("_id").lean(),
      Order.find().lean(),
    ]);
    const metrics = summary[0] || {};
    const activeCustomerIds = new Set(
      activeCustomers.map((customer) => String(customer._id)),
    );
    const ordersByCustomer = new Map();
    for (const order of ledgerOrders) {
      const customerId = String(order.customer);
      if (!activeCustomerIds.has(customerId)) continue;
      const customerOrders = ordersByCustomer.get(customerId) || [];
      customerOrders.push(order);
      ordersByCustomer.set(customerId, customerOrders);
    }
    const totalDue = [...ordersByCustomer.values()].reduce(
      (sum, customerOrders) => sum + customerDue(customerOrders),
      0,
    );
    const recentWithBalances = recentOrders.map((order) => {
      const customerId = String(order.customer?._id || order.customer);
      return withTotals(order, ordersByCustomer.get(customerId) || [order]);
    });
    res.json({
      customerCount,
      todaySales: metrics.todaySales || 0,
      monthlySales: metrics.monthlySales || 0,
      totalCollection: metrics.totalCollection || 0,
      todayCollected: metrics.todayCollected || 0,
      totalDue,
      todayOrders: metrics.todayOrders || 0,
      pendingDeliveries: metrics.pendingDeliveries || 0,
      recentOrders: recentWithBalances,
    });
  } catch (e) {
    next(e);
  }
});

// Customers
app.get("/api/customers", async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    const filter = q
      ? {
          active: true,
          $or: [
            { name: { $regex: escapeRegex(q), $options: "i" } },
            { phone: { $regex: escapeRegex(q) } },
            { address: { $regex: escapeRegex(q), $options: "i" } },
          ],
        }
      : { active: true };
    const customers = await Customer.find(filter)
      .select(
        "name phone whatsappPhone type address notes active createdAt updatedAt",
      )
      .lean();
    const ids = customers.map((c) => c._id);
    const orders = await Order.find({
      customer: { $in: ids },
    }).lean();
    const ordersByCustomer = new Map();
    for (const o of orders) {
      const customerOrders = ordersByCustomer.get(String(o.customer)) || [];
      customerOrders.push(o);
      ordersByCustomer.set(String(o.customer), customerOrders);
    }
    const result = customers.map((c) => {
      const totals = customerLedgerTotals(
        ordersByCustomer.get(String(c._id)) || [],
      );
      return {
        ...c,
        balance: totals.due,
        availableAdvance: totals.availableAdvance,
        lifetimeSales: totals.sales,
      };
    });
    result.sort(compareCustomers);
    res.json(result);
  } catch (e) {
    next(e);
  }
});
app.post("/api/customers", async (req, res, next) => {
  try {
    const { name } = req.body;
    const phone = normalizeIndianMobile(req.body.phone);
    if (!String(name || "").trim())
      return res
        .status(400)
        .json({ message: "Customer name is required." });
    if (phone && !isValidIndianMobile(phone))
      return res.status(400).json({ message: INVALID_MOBILE_MESSAGE });
    if (phone && await Customer.exists({ phone, active: true }))
      return res.status(409).json({ message: DUPLICATE_CUSTOMER_PHONE_MESSAGE });
    const customer = await Customer.create(sanitizeCustomer({ ...req.body, phone }));
    res.status(201).json(customer);
  } catch (e) {
    next(e);
  }
});
app.put("/api/customers/:id", async (req, res, next) => {
  try {
    const phone = normalizeIndianMobile(req.body.phone);
    if (phone && !isValidIndianMobile(phone))
      return res.status(400).json({ message: INVALID_MOBILE_MESSAGE });
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(404).json({ message: "Customer not found." });
    if (phone && await Customer.exists({
      phone,
      active: true,
      _id: { $ne: req.params.id },
    })) return res.status(409).json({ message: DUPLICATE_CUSTOMER_PHONE_MESSAGE });
    const customer = await Customer.findByIdAndUpdate(
      req.params.id,
      sanitizeCustomer({ ...req.body, phone }),
      { new: true, runValidators: true },
    );
    if (!customer)
      return res.status(404).json({ message: "Customer not found." });
    res.json(customer);
  } catch (e) {
    next(e);
  }
});
app.delete("/api/customers/:id", async (req, res, next) => {
  try {
    const customer = await Customer.findByIdAndUpdate(
      req.params.id,
      { active: false },
      { new: true },
    );
    if (!customer)
      return res.status(404).json({ message: "Customer not found." });
    res.json({ message: "Customer archived." });
  } catch (e) {
    next(e);
  }
});

// Orders and ledger
app.get("/api/customers/:id/account-summary", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(400).json({ message: "Choose a valid customer." });
    const customer = await Customer.findOne({
      _id: req.params.id,
      active: true,
    }).lean();
    if (!customer)
      return res.status(404).json({ message: "Active customer not found." });
    const orders = await Order.find({ customer: customer._id }).lean();
    const totals = customerLedgerTotals(orders);
    res.json({
      customerId: String(customer._id),
      previousDue: totals.due,
      previousUnpaidDate: previousUnpaidDate(orders),
      availableAdvance: totals.availableAdvance,
    });
  } catch (e) {
    next(e);
  }
});

app.get("/api/orders", async (_req, res, next) => {
  try {
    const orders = await Order.find()
      .populate("customer", "name phone whatsappPhone address")
      .lean();
    orders.sort(compareOrders);
    const ordersByCustomer = groupOrdersByCustomer(orders);
    res.json(
      orders.map((order) =>
        withTotals(
          order,
          ordersByCustomer.get(
            String(order.customer?._id || order.customer),
          ) || [order],
        ),
      ),
    );
  } catch (e) {
    next(e);
  }
});
app.post("/api/orders", async (req, res, next) => {
  try {
    const { customerId, items } = req.body;
    if (!mongoose.isValidObjectId(customerId))
      return res.status(400).json({ message: "Choose a valid customer." });
    const normalizedItems = normalizeItems(items);
    if (!normalizedItems.length)
      return res
        .status(400)
        .json({ message: "Add at least one valid order item." });

    const deliveryShift = req.body.deliveryShift || "Day";

    if (!["Day", "Night"].includes(deliveryShift)) {
      return res.status(400).json({
        message: "Delivery shift must be Day or Night.",
      });
    }

    const requestId = String(req.body.requestId || "").trim();
    if (!requestId || requestId.length > 100)
      return res
        .status(400)
        .json({ message: "A valid order request ID is required." });
    const existing = await Order.findOne({ requestId }).populate(
      "customer",
      "name phone whatsappPhone address",
    );
    if (existing) {
      if (String(existing.customer?._id) !== String(customerId))
        return res
          .status(409)
          .json({ message: "This request ID belongs to another order." });
      return res
        .status(200)
        .json(await withCustomerTotals(existing.toObject()));
    }

    const result = await withCustomerLedgerLock(
      customerId,
      async (customer, assertLock) => {
        const retryOrder = await Order.findOne({ requestId }).populate(
          "customer",
          "name phone whatsappPhone address",
        );
        if (retryOrder) {
          if (String(retryOrder.customer?._id) !== String(customerId))
            throw httpError(409, "This request ID belongs to another order.");
          return retryOrder;
        }
        const orders = await Order.find({ customer: customer._id }).lean();
        const totals = customerLedgerTotals(orders);
        const expectedPreviousDue = req.body.expectedPreviousDue;
        if (
          !isValidMoney(expectedPreviousDue) ||
          Math.round(Number(expectedPreviousDue) * 100) !==
            Math.round(totals.due * 100)
        )
          throw httpError(
            409,
            "The customer balance changed. Refresh the order summary and review it again.",
          );

        const adjustedPreviousDue = req.body.previousDueAmount;
        if (
          !isValidMoney(adjustedPreviousDue) ||
          Number(adjustedPreviousDue) > 100000000
        )
          throw httpError(400, "Enter a valid Previous Due amount.");
        const previousDueAmount = Number(adjustedPreviousDue);
        const adjustmentAmount =
          Math.round((previousDueAmount - totals.due) * 100) / 100;
        const reason = String(req.body.adjustmentReason || "").trim();
        if (adjustmentAmount !== 0 && (!reason || reason.length > 500))
          throw httpError(
            400,
            "Enter a reason for changing Previous Due (maximum 500 characters).",
          );

        const total = normalizedItems.reduce(
          (sum, item) => sum + item.quantity * item.unitPrice,
          0,
        );
        if (!isValidMoney(total) || total <= 0)
          throw httpError(
            400,
            "Order total must be a valid amount greater than zero.",
          );
        if (total > 100000000)
          throw httpError(400, "Order total cannot exceed ₹100,000,000.");
        const advanceToApply = req.body.advanceToApply ?? 0;
        if (!isValidMoney(advanceToApply))
          throw httpError(400, "Enter a valid advance amount.");
        const availableAdvance = totals.availableAdvance;
        if (Number(advanceToApply) > availableAdvance)
          throw httpError(
            400,
            "Advance amount exceeds the available customer advance.",
          );
        const totalPayable = previousDueAmount + total;
        if (Number(advanceToApply) > totalPayable)
          throw httpError(
            400,
            "Advance applied cannot exceed the total payable amount.",
          );

        const initialPayment = req.body.initialPayment ?? 0;
        if (!isValidMoney(initialPayment))
          throw httpError(400, "Enter a valid payment amount.");
        const maxInitialPayment = initialOrderPaymentLimit(
          total,
          previousDueAmount,
          Number(advanceToApply),
        );
        if (Number(initialPayment) > maxInitialPayment + 0.00001)
          throw httpError(
            400,
            "Payment received cannot exceed the total payable after advance.",
          );

        const owner = ownerAudit(req.owner);
        const now = new Date();
        const sourceBalances = customerAdvanceSources(orders);
        let remainingAdvance = Number(advanceToApply);
        const advanceApplications = [];
        for (const source of sourceBalances) {
          if (!remainingAdvance) break;
          const used = Math.min(source.amount, remainingAdvance);
          if (used <= 0) continue;
          advanceApplications.push({
            sourceOrder: source.sourceOrderId,
            amount: used,
            appliedAt: now,
            owner,
          });
          remainingAdvance -= used;
        }
        if (remainingAdvance > 0.00001)
          throw httpError(
            409,
            "Available advance changed. Refresh the customer summary and try again.",
          );

        const orderDate = req.body.orderDate
          ? new Date(req.body.orderDate)
          : now;
        if (!Number.isFinite(orderDate.getTime()))
          throw httpError(400, "Enter a valid order date.");
        const orderData = {
          orderNumber: `KH-${Date.now().toString().slice(-8)}-${Math.floor(Math.random() * 90 + 10)}`,
          requestId,
          customer: customer._id,
          items: normalizedItems,
          orderDate,
          deliveryDate: req.body.deliveryDate
            ? new Date(req.body.deliveryDate)
            : null,
          deliveryStatus: "Pending",
          deliveryShift,
          address: String(req.body.address || customer.address || "").slice(
            0,
            500,
          ),
          notes: String(req.body.notes || "").slice(0, 1000),
          previousDueSnapshot: {
            amount: totals.due,
            unpaidDate: previousUnpaidDate(orders),
            availableAdvance: totals.availableAdvance,
            capturedAt: now,
          },
          advanceApplications,
        };
        if (adjustmentAmount !== 0) {
          orderData.previousDueAdjustment = {
            originalAmount: totals.due,
            adjustedAmount: previousDueAmount,
            amount: adjustmentAmount,
            date: now,
            reason,
            owner,
          };
        }
        const order = new Order(orderData);
        if (Number(initialPayment) > 0) {
          const allocations = fifoPaymentAllocations(
            [...orders, order.toObject()],
            Number(initialPayment),
          );
          order.payments.push({
            amount: Number(initialPayment),
            appliedToPreviousDue: 0,
            allocations,
            method: validMethod(req.body.initialPaymentMethod),
            note: "Initial order payment",
            paidAt: now,
            idempotencyKey: `${requestId}:initial-payment`,
            recordedBy: owner,
          });
        }
        await assertLock();
        await order.save();
        await order.populate("customer", "name phone whatsappPhone address");
        return order;
      },
    );
    res.status(201).json(await withCustomerTotals(result.toObject()));
  } catch (e) {
    next(e);
  }
});
app.post("/api/orders/:id/payments", async (req, res, next) => {
  try {
    const amount = Number(req.body.amount);
    if (!isValidMoney(amount, { allowZero: false }))
      return res
        .status(400)
        .json({ message: "Enter a valid payment amount greater than zero." });
    const idempotencyKey = String(req.body.idempotencyKey || "").trim();
    if (!idempotencyKey || idempotencyKey.length > 100)
      return res
        .status(400)
        .json({ message: "A valid payment request ID is required." });
    const initialOrder = await Order.findById(req.params.id)
      .select("customer")
      .lean();
    if (!initialOrder)
      return res.status(404).json({ message: "Order not found." });
    const order = await withCustomerLedgerLock(
      initialOrder.customer,
      async (_customer, assertLock) => {
        const current = await Order.findById(req.params.id).populate(
          "customer",
          "name phone whatsappPhone address",
        );
        if (!current) throw httpError(404, "Order not found.");
        const orders = await Order.find({ customer: _customer._id }).lean();
        const priorReceipt = findPaymentByIdempotencyKey(
          orders,
          idempotencyKey,
        );
        if (priorReceipt)
          return priorReceipt._id.equals(current._id) ? current : priorReceipt;
        if (current.deliveryStatus === "Cancelled")
          throw httpError(400, "Cancelled orders cannot receive payments.");
        const totals = customerLedgerTotals(orders);
        if (totals.due <= 0)
          throw httpError(
            400,
            "This customer has no outstanding order balance.",
          );
        if (amount > totals.due + 0.00001)
          throw httpError(
            400,
            "Payment cannot exceed the customer's total outstanding due.",
          );
        const paidAt = req.body.paidAt ? new Date(req.body.paidAt) : new Date();
        if (!Number.isFinite(paidAt.getTime()))
          throw httpError(400, "Enter a valid payment date.");
        const allocations = fifoPaymentAllocations(orders, amount);
        current.payments.push({
          amount,
          appliedToPreviousDue: 0,
          allocations,
          method: validMethod(req.body.method),
          reference: String(req.body.reference || "").slice(0, 100),
          note: String(req.body.note || "").slice(0, 500),
          paidAt,
          idempotencyKey,
          recordedBy: ownerAudit(req.owner),
        });
        await assertLock();
        await current.save();
        return current;
      },
    );
    res.json(await withCustomerTotals(order.toObject()));
  } catch (e) {
    next(e);
  }
});
app.post("/api/customers/:id/payments", async (req, res, next) => {
  try {
    const amount = Number(req.body.amount);
    if (!isValidMoney(amount, { allowZero: false }))
      return res
        .status(400)
        .json({ message: "Enter a valid payment amount greater than zero." });
    const idempotencyKey = String(req.body.idempotencyKey || "").trim();
    if (!idempotencyKey || idempotencyKey.length > 100)
      return res
        .status(400)
        .json({ message: "A valid payment request ID is required." });
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(404).json({ message: "Active customer not found." });

    const result = await withCustomerLedgerLock(
      req.params.id,
      async (customer, assertLock) => {
        const orders = await Order.find({ customer: customer._id }).lean();
        const totals = customerLedgerTotals(orders);
        const priorOrder = findPaymentByIdempotencyKey(orders, idempotencyKey);
        if (priorOrder) {
          const priorPayment = priorOrder.payments.find(
            (payment) => payment.idempotencyKey === idempotencyKey,
          );
          const dueSnapshot = customerPaymentDueSnapshot(
            priorPayment?.customerDueBefore ?? totals.due + amount,
            priorPayment?.amount ?? amount,
          );
          return {
            customer: {
              _id: customer._id,
              name: customer.name,
              phone: customer.phone,
              whatsappPhone: customer.whatsappPhone,
            },
            amount: priorPayment?.amount ?? amount,
            ...dueSnapshot,
          };
        }
        if (totals.due <= 0)
          throw httpError(400, "This customer has no outstanding balance.");
        if (amount > totals.due + 0.00001)
          throw httpError(
            400,
            "Payment cannot exceed the customer's total outstanding due.",
          );
        const paidAt = req.body.paidAt ? new Date(req.body.paidAt) : new Date();
        if (!Number.isFinite(paidAt.getTime()))
          throw httpError(400, "Enter a valid payment date.");
        const allocations = fifoPaymentAllocations(orders, amount);
        const receiptOrderId = allocations[0]?.targetOrder;
        const receiptOrder = await Order.findOne({
          _id: receiptOrderId,
          customer: customer._id,
          deliveryStatus: { $ne: "Cancelled" },
        });
        if (!receiptOrder)
          throw httpError(
            409,
            "Customer balances changed. Refresh and try again.",
          );
        const dueSnapshot = customerPaymentDueSnapshot(totals.due, amount);
        receiptOrder.payments.push({
          amount,
          appliedToPreviousDue: 0,
          customerDueBefore: dueSnapshot.previousDue,
          customerDueAfter: dueSnapshot.currentDue,
          allocations,
          method: validMethod(req.body.method),
          reference: String(req.body.reference || "").slice(0, 100),
          note: String(req.body.note || "").slice(0, 500),
          paidAt,
          idempotencyKey,
          recordedBy: ownerAudit(req.owner),
        });
        await assertLock();
        await receiptOrder.save();
        return {
          customer: {
            _id: customer._id,
            name: customer.name,
            phone: customer.phone,
            whatsappPhone: customer.whatsappPhone,
          },
          amount,
          ...dueSnapshot,
        };
      },
    );
    res.json(result);
  } catch (e) {
    next(e);
  }
});
app.patch("/api/orders/:id/delivery", async (req, res, next) => {
  try {
    const status = req.body.deliveryStatus;
    if (!["Pending", "Delivered", "Cancelled"].includes(status))
      return res.status(400).json({ message: "Invalid delivery status." });
    const initialOrder = await Order.findById(req.params.id)
      .select("customer")
      .lean();
    if (!initialOrder)
      return res.status(404).json({ message: "Order not found." });
    const order = await withCustomerLedgerLock(
      initialOrder.customer,
      async (_customer, assertLock) => {
        const current = await Order.findById(req.params.id).populate(
          "customer",
          "name phone whatsappPhone address",
        );
        if (!current) throw httpError(404, "Order not found.");
        if (current.deliveryStatus === "Cancelled" && status !== "Cancelled")
          throw httpError(400, "Cancelled orders cannot be reopened.");
        if (status === "Cancelled" && !current.cancellationReversal) {
          const customerOrders = await Order.find({
            customer: _customer._id,
          }).lean();
          const accounting = calculateFifoAccounting(customerOrders);
          const reversedAllocations = accounting.allocations.filter(
            (allocation) => allocation.targetOrderId === String(current._id),
          );
          const runningBalances = new Map(accounting.balances);
          runningBalances.set(String(current._id), 0);
          const replacementAllocations = [];
          const groupedReversals = new Map();
          for (const allocation of reversedAllocations) {
            const key = `${allocation.paymentOrderId}:${allocation.paymentId}`;
            const group = groupedReversals.get(key) || {
              ...allocation,
              amount: 0,
            };
            group.amount += allocation.amount;
            groupedReversals.set(key, group);
          }
          for (const reversal of groupedReversals.values()) {
            const remainingCustomerDue = [...runningBalances.values()].reduce(
              (sum, amount) => sum + Math.max(0, amount),
              0,
            );
            const amountToReallocate = Math.min(
              reversal.amount,
              remainingCustomerDue,
            );
            if (amountToReallocate <= 0) continue;
            const targets = fifoPaymentAllocations(
              customerOrders,
              amountToReallocate,
              runningBalances,
            );
            for (const target of targets) {
              replacementAllocations.push({
                paymentOrderId: reversal.paymentOrderId,
                paymentId: reversal.paymentId,
                targetOrder: target.targetOrder,
                amount: target.amount,
                date: new Date(),
                owner: ownerAudit(req.owner),
              });
            }
          }
          const adjustmentAmount = Number(
            current.previousDueAdjustment?.amount || 0,
          );
          const releasedAdvance = (current.advanceApplications || []).reduce(
            (sum, item) => sum + item.amount,
            0,
          );
          current.cancellationReversal = {
            date: new Date(),
            orderAmount: orderTotal(current),
            adjustmentAmount,
            releasedAdvance,
            reversedAllocations: reversedAllocations.map((allocation) => ({
              paymentOrderId: allocation.paymentOrderId,
              paymentId: allocation.paymentId || "legacy-unknown",
              targetOrder: current._id,
              amount: allocation.amount,
              date: new Date(),
              owner: ownerAudit(req.owner),
            })),
            replacementAllocations,
            reason: String(req.body.reason || "Order cancelled").slice(0, 500),
            owner: ownerAudit(req.owner),
          };
        }
        current.deliveryStatus = status;
        if (status === "Delivered")
          current.deliveryDate = req.body.deliveryDate
            ? new Date(req.body.deliveryDate)
            : new Date();
        await assertLock();
        await current.save();
        return current;
      },
    );
    res.json(await withCustomerTotals(order.toObject()));
  } catch (e) {
    next(e);
  }
});

// Ledger statement for a customer
app.get("/api/customers/:id/ledger", async (req, res, next) => {
  try {
    const customer = await Customer.findById(req.params.id)
      .select(
        "name phone whatsappPhone type address active createdAt updatedAt",
      )
      .lean();
    if (!customer)
      return res.status(404).json({ message: "Customer not found." });
    const orders = await Order.find({ customer: customer._id })
      .populate("advanceApplications.sourceOrder", "orderNumber")
      .lean();
    const rows = customerLedgerRows(orders);
    const totals = customerLedgerTotals(orders);
    res.json({
      customer,
      rows,
      balance: totals.netBalance,
      due: totals.due,
      availableAdvance: totals.availableAdvance,
    });
  } catch (e) {
    next(e);
  }
});

// Export: JSON backup and CSV
app.get("/api/export/customers/:id/ledger.csv", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(400).json({ message: "Choose a valid customer." });
    const customer = await Customer.findById(req.params.id)
      .select("name phone")
      .lean();
    if (!customer)
      return res.status(404).json({ message: "Customer not found." });
    const range = parseIndiaDateRange(req.query.from, req.query.to);
    const orders = await Order.find({ customer: customer._id }).lean();
    const statement = buildCustomerLedgerExport(orders, customer, range);
    const suffix = `${req.query.from || "all"}-to-${req.query.to || "latest"}`;
    sendCsv(res, `kajal-h2o-customer-ledger-${suffix}.csv`, statement.rows);
  } catch (e) {
    next(e);
  }
});

app.get(
  "/api/export/customers/:id/payment-details.csv",
  async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id))
        return res.status(400).json({ message: "Choose a valid customer." });
      const customer = await Customer.findById(req.params.id)
        .select("_id")
        .lean();
      if (!customer)
        return res.status(404).json({ message: "Customer not found." });
      const range = parseIndiaDateRange(req.query.from, req.query.to);
      const orders = await Order.find({ customer: customer._id }).lean();
      const rows = [
        paymentDetailsHeaders,
        ...paymentDetailsExportRows(orders, range),
      ];
      const suffix = `${req.query.from || "all"}-to-${req.query.to || "latest"}`;
      sendCsv(res, `kajal-h2o-payment-details-${suffix}.csv`, rows);
    } catch (e) {
      next(e);
    }
  },
);

app.get("/api/export/backup.json", async (_req, res, next) => {
  try {
    const [customers, orders] = await Promise.all([
      Customer.find()
        .select("-accountingLockToken -accountingLockExpiresAt")
        .lean(),
      Order.find().lean(),
    ]);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="kajal-h2o-backup-${new Date().toISOString().slice(0, 10)}.json"`,
    );
    res.json({
      app: "KAJAL H2O Business Manager",
      exportedAt: new Date().toISOString(),
      customers,
      orders,
    });
  } catch (e) {
    next(e);
  }
});
app.get("/api/export/customers.csv", async (_req, res, next) => {
  try {
    const customers = await Customer.find().lean();
    const rows = [
      ["ID", "Name", "Phone", "WhatsApp Phone", "Type", "Address", "Active"],
      ...customers.map((c) => [
        c._id,
        c.name,
        c.phone,
        c.whatsappPhone,
        c.type,
        c.address,
        c.active,
      ]),
    ];
    sendCsv(res, "kajal-h2o-customers.csv", rows);
  } catch (e) {
    next(e);
  }
});
app.get("/api/export/orders.csv", async (_req, res, next) => {
  try {
    const orders = await Order.find().populate("customer", "name phone").lean();
    const ordersByCustomer = groupOrdersByCustomer(orders);
    const rows = [
      [
        "Order Number",
        "Customer",
        "Phone",
        "Order Date",
        "Delivery Date",
        "Delivery Status",
        "Items",
        "Total INR",
        "Paid INR",
        "Due INR",
        "Previous Due INR",
        "Previous Due Adjustment INR",
        "Adjustment Reason",
        "Previous Unpaid Date",
        "Total Payable INR",
        "Available Advance INR",
        "Advance Applied INR",
        "Final Outstanding Due INR",
      ],
      ...orders.map((o) => {
        const totals = withTotals(
          o,
          ordersByCustomer.get(String(o.customer?._id || o.customer)) || [o],
        );
        return [
          o.orderNumber,
          o.customer?.name || "",
          o.customer?.phone || "",
          o.orderDate,
          o.deliveryDate || "",
          o.deliveryStatus,
          o.items
            .map((i) => `${i.product} x ${i.quantity} @ ${i.unitPrice}`)
            .join("; "),
          totals.total,
          totals.paid,
          totals.due,
          totals.previousDue,
          Number(o.previousDueAdjustment?.amount || 0),
          o.previousDueAdjustment?.reason || "",
          totals.previousUnpaidDate || "",
          totals.totalPayable,
          totals.availableAdvanceAtCreation,
          totals.advanceApplied,
          totals.finalOutstandingDue,
        ];
      }),
    ];
    sendCsv(res, "kajal-h2o-orders.csv", rows);
  } catch (e) {
    next(e);
  }
});

function sanitizeCustomer(body) {
  const phone = normalizeIndianMobile(body.phone);
  return {
    name: String(body.name || "")
      .trim()
      .slice(0, 120),
    phone,
    whatsappPhone: String(body.whatsappPhone ?? phone)
      .trim()
      .slice(0, 20),
    type: ["Shop", "Hotel", "Home", "Office", "Bra", "Event", "Other"].includes(
      body.type,
    )
      ? body.type
      : "Shop",
    address: String(body.address || "")
      .trim()
      .slice(0, 500),
    notes: String(body.notes || "")
      .trim()
      .slice(0, 1000),
    ...(typeof body.active === "boolean" ? { active: body.active } : {}),
  };
}
function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((i) => ({
      product: String(i.product),
      quantity: Number(i.quantity),
      unitPrice: Number(i.unitPrice),
    }))
    .filter(
      (i) =>
        ["250ml", "500ml", "1L", "2L", "20L"].includes(i.product) &&
        Number.isInteger(i.quantity) &&
        i.quantity > 0 &&
        Number.isFinite(i.unitPrice) &&
        i.unitPrice >= 0 &&
        isValidMoney(i.unitPrice),
    );
}
function validMethod(m) {
  return ["Cash", "UPI", "Bank Transfer", "Other"].includes(m) ? m : "Cash";
}
function groupOrdersByCustomer(orders) {
  const grouped = new Map();
  for (const order of orders) {
    const customerId = String(order.customer?._id || order.customer);
    const rows = grouped.get(customerId) || [];
    rows.push(order);
    grouped.set(customerId, rows);
  }
  return grouped;
}

async function withCustomerTotals(order) {
  const customerId = String(order.customer?._id || order.customer);
  const relatedOrders = await Order.find({ customer: customerId }).lean();
  return withTotals(order, relatedOrders);
}

function withTotals(o, relatedOrders = [o]) {
  const total = orderTotal(o);
  const paid = orderPaid(o);
  const accounting = calculateFifoAccounting(relatedOrders);
  const id = String(o._id || o.id || "");
  const allocatedPaid = accounting.allocations
    .filter((allocation) => allocation.targetOrderId === id)
    .reduce((sum, allocation) => sum + allocation.amount, 0);
  const due = accounting.balances.get(id) ?? orderDue(o);
  const previousDue = Number(o.previousDueSnapshot?.amount || 0);
  const adjustment = Number(o.previousDueAdjustment?.amount || 0);
  const advanceApplied = (o.advanceApplications || []).reduce(
    (sum, item) => sum + Number(item.amount || 0),
    0,
  );
  const adjustedPreviousDue = Math.max(0, previousDue + adjustment);
  const totalPayable = adjustedPreviousDue + total;
  return {
    ...o,
    total,
    paid,
    allocatedPaid,
    due,
    paymentStatus:
      o.deliveryStatus === "Cancelled"
        ? "Cancelled"
        : due <= 0
          ? "Paid"
          : allocatedPaid > 0
            ? "Partially Paid"
            : "Unpaid",
    customerDue: accounting.due,
    customerAvailableAdvance: accounting.availableAdvance,
    previousDue,
    adjustedPreviousDue,
    previousUnpaidDate: o.previousDueSnapshot?.unpaidDate || null,
    availableAdvanceAtCreation: Number(
      o.previousDueSnapshot?.availableAdvance || 0,
    ),
    advanceApplied,
    totalPayable,
    finalOutstandingDue: due,
  };
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function ownerAudit(owner = {}) {
  return {
    id: mongoose.isValidObjectId(owner.sub) ? owner.sub : null,
    name: String(owner.name || "Owner").slice(0, 120),
    email: String(owner.email || "").slice(0, 254),
  };
}

async function withCustomerLedgerLock(customerId, action) {
  // Each financial posting is one atomic Order document write; this short lease
  // serializes balance reads and advance allocation without a second ledger.
  const id = String(customerId?._id || customerId);
  const token = randomUUID();
  const now = new Date();
  const customer = await Customer.findOneAndUpdate(
    {
      _id: id,
      active: true,
      $or: [
        { accountingLockExpiresAt: null },
        { accountingLockExpiresAt: { $lt: now } },
      ],
    },
    {
      $set: {
        accountingLockToken: token,
        accountingLockExpiresAt: new Date(now.getTime() + 300000),
      },
    },
    { new: true },
  );
  if (!customer)
    throw httpError(
      409,
      "This customer account is being updated. Try again shortly.",
    );
  try {
    const assertLock = async () => {
      const checkedAt = new Date();
      const lockResult = await Customer.updateOne(
        {
          _id: id,
          accountingLockToken: token,
          accountingLockExpiresAt: { $gt: checkedAt },
        },
        {
          $set: {
            accountingLockExpiresAt: new Date(checkedAt.getTime() + 300000),
          },
        },
      );
      if (lockResult.modifiedCount !== 1)
        throw httpError(
          409,
          "Customer balance lock expired. Refresh and try again.",
        );
    };
    return await action(customer, assertLock);
  } finally {
    await Customer.updateOne(
      { _id: id, accountingLockToken: token },
      { $set: { accountingLockToken: null, accountingLockExpiresAt: null } },
    );
  }
}
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function csvCell(value) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  let s = String(value ?? "");
  if (/^[=+\-@]/.test(s)) s = "'" + s; // reduce spreadsheet formula injection risk
  return '"' + s.replace(/"/g, '""') + '"';
}
function sendCsv(res, filename, rows) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(
    "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n"),
  );
}
app.use((err, _req, res, _next) => {
  console.error(err);
  if (err?.statusCode)
    return res.status(err.statusCode).json({ message: err.message });
  if (err?.name === "ValidationError" || err?.name === "CastError")
    return res.status(400).json({ message: err.message });
  if (
    err?.code === 11000 &&
    (err?.keyPattern?.phone ||
      err?.keyValue?.phone ||
      String(err?.message || "").includes("uniq_active_customer_phone"))
  )
    return res
      .status(409)
      .json({ message: DUPLICATE_CUSTOMER_PHONE_MESSAGE });
  if (err?.code === 11000)
    return res
      .status(409)
      .json({ message: "A record with this unique value already exists." });
  res.status(500).json({
    message:
      process.env.NODE_ENV === "production"
        ? "Server error."
        : err.message || "Server error.",
  });
});

if (!process.env.MONGODB_URI || !process.env.JWT_SECRET) {
  console.error(
    "Missing MONGODB_URI or JWT_SECRET. Copy .env.example to .env and configure it.",
  );
  process.exit(1);
}
const connectionStartedAt = performance.now();
await mongoose.connect(process.env.MONGODB_URI);
writePerformanceLog({
  event: "startup.performance",
  endpoint: "startup.mongodb_connect",
  durationMs: Number((performance.now() - connectionStartedAt).toFixed(2)),
  status: "connected",
});
const indexesStartedAt = performance.now();
await Customer.createIndexes();
writePerformanceLog({
  event: "startup.performance",
  endpoint: "startup.customer_create_indexes",
  durationMs: Number((performance.now() - indexesStartedAt).toFixed(2)),
  status: "complete",
});
app.listen(PORT, () => {
  writePerformanceLog({
    event: "startup.performance",
    endpoint: "startup.server_readiness",
    durationMs: Number((performance.now() - processStartedAt).toFixed(2)),
    status: "ready",
  });
  console.log(`KAJAL H2O API listening on port ${PORT}`);
});
