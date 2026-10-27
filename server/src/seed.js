import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { Owner } from "./models.js";

if (!process.env.MONGODB_URI || !process.env.JWT_SECRET) {
  console.error("Set MONGODB_URI and JWT_SECRET in server/.env first.");
  process.exit(1);
}
await mongoose.connect(process.env.MONGODB_URI);
const email = (process.env.OWNER_EMAIL || "").toLowerCase().trim();
const password = process.env.OWNER_PASSWORD || "";
const name = process.env.OWNER_NAME || "KAJAL H2O Owner";
if (!email || !password || password.length < 12) {
  console.error(
    "Set OWNER_EMAIL and a strong OWNER_PASSWORD (at least 12 characters).",
  );
  await mongoose.disconnect();
  process.exit(1);
}
const exists = await Owner.findOne({ email });
if (exists) {
  console.log(`Owner ${email} already exists; no changes made.`);
} else {
  await Owner.create({
    name,
    email,
    passwordHash: await bcrypt.hash(password, 12),
  });
  console.log(`Created owner account: ${email}`);
}
await mongoose.disconnect();
