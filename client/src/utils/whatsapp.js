import { money } from "./formatters.js";

export function whatsappUrl(c, message) {
  let number = String(c?.whatsappPhone || c?.phone || "").replace(/\D/g, "");
  if (number.length === 10) number = "91" + number;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

export function formatDate(date) {
  if (!date) return "";

  const d = new Date(date);

  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();

  return `${day}/${month}/${year}`;
}

export function openWhatsApp(order, opreviousDue) {
  const c = order.customer || {};
  const msg = `*KAJAL H2O*
🚰Water Distibutor Kharagpur
━━━━━━━━━━━━━━━━━━
🌟 *ORDER & PAYMENT RECEIPT*
━━━━━━━━━━━━━━━━━━
👋 Dear *${c.name || "Valued Customer"}*,
🙏 Thank you for choosing *KAJAL H2O*!

🧾 *ORDER SUMMARY*
━━━━━━━━━━━━━━━━━━
💰 Total Amount : *${money(order.total)}*
✅ Paid Amount  : *${money(order.paid)}*
⏳ Due Amount   : *${money(order.due)}*

🚚 Delivery Date : ${formatDate(order.deliveryDate)}

💳 *PAYMENT INFORMATION*
━━━━━━━━━━━━━━━━━━
📱 *UPI ID*:${"8509022744@pnb"}
📲 *GPay / PhonePe*:${"8509022744"}

🤝 *THANK YOU FOR YOUR TRUST!*
━━━━━━━━━━━━━━━━━━
💧 *KAJAL H2O*
✨ Your Trusted Water Partner
📞 Contact: 8509022744

💙 *Pure Water • Safe Water • Happy Family*
  `;

  window.open(whatsappUrl(c, msg), "_blank", "noopener,noreferrer");
}
