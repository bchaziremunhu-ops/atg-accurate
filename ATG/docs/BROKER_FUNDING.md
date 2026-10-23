# Broker Deposit & Withdrawal Management (Deriv / Weltrade)

A complete, auditable **funding** module for money moving **into and out of customers'
Deriv and Weltrade accounts**. It is deliberately a *separate ledger* from the ATG wallet
(courses / VIP balance) — the two are never mixed, and no test or code path lets broker
money touch `Wallet`, `Transaction` or `Purchase`.

> **Not trade execution.** There is still no order/position/trading endpoint anywhere in the
> app (`/api/broker/order` → 404). This module only records and settles *funding requests*.

---

## 1. Guarantees

| Guarantee | How it is enforced |
| --- | --- |
| Separate ledger | Dedicated models `BrokerTransaction`, `BrokerAuditLog`, `BrokerBalance`. Wallet endpoints are never called from broker code (asserted by a test). |
| No auto-fulfilment | `PENDING → UNDER_REVIEW → APPROVED → PROCESSING → COMPLETED`. A deposit/withdrawal can never skip review, and **completion requires evidence** (`providerRef` or a reconciliation note) → `400 EVIDENCE_REQUIRED`. |
| Withdrawals need review | `approve` on a withdrawal that has not passed `UNDER_REVIEW` → `400 REVIEW_REQUIRED`. |
| Evidence-based completion | Only a signed provider webhook or an admin with `providerRef`/evidence can produce `COMPLETED`. |
| Gateway safety | An adapter can **never** return `COMPLETED` — it can only report `PROCESSING`/`FAILED`. Settlement comes from a verified webhook or an admin action. |
| Idempotency | Customer submits accept an `Idempotency-Key` header (and are deduped by open-request fingerprint); webhooks dedupe on `@@unique([provider, eventId])`. |
| Webhooks are authenticated | HMAC-SHA256 over the **raw body**, timing-safe compare, secret required (missing secret ⇒ gateway disabled + every callback rejected). |
| Secrets | Broker credentials, endpoint paths and header names come from **environment variables only**. No invented broker APIs: a gateway stays `manual` until creds **and** webhook secret **and** mapped endpoint paths exist. |
| Auditability | Every transition, webhook and balance write lands in `BrokerAuditLog` (immutable). Customer-facing timelines never expose internal notes. |
| Verified balances | `BrokerBalance` rows are written only by an admin (or a broker API call) and are hidden from the customer until `verifiedAt` is set. |

---

## 2. Lifecycle

```
        ┌──────────┐  review   ┌──────────────┐  approve  ┌──────────┐
customer│ PENDING  ├──────────▶│ UNDER_REVIEW ├──────────▶│ APPROVED │
submit  └────┬─────┘           └──────┬───────┘           └────┬─────┘
             │ reject                 │ reject                 │ start_processing
             ▼                        ▼                        ▼
        ┌──────────┐            ┌──────────┐            ┌────────────┐   webhook / admin
        │ REJECTED │            │ REJECTED │            │ PROCESSING ├──────────────┐
        └──────────┘            └──────────┘            └────────────┘              ▼
                                                                          ┌────────────┐
                              fail (no evidence / gateway error)         │  COMPLETED │
                                                                          └────────────┘
```

- Terminal: `COMPLETED`, `REJECTED`, `FAILED`.
- `PROCESSING → COMPLETED` requires `providerRef` **or** an evidence note.
- `PROCESSING → FAILED` records `failureReason`.
- Providers may send `outcome: FAILED|REJECTED|CANCELLED` → `FAILED`.

---

## 3. Roles & pages

| Actor | Page | What they get |
| --- | --- | --- |
| Customer | `/broker-funds` (`client/src/pages/BrokerFunds.tsx`) | Deriv/Weltrade tabs, verified balance (or honest *Not available*), deposit + withdrawal forms, history, status timeline. |
| Admin | Admin → **Broker Funds** (`client/src/pages/Admin.tsx`) | Queues: **Deposits · Withdrawals · Audit · Balances**; filters (status, broker, search, amount range, dates); detail modal with the **full** destination + evidence + audit log; balance verification; internal notes. |

Navigation: desktop sidebar **Broker Funds** entry (the mobile bottom bar keeps its original
five items — the page is reachable from **Profile → Broker Funds** on mobile).

