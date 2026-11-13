export function dueCustomers(customers) {
  return (customers || []).filter(
    (customer) => customer.active !== false && Number(customer.balance) > 0,
  );
}

export function customerPaymentHistory(rows) {
  return (rows || [])
    .filter((row) => row.type === "Payment")
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}
