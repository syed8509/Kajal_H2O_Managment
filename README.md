# KAJAL H2O Business Manager

A single-owner MERN starter for managing water customers, orders, payments, customer balances, delivery history, WhatsApp click-to-chat, and JSON/CSV exports.

## Stack
- Frontend: React + Vite, responsive PWA
- Backend: Node.js + Express
- Database: MongoDB via Mongoose
- Authentication: single-owner email/password, bcrypt hash, JWT
- Currency: INR

> This is a functional starter, not a hosted service. You must configure secrets, create the owner account, connect MongoDB, and deploy it before storing real customer data.

## Requirements
- Node.js 20+
- MongoDB Atlas database (or local MongoDB)
- npm

## 1. Configure backend

```bash
cd server
cp .env.example .env
```

Edit `.env`:
- `MONGODB_URI`: your MongoDB Atlas connection string
- `JWT_SECRET`: use a long random secret (32+ characters)
- `OWNER_NAME`, `OWNER_EMAIL`, `OWNER_PASSWORD`: initial owner account; choose a strong unique password

Install and start:
```bash
npm install
npm run seed
npm run dev
```
The API runs at `http://localhost:5000`. `npm run seed` creates the owner only if that email doesn't already exist.

## 2. Configure frontend

Open a second terminal:
```bash
cd client
cp .env.example .env
npm install
npm run dev
```
Open the Vite URL (normally `http://localhost:5173`) and sign in with the owner credentials from `server/.env`.

For local development, Vite proxies `/api` to the backend. Do not expose the dev server publicly.

## 3. Main workflows
1. Add a customer in **Customers**.
2. Create an order for that customer and set quantities/prices.
3. Order total is calculated from the line items. Record an initial payment if received.
4. Add more payments later from the order list. Customer due is the positive net ledger balance (orders minus payments); advance balances are not classified as due.
5. Mark the order Delivered to add delivery history.
6. Use WhatsApp to open a prefilled message to a customer.
7. Use **Backup** to download a JSON backup or CSV exports.

## 4. MongoDB Atlas
1. Create a cluster and database user.
2. Allow your development IP in Network Access. For production, use the narrowest practical access policy.
3. Copy the Node.js connection string into `MONGODB_URI`.
4. Keep `.env` private; never commit it.

## 5. Production deployment checklist
- Deploy the API to a Node-capable host and frontend to a static host (or serve the built frontend from the API).
- Set production environment variables on the host.
- Set `CLIENT_ORIGIN` to the exact HTTPS frontend origin.
- Set `VITE_API_BASE` to the HTTPS API URL (or configure same-origin hosting).
- Use HTTPS, strong secrets, database backups, and a unique owner password.
- Add rate limiting, monitoring, and tested restore procedures before business-critical use.
- Restrict MongoDB network access and rotate secrets if they are exposed.
- This starter does not implement automated WhatsApp sending. It opens WhatsApp with a prefilled message; the owner presses Send.

## Notes
- Products are seeded as 250ml, 500ml, 1L, 2L, and 20L. Prices are editable when creating each order.
- Payments are stored as ledger transactions and linked to orders. A payment cannot exceed that order's remaining balance in this starter.
- Customer mobile numbers must be exactly 10 digits and start with 6, 7, 8, or 9.
- Orders are listed Pending first, then Delivered, then Cancelled; ties are newest order date first. Customers with positive due appear first by highest due, with newest customers first for ties.
- Dashboard cards for Today collection, customer due, today's orders, and pending delivery open their matching filtered detail lists.
- Deleting customers/orders is intentionally not exposed in the UI to preserve financial history. Customers can be edited and marked inactive.
- JSON backup includes customers, orders, and payment records. Keep backups in a secure location.