---

## 4. API

### Customer (`/api/broker`, JWT required)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/broker/config` | brokers, methods, limits, gateways (`configured`/`ready`/`reason`), manual flag, notice |
| GET | `/api/broker/balances` | verified balances only (+ `notice`) |
| GET | `/api/broker/deposits?broker=` | own requests |
| GET | `/api/broker/withdrawals?broker=` | own requests |
| GET | `/api/broker/transactions?direction=&broker=&status=` | own requests, newest first |
| GET | `/api/broker/transactions/:id` | detail + timeline (404 for another user's id) |
| POST | `/api/broker/deposits` | `{broker, amount, method, paymentReference}` + optional `Idempotency-Key` |
| POST | `/api/broker/withdrawals` | `{broker, amount, method, destination, destinationType, paymentReference?}` + optional `Idempotency-Key` |

`destinationType` ∈ `MOBILE_WALLET | BANK_ACCOUNT | BROKER_ACCOUNT`. Listings mask the
destination (`********8743`); the raw value exists only on detail/admin view.

### Admin (`/api/admin/broker`, ADMIN only)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/deposits` · `/withdrawals` | query: `broker, status, q, minAmount, maxAmount, from, to` |
| GET | `/stats` | status counts, completed totals, gateway readiness |
| GET | `/transactions/:id` | full detail incl. raw destination, evidence, audit |
| PATCH | `/transactions/:id` | `{action, adminNote?, internalNote?, providerRef?, evidence?, failureReason?}` where `action` ∈ `review \| approve \| start_processing \| complete \| reject \| fail` |
| POST | `/transactions/:id/notes` | append an internal note |
| GET | `/audit` | query: `action, source, transactionId, broker, from, to` |
| GET | `/balances?broker=` · `POST /balances` | list / upsert a **verified** balance `{userId, broker, balance, source, reference}` |
| GET | `/settings` | effective limits & fee (env defaults + stored overrides) |
| PUT | `/settings` | partial patch `{deposit?, withdrawal?, pendingLimit?, feePct?}` — validated, applied immediately, audited (`SETTINGS_UPDATED`) |

### Runtime limits & fee

Limits are **not hardcoded**. Env vars (`BROKER_*`) provide the startup defaults; an admin
can override any of them at runtime from **Admin → Broker Funds → Limits** (stored in the
`Setting` table, cached in-process). Enforcement always happens server-side on the
effective values — the customer UI simply renders what `/api/broker/config` reports.

The deposit admin fee (`feePct`, default `0`) is **snapshotted onto each deposit row**
(`feePct` + `feeAmount`) at creation, so changing the rate later never rewrites history.
Invalid combinations (`min >= max`) are rejected with `400 INVALID_SETTINGS`.

### Webhook (raw body, verified)

```
POST /api/broker/webhook/:broker        # broker ∈ deriv | weltrade
X-ATG-Signature: <hmac>                 # header name configurable per broker
```

Signature (either form, both standard):

- raw `hex` (or `base64`) `HMAC-SHA256(secret, rawBody)`, or
- `t=<unix>,v1=<hex>` where `v1 = HMAC-SHA256(secret, "<t>.<rawBody>")`.

Body (extra keys ignored):

```json
{
  "event_id": "evt_123",          // required — idempotency key
  "reference": "ATG-DEP-...",     // required — funding reference
  "outcome": "COMPLETED",         // or FAILED / REJECTED / CANCELLED
  "provider_ref": "tx_456",       // optional
  "reason": "optional message"
}
```

Verification failures return `401` with `INVALID_SIGNATURE`; a broker with no
`*_WEBHOOK_SECRET` rejects **every** callback (`gateway disabled`). Replayed `event_id`s are
ignored (HTTP 200, no state change). Settlement can never bypass the lifecycle: a
`COMPLETED` assertion on a `PENDING`/`UNDER_REVIEW` withdrawal is still walked to
`PROCESSING` first and audited.

---

## 5. Environment configuration

Defaults ship **manual** (`BROKER_FUNDING_PROVIDER=manual`). A gateway is only *live* when
**all** of the following are present for that broker:

1. credential set (`*_API_KEY` + `*_API_SECRET`, plus `DERIV_APP_ID` for Deriv),
2. `*_WEBHOOK_SECRET`,
3. the funding endpoint paths.

Nothing is guessed: if a path is blank the gateway reports the exact reason via
`GET /api/broker/config` → `gateways[].reason`.

```bash
BROKER_FUNDING_PROVIDER=manual        # manual | automated
BROKER_CURRENCY=USD

# ---- Deriv ----
DERIV_API_KEY=
DERIV_API_SECRET=
DERIV_APP_ID=
DERIV_BASE_URL=https://api.deriv.com
DERIV_WEBHOOK_SECRET=
DERIV_FUNDING_DEPOSIT_PATH=           # e.g. /accounts/.../payment
DERIV_FUNDING_WITHDRAW_PATH=
DERIV_FUNDING_BALANCE_PATH=
DERIV_FUNDING_AUTH_HEADER=Authorization
DERIV_FUNDING_AUTH_SCHEME=Bearer
DERIV_WEBHOOK_HEADER=X-ATG-Signature

# ---- Weltrade ----
WELTRADE_API_KEY=
WELTRADE_API_SECRET=
WELTRADE_BASE_URL=https://api.weltrade.com
WELTRADE_WEBHOOK_SECRET=
WELTRADE_FUNDING_DEPOSIT_PATH=
WELTRADE_FUNDING_WITHDRAW_PATH=
WELTRADE_FUNDING_BALANCE_PATH=
WELTRADE_FUNDING_AUTH_HEADER=Authorization
WELTRADE_FUNDING_AUTH_SCHEME=Bearer
WELTRADE_WEBHOOK_HEADER=X-ATG-Signature

# ---- Limits (server enforced) ----
BROKER_DEPOSIT_MIN=10
BROKER_DEPOSIT_MAX=50000
BROKER_WITHDRAWAL_MIN=10
BROKER_WITHDRAWAL_MAX=50000
BROKER_WITHDRAWAL_DAILY_MAX=20000
BROKER_PENDING_LIMIT=5
```

> Take the **exact** base URL, path, auth header/scheme and callback header from the
> broker's current API documentation for the account type you use. The server performs
> `POST` with the auth header/scheme above, sends `X-ATG-Reference: <our reference>` so the
> callback can be matched, and reports transport errors as `FAILED` — never as `COMPLETED`.

Copy the block from `server/.env.example` (lines 50–80).

---

## 6. Data model

```prisma
model BrokerTransaction {   // one funding request
  id, userId, broker (DERIV|WELTRADE), direction (DEPOSIT|WITHDRAWAL),
  amount, currency, method, status, reference @unique, provider, processingMode,
  destination, destinationType, paymentReference, providerRef,
  evidence, evidenceType, adminNote, internalNote, failureReason,
  source, idempotencyKey, error, processedAt, completedAt, timestamps
  @@index([userId, direction, status])
}

model BrokerAuditLog {      // immutable
  transactionId, action, fromStatus, toStatus, source, actorId, actorName,
  actorRole, note, provider, eventId, metadata, at
  @@unique([provider, eventId])   // webhook idempotency
  @@index([transactionId, at])
}

model BrokerBalance {       // verified broker balance per user
  userId, broker, balance, currency, source, reference, verifiedAt, updatedAt
  @@unique([userId, broker])
}
```

`Certificate.title` was added alongside this work (it was missing from the schema while the
code used it).

---

## 7. Notifications & realtime

- Customer: `PAYMENT` notification on create/transition, `link: /broker-funds`.
- Admins: `PAYMENT` notification with `link: /admin`, linking straight to the queue.
- Realtime: `getIo()` emits to room `user:{id}` so open screens update live.

---

## 8. Tests

```bash
cd server && npm test
# 34/34 smoke checks + 32/32 broker funding checks
```

Broker coverage (`server/src/tests/brokerFunding.test.ts`): config/gateways, RBAC,
limits, idempotency, duplicates, daily limit, ownership 404, masked admin list, filters,
review-required, evidence-required, audit, timeline privacy, balances gating, webhook
complete/replay/bad-signature/disabled-broker/unknown-reference, and **ledger separation**
(broker money never touches the wallet).

```bash
cd server && npx tsc -p tsconfig.json --noEmit
cd client && npx tsc --noEmit
```
