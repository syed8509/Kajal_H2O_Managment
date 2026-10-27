import "dotenv/config";
import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import helmet from "helmet";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Customer, Order, Owner } from "./models.js";
import { requireAuth } from "./auth.js";

const app = express();
const PORT = Number(process.env.PORT || 5000);
app.use(helmet());
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN
      ? process.env.CLIENT_ORIGIN.split(",").map((s) => s.trim())
      : "http://localhost:5173",
  }),
);
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

    const owner = await Owner.findOne({ email })
    const isPasswordMatch = await bcrypt.compare(password, owner?.passwordHash);

    if (!owner || !isPasswordMatch) {
      return res
        .status(401)
        .json({ message: "Email or password is incorrect." });
    }
    const token = jwt.sign(
      { sub: owner._id.toString(), email: owner.email, name: owner.name },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "12h" },
    );
    res.json({ token, owner: { name: owner.name, email: owner.email } });
  } catch (e) {
    next(e);
  }
});

app.use("/api", requireAuth);

app.get("/api/dashboard", async (_req, res, next) => {
  try {
    const [customers, orders] = await Promise.all([
      Customer.countDocuments({ active: true }),
      Order.find({ deliveryStatus: { $ne: "Cancelled" } }).populate(
        "customer",
        "name phone",
      ),
    ]);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todaysOrders = orders.filter((o) => new Date(o.orderDate) >= today);
    const sum = (list, fn) => list.reduce((n, o) => n + fn(o), 0);
    res.json({
      customerCount: customers,
      todaySales: sum(todaysOrders, (o) => o.total),
      todayCollected: sum(todaysOrders, (o) =>
        o.payments
          .filter((p) => new Date(p.paidAt) >= today)
          .reduce((n, p) => n + p.amount, 0),
      ),
      totalDue: sum(orders, (o) => o.due),
      pendingDeliveries: orders.filter((o) => o.deliveryStatus === "Pending")
        .length,
      recentOrders: orders
        .sort((a, b) => new Date(b.orderDate) - new Date(a.orderDate))
        .slice(0, 6)
        .map((o) => withTotals(o.toObject())),
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
    const customers = await Customer.find(filter).sort({ name: 1 }).lean();
    const ids = customers.map((c) => c._id);
    const orders = await Order.find({
      customer: { $in: ids },
      deliveryStatus: { $ne: "Cancelled" },
    }).lean();
    const totals = new Map();
    for (const o of orders) {
      const total = o.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
      const paid = o.payments.reduce((s, p) => s + p.amount, 0);
      const t = totals.get(String(o.customer)) || { due: 0, sales: 0 };
      t.due += Math.max(0, total - paid);
      t.sales += total;
      totals.set(String(o.customer), t);
    }
    res.json(
      customers.map((c) => ({
        ...c,
        balance: totals.get(String(c._id))?.due || 0,
        lifetimeSales: totals.get(String(c._id))?.sales || 0,
      })),
    );
  } catch (e) {
    next(e);
  }
});
app.post("/api/customers", async (req, res, next) => {
  try {
    const { name, phone } = req.body;
    if (!String(name || "").trim() || !String(phone || "").trim())
      return res
        .status(400)
        .json({ message: "Customer name and phone are required." });
    const customer = await Customer.create(sanitizeCustomer(req.body));
    res.status(201).json(customer);
  } catch (e) {
    next(e);
  }
});
app.put("/api/customers/:id", async (req, res, next) => {
  try {
    const customer = await Customer.findByIdAndUpdate(
      req.params.id,
      sanitizeCustomer(req.body),
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
app.get("/api/orders", async (_req, res, next) => {
  try {
    const orders = await Order.find()
      .populate("customer", "name phone whatsappPhone address")
      .sort({ orderDate: -1 })
      .lean();
    res.json(orders.map(withTotals));
  } catch (e) {
    next(e);
  }
});
app.post("/api/orders", async (req, res, next) => {
  try {
    const { customerId, items } = req.body;
    if (!mongoose.isValidObjectId(customerId))
      return res.status(400).json({ message: "Choose a valid customer." });
    const customer = await Customer.findOne({ _id: customerId, active: true });
    if (!customer)
      return res.status(404).json({ message: "Active customer not found." });
    const normalizedItems = normalizeItems(items);
    if (!normalizedItems.length)
      return res
        .status(400)
        .json({ message: "Add at least one valid order item." });

          // Validate delivery shift
    const deliveryShift = req.body.deliveryShift || "Day";

    if (!["Day", "Night"].includes(deliveryShift)) {
      return res.status(400).json({
        message: "Delivery shift must be Day or Night.",
      });
    }



    const order = await Order.create({
      orderNumber: `KH-${Date.now().toString().slice(-8)}-${Math.floor(Math.random() * 90 + 10)}`,
      customer: customer._id,
      items: normalizedItems,
      orderDate: req.body.orderDate ? new Date(req.body.orderDate) : new Date(),
      deliveryDate: req.body.deliveryDate
        ? new Date(req.body.deliveryDate)
        : null,
      deliveryStatus: "Pending",
      deliveryShift,

      address: String(req.body.address || customer.address || "").slice(0, 500),
      notes: String(req.body.notes || "").slice(0, 1000),
    });
    if (Number(req.body.initialPayment) > 0) {
      const amount = Number(req.body.initialPayment);
      if (amount > order.total) {
        await order.deleteOne();
        return res
          .status(400)
          .json({ message: "Initial payment cannot exceed the order total." });
      }
      order.payments.push({
        amount,
        method: validMethod(req.body.initialPaymentMethod),
        note: "Initial order payment",
      });
      await order.save();
    }
    await order.populate("customer", "name phone whatsappPhone address");
    res.status(201).json(withTotals(order.toObject()));
  } catch (e) {
    next(e);
  }
});
app.post("/api/orders/:id/payments", async (req, res, next) => {
  try {
    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0)
      return res
        .status(400)
        .json({ message: "Enter a payment amount greater than zero." });
    const order = await Order.findById(req.params.id).populate(
      "customer",
      "name phone whatsappPhone address",
    );
    if (!order) return res.status(404).json({ message: "Order not found." });
    if (order.deliveryStatus === "Cancelled")
      return res
        .status(400)
        .json({ message: "Cancelled orders cannot receive payments." });
    const total = order.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
    const paid = order.payments.reduce((s, p) => s + p.amount, 0);
    if (amount > total - paid + 0.00001)
      return res.status(400).json({
        message: `Payment exceeds remaining due of ₹${(total - paid).toFixed(2)}.`,
      });
    order.payments.push({
      amount,
      method: validMethod(req.body.method),
      reference: String(req.body.reference || "").slice(0, 100),
      note: String(req.body.note || "").slice(0, 500),
      paidAt: req.body.paidAt ? new Date(req.body.paidAt) : new Date(),
    });
    await order.save();
    res.json(withTotals(order.toObject()));
  } catch (e) {
    next(e);
  }
});
app.patch("/api/orders/:id/delivery", async (req, res, next) => {
  try {
    const status = req.body.deliveryStatus;
    if (!["Pending", "Delivered", "Cancelled"].includes(status))
      return res.status(400).json({ message: "Invalid delivery status." });
    const update = { deliveryStatus: status };
    if (status === "Delivered")
      update.deliveryDate = req.body.deliveryDate
        ? new Date(req.body.deliveryDate)
        : new Date();
    const order = await Order.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    }).populate("customer", "name phone whatsappPhone address");
    if (!order) return res.status(404).json({ message: "Order not found." });
    res.json(withTotals(order.toObject()));
  } catch (e) {
    next(e);
  }
});

// Ledger statement for a customer
app.get("/api/customers/:id/ledger", async (req, res, next) => {
  try {
    const customer = await Customer.findById(req.params.id).lean();
    if (!customer)
      return res.status(404).json({ message: "Customer not found." });
    const orders = await Order.find({ customer: customer._id })
      .sort({ orderDate: 1 })
      .lean();
    const rows = [];
    let balance = 0;
    for (const o of orders) {
      if (o.deliveryStatus === "Cancelled") continue;
      const total = o.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
      balance += total;
      rows.push({
        date: o.orderDate,
        type: "Order",
        reference: o.orderNumber,
        debit: total,
        credit: 0,
        balance,
        deliveryStatus: o.deliveryStatus,
      });
      for (const p of [...o.payments].sort(
        (a, b) => new Date(a.paidAt) - new Date(b.paidAt),
      )) {
        balance -= p.amount;
        rows.push({
          date: p.paidAt,
          type: "Payment",
          reference: o.orderNumber,
          method: p.method,
          debit: 0,
          credit: p.amount,
          balance,
          note: p.note,
        });
      }
    }
    rows.sort((a, b) => new Date(a.date) - new Date(b.date));
    // Recompute running balance in chronological order for stable statement ordering.
    balance = 0;
    for (const row of rows) {
      balance += row.debit - row.credit;
      row.balance = balance;
    }
    res.json({ customer, rows, balance });
  } catch (e) {
    next(e);
  }
});

// Export: JSON backup and CSV
app.get("/api/export/backup.json", async (_req, res, next) => {
  try {
    const [customers, orders] = await Promise.all([
      Customer.find().lean(),
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
      ],
      ...orders.map((o) => {
        const total = o.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const paid = o.payments.reduce((s, p) => s + p.amount, 0);
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
          total,
          paid,
          Math.max(0, total - paid),
        ];
      }),
    ];
    sendCsv(res, "kajal-h2o-orders.csv", rows);
  } catch (e) {
    next(e);
  }
});

function sanitizeCustomer(body) {
  return {
    name: String(body.name || "")
      .trim()
      .slice(0, 120),
    phone: String(body.phone || "")
      .trim()
      .slice(0, 20),
    whatsappPhone: String(body.whatsappPhone || "")
      .trim()
      .slice(0, 20),
    type: ["Shop", "Hotel", "Home", "Office", "Other"].includes(body.type)
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
        i.unitPrice >= 0,
    );
}
function validMethod(m) {
  return ["Cash", "UPI", "Bank Transfer", "Other"].includes(m) ? m : "Cash";
}
function withTotals(o) {
  const total = o.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const paid = o.payments.reduce((s, p) => s + p.amount, 0);
  return { ...o, total, paid, due: Math.max(0, total - paid) };
}
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function csvCell(value) {
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
  if (err?.name === "ValidationError" || err?.name === "CastError")
    return res.status(400).json({ message: err.message });
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
await mongoose.connect(process.env.MONGODB_URI);
app.listen(PORT, () => console.log(`KAJAL H2O API listening on port ${PORT}`));
