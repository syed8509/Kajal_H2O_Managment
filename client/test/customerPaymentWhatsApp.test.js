import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCustomerDueReminderMessage,
  buildCustomerPaymentWhatsAppMessage,
} from "../src/utils/customerPaymentWhatsApp.js";
import { customerPaymentHistory, dueCustomers } from "../src/utils/customerPayments.js";

test("due customer list contains only active customers with a positive balance", () => {
  assert.deepEqual(
    dueCustomers([
      { _id: "due", active: true, balance: 25 },
      { _id: "settled", active: true, balance: 0 },
      { _id: "advance", active: true, balance: -10 },
      { _id: "archived", active: false, balance: 50 },
    ]).map(({ _id }) => _id),
    ["due"],
  );
});

test("payment history excludes ledger transactions and sorts newest first", () => {
  assert.deepEqual(
    customerPaymentHistory([
      { type: "Payment", date: "2026-01-01", credit: 5 },
      { type: "Order", date: "2026-01-02", debit: 10 },
      { type: "Payment", date: "2026-01-03", credit: 7 },
    ]).map(({ credit }) => credit),
    [7, 5],
  );
});

test("payment WhatsApp receipt shows customer, prior due, received amount, and remaining due", () => {
  const message = buildCustomerPaymentWhatsAppMessage({
    customer: { name: "Asha Store" },
    previousDue: 1000,
    amount: 400,
    currentDue: 600,
  });
  assert.match(message, /Asha Store/);
  assert.match(message, /₹1,000/);
  assert.match(message, /₹400/);
  assert.match(message, /₹600/);
  assert.doesNotMatch(message, /allocation|order id/i);
});

test("due reminder WhatsApp message states the current due without order promotion", () => {
  const message = buildCustomerDueReminderMessage({
    customer: { name: "HFC" },
    due: 600,
  });
  assert.match(message, /HFC/);
  assert.match(message, /₹600/);
  assert.doesNotMatch(message, /Need Water|Place your order|Order Now|Quantity/i);
});
