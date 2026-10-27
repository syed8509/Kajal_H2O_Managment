import mongoose from "mongoose";

const customerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    whatsappPhone: { type: String, trim: true, maxlength: 20 },
    type: {
      type: String,
      enum: ["Shop", "Hotel", "Home", "Office", "Special Event", "Other"],
      default: "Shop",
    },
    address: { type: String, trim: true, default: "", maxlength: 500 },
    notes: { type: String, trim: true, default: "", maxlength: 1000 },
    active: { type: Boolean, default: true },
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

const paymentSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 0.01 },
    method: {
      type: String,
      enum: ["Cash", "UPI", "Bank Transfer", "Other"],
      default: "Cash",
    },
    reference: { type: String, trim: true, default: "", maxlength: 100 },
    note: { type: String, trim: true, default: "", maxlength: 500 },
    paidAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true },
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
  return Math.max(0, this.total - this.paid);
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
