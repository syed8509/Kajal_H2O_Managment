import mongoose from "mongoose";
import { isValidIndianMobile, orderDue } from "./business.js";

const customerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    phone: {
      type: String,
      required: true,
      trim: true,
      match: [/^[6-9][0-9]{9}$/, "Invalid Indian mobile number."],
      validate: {
        validator: isValidIndianMobile,
        message: "Invalid Indian mobile number.",
      },
    },
    whatsappPhone: { type: String, trim: true, maxlength: 20 },
    type: {
      type: String,
      enum: ["Shop", "Hotel", "Home", "Office", "Special Event", "Other"],
      default: "Shop",
    },
    address: { type: String, trim: true, default: "", maxlength: 500 },
    notes: { type: String, trim: true, default: "", maxlength: 1000 },
    active: { type: Boolean, default: true },
    accountingLockToken: { type: String, default: null },
    accountingLockExpiresAt: { type: Date, default: null },
  },
  { timestamps: true },
);

const orderItemSchema = new mongoose.Schema(
  {
    product: {
      type: String,
      enum: ["250ml", "500ml", "1L", "2L", "20L"],
      required: true,
    },
    quantity: { type: Number, required: true, min: 1, max: 100000 },
    unitPrice: { type: Number, required: true, min: 0, max: 1000000 },
  },
  { _id: false },
);

const auditOwnerSchema = new mongoose.Schema(
  {
    id: { type: mongoose.Schema.Types.ObjectId, ref: "Owner", default: null },
    name: { type: String, trim: true, default: "" },
    email: { type: String, trim: true, lowercase: true, default: "" },
  },
  { _id: false },
);

const paymentSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 0.01, max: 100000000 },
    appliedToPreviousDue: { type: Number, min: 0, max: 100000000, default: 0 },
    allocations: {
      type: [
        new mongoose.Schema(
          {
            targetOrder: {
              type: mongoose.Schema.Types.ObjectId,
              ref: "Order",
              required: true,
            },
            amount: { type: Number, required: true, min: 0.01, max: 100000000 },
          },
          { _id: false },
        ),
      ],
      default: undefined,
    },
    method: {
      type: String,
      enum: ["Cash", "UPI", "Bank Transfer", "Other"],
      default: "Cash",
    },
    reference: { type: String, trim: true, default: "", maxlength: 100 },
    note: { type: String, trim: true, default: "", maxlength: 500 },
    paidAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },
    idempotencyKey: { type: String, trim: true, maxlength: 100 },
    recordedBy: { type: auditOwnerSchema, default: undefined },
  },
  { _id: true },
);

const dueAdjustmentSchema = new mongoose.Schema(
  {
    originalAmount: { type: Number, required: true, min: 0, max: 100000000 },
    adjustedAmount: { type: Number, required: true, min: 0, max: 100000000 },
    amount: { type: Number, required: true, min: -100000000, max: 100000000 },
    date: { type: Date, default: Date.now },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    owner: { type: auditOwnerSchema, required: true },
  },
  { _id: false },
);

const advanceApplicationSchema = new mongoose.Schema(
  {
    sourceOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },
    amount: { type: Number, required: true, min: 0.01, max: 100000000 },
    appliedAt: { type: Date, default: Date.now },
    owner: { type: auditOwnerSchema, required: true },
  },
  { _id: false },
);

const allocationAuditSchema = new mongoose.Schema(
  {
    paymentOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },
    paymentId: { type: String, required: true, trim: true, maxlength: 100 },
    targetOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },
    amount: { type: Number, required: true, min: 0.01, max: 100000000 },
    date: { type: Date, default: Date.now },
    owner: { type: auditOwnerSchema, required: true },
  },
  { _id: false },
);

const cancellationReversalSchema = new mongoose.Schema(
  {
    date: { type: Date, default: Date.now },
    orderAmount: { type: Number, required: true, min: 0, max: 100000000 },
    adjustmentAmount: {
      type: Number,
      required: true,
      min: -100000000,
      max: 100000000,
    },
    releasedAdvance: { type: Number, required: true, min: 0, max: 100000000 },
    reversedAllocations: { type: [allocationAuditSchema], default: [] },
    replacementAllocations: { type: [allocationAuditSchema], default: [] },
    reason: {
      type: String,
      trim: true,
      default: "Order cancelled",
      maxlength: 500,
    },
    owner: { type: auditOwnerSchema, required: true },
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true, unique: true, index: true },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },
    items: { type: [orderItemSchema], validate: (v) => v.length > 0 },
    orderDate: { type: Date, default: Date.now },
    deliveryDate: { type: Date, default: null },

    deliveryShift: {
      type: String,
      enum: ["Day", "Night"],
      default: "Day",
    },
    deliveryStatus: {
      type: String,
      enum: ["Pending", "Delivered", "Cancelled"],
      default: "Pending",
    },
    address: { type: String, trim: true, default: "" },
    notes: { type: String, trim: true, default: "", maxlength: 1000 },
    payments: { type: [paymentSchema], default: [] },
    requestId: {
      type: String,
      trim: true,
      maxlength: 100,
      unique: true,
      sparse: true,
    },
    previousDueSnapshot: {
      amount: { type: Number, min: 0, max: 100000000, default: 0 },
      unpaidDate: { type: Date, default: null },
      availableAdvance: { type: Number, min: 0, max: 100000000, default: 0 },
      capturedAt: { type: Date, default: Date.now },
    },
    previousDueAdjustment: { type: dueAdjustmentSchema, default: null },
    advanceApplications: { type: [advanceApplicationSchema], default: [] },
    cancellationReversal: { type: cancellationReversalSchema, default: null },
  },
  { timestamps: true },
);

orderSchema.virtual("total").get(function () {
  return this.items.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0,
  );
});
orderSchema.virtual("paid").get(function () {
  return this.payments.reduce((sum, p) => sum + p.amount, 0);
});
orderSchema.virtual("due").get(function () {
  return orderDue(this);
});
orderSchema.set("toJSON", { virtuals: true });
orderSchema.set("toObject", { virtuals: true });

export const Customer = mongoose.model("Customer", customerSchema);
export const Order = mongoose.model("Order", orderSchema);

const ownerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, required: true },
  },
  { timestamps: true },
);
export const Owner = mongoose.model("Owner", ownerSchema);
