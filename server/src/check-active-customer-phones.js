import "dotenv/config";
import mongoose from "mongoose";
import { Customer } from "./models.js";
import { normalizeIndianMobile } from "./business.js";

if (!process.env.MONGODB_URI) {
  console.error("Missing MONGODB_URI. Set it to the target database before running this read-only check.");
  process.exit(1);
}

await mongoose.connect(process.env.MONGODB_URI);
try {
  const customers = await Customer.find({ active: true })
    .select("_id name phone")
    .lean();
  const groups = new Map();
  for (const customer of customers) {
    const phone = normalizeIndianMobile(customer.phone);
    if (!phone) continue;
    const group = groups.get(phone) || [];
    group.push(customer);
    groups.set(phone, group);
  }
  const duplicates = [...groups].filter(([, group]) => group.length > 1);
  if (!duplicates.length) {
    console.log("No duplicate active customer phone numbers found.");
  } else {
    console.log("Duplicate active customer phone numbers found. Resolve these manually before deploying the unique index:");
    for (const [phone, group] of duplicates) {
      console.log(JSON.stringify({ phone, customers: group.map(({ _id, name, phone: storedPhone }) => ({ id: String(_id), name, storedPhone })) }));
    }
    process.exitCode = 2;
  }
} finally {
  await mongoose.disconnect();
}
