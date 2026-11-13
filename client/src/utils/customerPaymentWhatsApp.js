
import { money } from "./formatters.js";

// Format Date: DD/MM/YYYY
function formatDate(date) {
  if (!date) return "N/A";

  const d = new Date(date);

  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();

  return `${day}/${month}/${year}`;
}

// 1. Customer Payment Receipt
export function buildCustomerPaymentWhatsAppMessage({
  customer,
  previousDue,
  previousDueDate,
  amount,
  paymentDate = new Date(),
  currentDue,
}) {
  return [
    "💧 *KAJAL H2O*",
    "✨ Your Trusted Water Partner",
    "━━━━━━━━━━━━━━━━━━",
    "🧾 *PAYMENT RECEIPT*",
    "━━━━━━━━━━━━━━━━━━",
    `👤 Customer: *${customer?.name || "Customer"}*`,
    "",
    `📅 Previous Due: ${formatDate(previousDueDate)}`,
    `💰 Previous Balance: ${money(previousDue)}`,
    "",
    `📅 Payment Date: ${formatDate(paymentDate)}`,
    `💵 Amount Paid: *${money(amount)}*`,
    "━━━━━━━━━━━━━━━━━━",
    `✅ *Remaining Due: ${money(currentDue)}*`,
    "━━━━━━━━━━━━━━━━━━",
    "🙏 Thank you for your payment!",
    "💙 We appreciate your trust.",
    "",
    "*TEAM KAJAL H2O*",
    "📍 Water Distributor | Kharagpur",
  ].join("\n");
}

// 2. Customer Account Statement
export function buildCustomerDueReminderMessage({
  customer,
  due,
  statementDate = new Date(),
}) {
  return [
    "💧 *KAJAL H2O*",
    "✨ Your Trusted Water Partner",
    "━━━━━━━━━━━━━━━━━━",
    "📋 *ACCOUNT STATEMENT*",
    "━━━━━━━━━━━━━━━━━━",
    `👤 Customer: *${customer?.name || "Customer"}*`,
    `📅 Statement Date: ${formatDate(statementDate)}`,
    "━━━━━━━━━━━━━━━━━━",
    `⚠️ *Outstanding Balance*`,
    `💰 *${money(due)}*`,
    "━━━━━━━━━━━━━━━━━━",
    "🙏 Kindly clear your outstanding balance.",
    "💙 Thank you for your continued support!",
    "",
    "*TEAM KAJAL H2O*",
    "📍 Water Distributor | Kharagpur",
  ].join("\n");
}
