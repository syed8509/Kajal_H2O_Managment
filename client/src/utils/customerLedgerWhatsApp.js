import { money } from "./formatters.js";

const statementDate = (value) => {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(parsed);
};

export function buildCustomerLedgerWhatsAppMessage(data) {
  const customer = data?.customer || {};
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const transactions = rows.length
    ? rows.map(
        (row) =>
          `${statementDate(row.date)} | ${row.type || "Transaction"} | ${money(row.debit)} | ${money(row.credit)} | ${money(row.balance)}`,
      )
    : ["No transactions recorded."];

  return [
    "*KAJAL H2O | CUSTOMER LEDGER STATEMENT*",
    "━━━━━━━━━━━━━━━━━━━━",
    "*Customer Information*",
    `Name: ${customer.name || "—"}`,
    `Phone: ${customer.phone || customer.whatsappPhone || "—"}`,
    "",
    "*Account Summary*",
    `Current Due: *${money(data?.due ?? 0)}*`,
    `Available Advance: *${money(data?.availableAdvance ?? 0)}*`,
    "",
    "*Transaction History*",
    "   Date    |    Type    |     Debit     |    Credit    |   Balance",
    ...transactions,
    "",
    `*Final Outstanding Balance: ${money(data?.due ?? 0)}*`,
    "",
    "Thank you for choosing KAJAL H2O! 🙏",
    "— Team KAJAL H2O",
  ].join("\n");
}
