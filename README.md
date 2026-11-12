# PagoMóvil Receiver (Cloudflare Workers + Hono + D1)

Serverless, zero-maintenance webhook receiver and real-time reconciliation engine for Venezuelan Pago Móvil payments. Designed to pair seamlessly with the [PagoMóvil Listener Android App](https://github.com/cegh2001/pagomovil-listener).

---

## 🏛️ Architecture & Highlights

* **Ultra-Fast Serverless (< 5ms cold start):** Runs natively on Cloudflare Workers edge network using **Hono**.
* **Zero Cost Infrastructure:** Built on Cloudflare's free tier (100k requests/day + 5GB Cloudflare D1 SQLite database).
* **Idempotent Ingestion:** Safely handles mobile network drops and notification re-posts by returning `HTTP 200 OK` on duplicate transactions, preventing infinite client retry loops.
* **Dual Reconciliation Strategies:**
  * **Strategy A (Reference Suffix Matching):** Solves the Venezuelan bank mismatch where sending bank receipts (e.g. BFC with 8 digits: `23334023`) differ from receiving bank push notifications (e.g. BDV with 12 digits: `334023334023`). Uses `LIKE %ref` to match seamlessly.
  * **Strategy B (Phone & Amount Matching):** Handles banks like BFC that omit transaction reference numbers in push notifications, matching by customer's last 4 phone digits, amount, and date.
* **Double-Spending Prevention:** Atomically marks reconciled payments as `used = 1`.
* **Optional Push Pattern:** Can asynchronously forward payments to an external ERP, CRM, or e-commerce backend in real-time.

---

## 🚀 Quick Start Guide

### 1. Prerequisites
* [Node.js](https://nodejs.org/) (v18+)
* A free [Cloudflare](https://dash.cloudflare.com/) account
* Cloudflare Wrangler CLI (`npm install -g wrangler` or via `npx`)

### 2. Clone and Install Dependencies
```bash
git clone https://github.com/cegh2001/pagomovil-receiver.git
cd pagomovil-receiver
npm install
```

### 3. Create Cloudflare D1 Database
Log in to your Cloudflare account and create the D1 database:
```bash
npx wrangler login
npx wrangler d1 create pagomovil-db
```

Wrangler will output configuration details. Copy the `database_id` and update your `wrangler.toml`:
```toml
[[d1_databases]]
binding = "DB"
database_name = "pagomovil-db"
database_id = "paste-your-database-id-here"
```

### 4. Execute Database Migrations (Schema)
Create the tables and indexes:

* **For local development:**
  ```bash
  npm run db:migrate:local
  ```
* **For production (Cloudflare Remote):**
  ```bash
  npm run db:migrate:remote
  ```

### 5. Configure Secrets
Set the secret authorization token that the Android app and API clients will use:
```bash
npx wrangler secret put WEBHOOK_SECRET
```
*(Enter a strong random token, e.g. `pago_sec_9f82a17b3c4d`)*

*(Optional)* If you want payments automatically forwarded to another server:
```bash
npx wrangler secret put FORWARD_WEBHOOK_URL
# Value: https://api.yourcompany.com/api/pagos/webhook
```

### 6. Deploy to Cloudflare Workers
```bash
npm run deploy
```
Wrangler will output your public URL:
`https://pagomovil-receiver.<your-subdomain>.workers.dev`

---

## 📡 API Reference

All protected endpoints require one of the following authentication headers:
* `X-Webhook-Secret: <YOUR_SECRET>`
* `x-api-key: <YOUR_SECRET>`
* `Authorization: Bearer <YOUR_SECRET>`

---

### 1. Payment Ingestion (Called by Android App)
* **Endpoint:** `POST /webhooks/pagomovil`
* **Headers:** `X-Webhook-Secret: <YOUR_SECRET>`

#### Request Body:
```json
{
  "id": 1,
  "bank": "BDV",
  "amount_bs": 1.0,
  "raw_amount": "1,00",
  "phone_number": "0412-9897838",
  "phone_prefix": "0412",
  "phone_last_digits": "7838",
  "reference": "334023334023",
  "date": "11-11-26",
  "time": "22:29",
  "raw_title": "PagomovilBDV recibido",
  "raw_body": "Recibiste un PagomovilBDV por Bs.1,00 del 0412-9897838 Ref: 334023334023 en fecha 11-11-26 hora: 22:29.",
  "received_at": 1731382140000
}
```

#### Responses:
* `201 Created`: Payment recorded successfully.
* `200 OK`: Duplicate payment received (Idempotent response to stop Android retries).

---

### 2. Payment Reconciliation (Called by Checkout / POS)
* **Endpoint:** `POST /api/pagos/verificar`
* **Headers:** `X-Webhook-Secret: <YOUR_SECRET>`

#### Case A: Verifying by Reference Suffix (e.g. BDV)
The customer provides whatever reference digits appear on their receipt (last 4 to 8 digits):
```json
{
  "referencia": "23334023",
  "montoEsperado": 1.00
}
```

#### Case B: Verifying by Phone (e.g. BFC without reference)
```json
{
  "telefonoUltimos4": "9152",
  "montoEsperado": 35.00
}
```

#### Successful Response (`200 OK`):
```json
{
  "verificado": true,
  "mensaje": "Pago verificado y marcado como utilizado exitosamente",
  "pago": {
    "id": 1,
    "bank": "BDV",
    "amount_bs": 1.0,
    "reference": "334023334023",
    "phone_number": "0412-9897838",
    "phone_last_digits": "7838",
    "date": "11-11-26",
    "time": "22:29",
    "received_at": 1731382140000
  }
}
```

---

### 3. Read-Only Query & Admin Endpoints
* `POST /api/pagos/consultar`: Checks if a payment exists and whether it has been used, without modifying `used` state.
* `GET /api/pagos/recientes?limit=25`: Lists latest received payments and status.
* `GET /api/pagos/stats`: Returns count of total, used, and pending payments.
* `GET /health`: Public health check endpoint.

---

## 🔗 Linking with the Android App

In the [PagoMóvil Listener](https://github.com/cegh2001/pagomovil-listener) Android App:
1. Open the app and tap the **Settings** icon (top right).
2. Set **Webhook URL** to:
   ```text
   https://pagomovil-receiver.<your-subdomain>.workers.dev/webhooks/pagomovil
   ```
3. Set **Webhook Secret** to the value of `WEBHOOK_SECRET` configured in Wrangler.
4. Save settings.

---

## 📄 License
MIT License - Copyright (c) 2026 cegh2001
