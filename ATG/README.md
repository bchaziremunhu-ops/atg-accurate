# ATG Traders — Full-Stack Trading Education & Signals Platform

A **working** (not a mockup) full-stack application that reproduces the ATG Traders
mobile design: gold/cream luxury fintech theme, bottom navigation, signal cards,
course progress, community feed and live chat, wallet with deposits/withdrawals,
monthly VIP subscriptions, notifications and a secure admin dashboard.

```
ATG/
├─ server/   Express + TypeScript + Prisma + MySQL + Socket.IO + Stripe/Web-Push
├─ client/   React + TypeScript + Vite + Tailwind + React Query + lightweight-charts
└─ mobile/   Expo + React Native client for Android, iOS, and web
```

> **Scope:** ATG Traders is a **signals & education** platform — **not** a trading or
> order-execution system. It never places trades, never connects to a broker/trading
> account, and never requires broker API keys. An administrator publishes each signal
> manually (instrument, BUY/SELL, entry, SL, TP, timestamps, updates, final result) and it
> appears automatically in the correct Free / Deriv VIP / Weltrade VIP room. Live market
> data and live payments are **optional integrations, disabled until configured**, and the
> app never fabricates prices, signals, payments or results.

---

## 0. Roles, membership & access model

Two independent axes:

- **`role`** — `USER` | `ADMIN`. Controls the admin dashboard and moderation powers.
- **`membership`** — `FREE` | `PAID` | `VIP_DERIV` | `VIP_WELTRADE`. Controls what content
  a user can see. An expired VIP membership automatically falls back to `FREE`.

Access is **hierarchical** — a higher tier inherits the lower ones:

| Membership     | Sees | 
| -------------- | ---- |
| `FREE`         | FREE signals, general rooms, free courses |
| `PAID`         | + all paid signals, both VIP rooms, paid courses *once a purchase is verified* |
| `VIP_DERIV`    | + **Deriv VIP** signals and the **Deriv VIP** room |
| `VIP_WELTRADE` | + **Weltrade VIP** signals and the **Weltrade VIP** room |

Key rules (all enforced on the **backend**):

- Signals have an **`audience`** (`FREE`/`PAID`/`VIP_DERIV`/`VIP_WELTRADE`); a user only
  receives signals at or below their membership. Locked content is visible-but-locked with
  an upgrade CTA (the API returns **402 `UPGRADE_REQUIRED`**).
- An admin **publishes, edits, updates and closes signals manually**. On publish the signal
  is automatically mirrored into the matching room (Free / Paid / Deriv VIP / Weltrade VIP)
  and that audience is notified; edits/status changes refresh the mirrored post, and deletes
  remove it. Nothing is generated automatically.
- The two VIP chat rooms are separate. An admin can **open/close chat independently** in each
  room; while closed, members cannot post (admin can still broadcast).
- **VIP membership does _not_ unlock paid courses.** A course needs either a verified
  `Purchase` (`status = PAID`) or an admin-granted enrollment.
- Payments are **never auto-fulfilled**. A checkout creates a `PENDING` purchase with manual
  payment instructions; access is granted only after an **admin verifies** the proof (or a
  correctly signed **Stripe webhook** arrives).
- Withdrawals **hold the funds at request time**; rejection refunds them, approval marks the
  transaction `COMPLETED`.

---

## 1. Quick start

ATG uses MySQL 8.0+ as its only application database. Create an empty database
with the case-sensitive `utf8mb4_0900_bin` collation, create a dedicated
application user, and set `DATABASE_URL` in `server/.env` to that user's
`mysql://` connection string. Do not use MySQL root credentials in the app.
Keep `.env` private and URL-encode any special characters in the password.
Before using `npm run db:setup` in development, set a unique
`ADMIN_SEED_PASSWORD` of at least 16 characters. The demo seed replaces demo
signals and resets the seeded administrator; it is disabled in production.
Production deployments must create the initial administrator with
`npm run admin:bootstrap --prefix server` against a new, empty database.

```bash
# from the repository root
npm run install:all        # installs server + client dependencies
npm run db:setup           # for a new/empty database only: generate + db push + seed

# terminal 1
npm run dev:server         # API  -> http://localhost:4000/api

# terminal 2
npm run dev:client         # app  -> http://localhost:5273
```

For an existing database, do not run the seed step. To run each side directly:

```bash
cd server
npm install
npm run prisma:generate
npm run prisma:push
npm run seed
npm run dev

cd ../client
npm install
npm run dev
```

### Run it on your phone / tablet (same Wi-Fi)

Both dev servers bind **`0.0.0.0`**, so any device on the same network can use the app.
When the API starts it prints the ready-to-use link, e.g.:

```
ATG Traders web  →  http://localhost:5273
On your network  →  http://192.168.1.42:5273
```

Open that **`On your network`** link on the other device — nothing else to configure.
The client is served on **5273** (not Vite's default 5173) so it never clashes with other
local projects; the client proxies `/api` and `/socket.io` to the API, so a device only
ever needs this one URL. If the link doesn't load, allow Node through the firewall for
private networks.

> `client/vite.config.ts` sets `server.host: true` + `strictPort: 5273`, and
> `server/src/index.ts` prints the LAN address(es) on boot.

### Android and iPhone app (Expo)

The React Native app in `mobile/` is the Android/iOS client and shares accounts
and data with the web app through the same Express API and MySQL database. Set
`EXPO_PUBLIC_API_URL` to the deployed HTTPS API origin, then run Expo:

```powershell
$env:EXPO_PUBLIC_API_URL = "https://api.example.com"
Set-Location .\mobile
npm install
npm run start
```

Tokens are stored with Expo SecureStore. See [the mobile client notes](./mobile/README.md)
for supported features and [the deployment guide](./docs/DEPLOYMENT.md) for EAS
builds. Preview builds must be tested on real devices against the deployed API
before store submission.

The separate React + Capacitor app in `client/` remains the web client and
contains the full admin operations suite. Native push delivery is not wired in
the Expo app yet.

Production has no default administrator credentials. Create its first admin
only through the one-time process in the deployment guide. Local demo seeding
requires a private `ADMIN_SEED_PASSWORD`; never use demo credentials in
production.

A branded splash screen is shown for **3 seconds** on first load.

The client Vite dev server proxies `/api` and `/socket.io` to `http://localhost:4000`,
so the API never has to be exposed to other devices directly.

---

## 2. Feature checklist

| Requirement | Status | Where |
| --- | --- | --- |
| Registration / login | ✅ | `server/src/routes/auth.routes.ts`, `client/src/pages/Login.tsx`, `Register.tsx` |
| Branded splash (3 s) | ✅ | `client/src/components/Splash.tsx` (wired in `App.tsx`) |
| Profiles & settings | ✅ | `/users/profile`, `client/src/pages/Profile.tsx`, `Settings.tsx` |
| Audience-scoped signals (pair + market/instrument group, BUY/SELL, entry/TP/SL) | ✅ | `signal.routes.ts`, `client/src/pages/Signals.tsx`; market chosen by the admin (default `Derived`) |
| Free-course cap (`MAX_FREE_COURSES`, default 5) | ✅ | enforced on create **and** on PATCH-to-free in `course.routes.ts` (409 when exceeded) |
| Manual publish / edit / close + auto room mirror | ✅ | `POST/PATCH/DELETE /api/signals`, `services/signalRooms.ts` |
| Optional live market-data chart (never fabricated) | ✅ | `/signals/:id/chart`, `services/marketData` — honest "not connected" state until a feed is set |
| Free + paid video courses & PDFs | ✅ | `course.routes.ts`, `CourseDetail.tsx` (video player + download list) |
| Admin course management (create/edit/lessons/resources/publish) | ✅ | `Admin.tsx` → **Courses** tab; `POST/PATCH/DELETE /api/courses...`, `/api/admin/resources` |
| Free vs. verified-purchase entitlement | ✅ | paid courses unlock only after a verified `Purchase` |
| Course progress tracking | ✅ | `/courses/:slug/progress`, progress bars + certificates |
| Certificate view + print-to-PDF | ✅ | `Certificates.tsx` / `CertificateView.tsx`; `GET /api/users/certificates`; print-only CSS |
| Community groups & separate VIP rooms | ✅ | `community.routes.ts`, `Community.tsx`, `GroupChat.tsx` (Socket.IO) |
| Per-room chat open/close by admin | ✅ | `PATCH /api/admin/groups/:id`, `GroupChat.tsx` |
| Manual payment verification (no auto-fulfil) | ✅ | `services/payments`, proof submission + admin verify |
| Stripe Checkout + signed webhook (optional) | ✅ | `services/payments` (live only when keys present) |
| Monthly subscriptions | ✅ | `subscription.routes.ts`, `Subscription.tsx`, renewal (creates a **pending purchase**) + cancel |
| Expiry notifications | ✅ | `jobs/subscriptionExpiry.ts` (daily cron: warn → expire → downgrade to FREE) |
| Purchase history | ✅ | `/payments/purchases`, `Purchases.tsx` |
| Push notifications | ✅ | Web Push (VAPID) + in-app; native device-token/FCM/APNs delivery is not wired |
| Secure admin dashboard | ✅ | `admin.routes.ts`, `Admin.tsx` (overview, signals, rooms, courses, users, payments, transactions, broadcast) |
| Deposits & withdrawals | ✅ | `wallet.routes.ts` — pending deposits, fund-holding withdrawals, admin settlement; methods: Local Bank Transfer, EcoCash, OneMoney, InnBucks, CashSmile |
| **Broker deposit & withdrawal management (Deriv / Weltrade)** | ✅ | `server/src/routes/brokerFunding.routes.ts`, `services/brokerFunding` — separate auditable ledger, review-before-approve, evidence-required completion, signed webhooks; UI: `/broker-funds` + Admin → **Broker Funds** — see [`docs/BROKER_FUNDING.md`](docs/BROKER_FUNDING.md) |
| **No trade execution / broker accounts** | ✅ | No order/trading endpoints exist; broker API keys are **not** required for manual signals |
| Real database | ✅ | Prisma + MySQL 8.0+ (the only application database) |
| Secure auth + RBAC | ✅ | bcrypt, JWT access/refresh, `role` USER/ADMIN, `membership` tiers, `requireAccess` / `requireVip` / `requireRole` |
| Validation, errors, loading states | ✅ | Zod on every write, error middleware, skeletons/spinners/toasts |
| Tests | ✅ | `server/src/tests/smoke.test.ts` + `brokerFunding.test.ts` (`npm test`, **58 checks**) |

---

## 3. Architecture

- **Layers:** `routes` → `services` → `lib/prisma`. Zod validates every write body.
- **Auth:** bcrypt(12) password hashing; short-lived **access JWT** + long-lived **refresh JWT**;
  the client auto-refreshes on `401`. `optionalAuth`, `requireAuth`, `requireRole`,
  `requireAccess` (membership tiers) and `requireVip`.
- **Permissions:** `lib/permissions.ts` is the single source of truth — `effectiveMembership`,
  `canAccess`, `allowedLevels`, `isAdmin`, `hasVerifiedPurchase`.
- **Realtime:** Socket.IO with JWT handshake — membership is re-resolved from the DB on every
  connect; `group:join` / `group:message` enforce room access **and** the chat-open flag.
- **Jobs:** `node-cron` daily subscription-lifecycle pass (warn + expire + downgrade to `FREE`).
- **Payments:** provider-agnostic. **Stripe Checkout** when keys are present; otherwise a
  **manual** provider that records a `PENDING` purchase with payment instructions and waits
  for an admin to verify. Nothing is ever marked paid automatically.
- **Withdrawals:** funds are held (wallet debited) at request time; admin approval completes,
  rejection refunds.
- **No execution layer:** there are no order/position/trading endpoints and no broker-account
  connection. Signals are informational and published by an admin only. `services/payments/providers.ts`
  handles **money in/out only** (deposits/withdrawals), manual by default.
- **Market data (optional):** `services/marketData` is disabled by default. When no feed is
  configured the chart endpoint reports `configured: false` and the UI shows a "Live chart not
  connected" state — candles are never invented. Point `MARKET_DATA_URL` at a real OHLC feed to
  enable live charts.

### Data model (Prisma)

`User, Wallet, Signal, Course, Lesson, Resource, Enrollment, LessonProgress,
Purchase, Subscription, Transaction, Group, GroupMember, GroupPost, PostLike,
Comment, Message, Notification, PushSubscription, WatchlistItem, Certificate,
BrokerTransaction, BrokerAuditLog, BrokerBalance`

---

## 4. API overview

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/auth/register` · `/login` · `/refresh` | public |
| GET/POST | `/api/auth/me` | current user incl. `membership` |
| GET/PATCH | `/api/users/profile` | profile + stats |
| GET | `/api/users/certificates` · `/certificates/:id` | owner-scoped earned certificates |
| GET | `/api/signals` · `/signals/:id` · `/signals/results` · `/signals/rooms/access` | filtered by membership audience |
| GET | `/api/signals/:id/chart?timeframe=` | live candles **only if** a market-data feed is configured (else `configured:false`) |
| POST/PATCH/DELETE | `/api/signals...` | **ADMIN** — publish/edit/close; sets `audience`, mirrors into the room + notifies |
| GET | `/api/courses` · `/courses/:slug` | lesson locks for non-entitled users; admins add `?all=true` to include drafts |
| POST | `/api/courses/:slug/enroll` · `/progress` | progress + certificates |
| POST/PATCH/DELETE | `/api/courses` · `/courses/:slug` · `/courses/:slug/lessons...` | **ADMIN** — create/edit/delete courses + lessons |
| GET/POST | `/api/community/groups` · `/posts` · `/posts/:id/like` · `/comments` | community |
| GET/POST | `/api/community/groups/:id/messages` | chat history / send (403 when chat closed) |
| GET | `/api/wallet` · `/wallet/transactions` | balance + history |
| POST | `/api/wallet/deposit` · `/withdraw` | deposit → `PENDING`; withdrawal holds funds |
| GET | `/api/broker/config` · `/balances` · `/deposits` · `/withdrawals` · `/transactions...` | customer broker funding (own records; balance only once verified) |
| POST | `/api/broker/deposits` · `/withdrawals` | customer funding request → `PENDING` (+ optional `Idempotency-Key`) |
| POST | `/api/broker/webhook/:broker` | **Deriv / Weltrade** callback (raw body, HMAC-verified, idempotent) |
| GET | `/api/admin/broker/deposits` · `/withdrawals` · `/stats` · `/audit` · `/balances` · `/transactions/:id` | **ADMIN** — queues, filters, verified balances, full audit |
| PATCH | `/api/admin/broker/transactions/:id` | **ADMIN** — `review / approve / start_processing / complete / reject / fail` (completion needs evidence) |
| GET | `/api/payments/config` · `/purchases` | checkout config / history |
| POST | `/api/payments/checkout` · `/purchases/:id/submit` | create purchase + submit payment proof |
| POST | `/api/payments/webhook` | **Stripe** (raw body, signature-verified) |
| GET/POST | `/api/subscriptions` · `/cancel` · `/renew` | VIP lifecycle (renew → pending purchase) |
| GET/POST | `/api/notifications...` · `/push/subscribe` | in-app + Web Push |
| GET | `/api/admin/stats` · `/users` · `/transactions` · `/purchases` · `/groups` | **ADMIN** |
| PATCH | `/api/admin/users/:id` | **ADMIN** — assign membership / admin role |
| PATCH | `/api/admin/transactions/:id` | **ADMIN** — approve / reject (settles wallet) |
| PATCH | `/api/admin/purchases/:id` | **ADMIN** — verify / reject a purchase |
| POST/PATCH | `/api/admin/broadcast` · `/resources` · `/groups/:id` | **ADMIN** — broadcast + room chat toggle |
| DELETE | `/api/admin/resources/:id` | **ADMIN** — remove a course download/ebook |

---

## 5. Integrations that require API keys / external accounts

The app runs fully **without any of these**. Deposits, withdrawals and course purchases then
flow through the **manual** path: records stay `PENDING` and an admin verifies them. Nothing
is ever auto-settled. Add the keys in `server/.env` to switch each capability to live.

| Integration | Env vars | Where to obtain | Notes |
| --- | --- | --- | --- |
| **Stripe** (card payments, subscriptions) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_VIP_MONTHLY` | https://dashboard.stripe.com/test/apikeys | Without keys → **manual** pending purchases. Live webhook: `POST /api/payments/webhook` (signature-verified). |
| **Web Push** | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | `npx web-push generate-vapid-keys` | Enables browser push; without keys only the in-app centre is used |
| **Native push delivery** | Not wired | APNs + Firebase Cloud Messaging | Requires native device-token registration and server delivery code before it can be enabled |
| **Deposits / withdrawals provider** | `PAYMENT_PROVIDER`, `PAYMENT_API_KEY`, `PAYMENT_API_SECRET` | Your contracted PSP aggregator (EcoCash / OneMoney / InnBucks / CashSmile / bank) | **Manual** by default — nothing auto-settles. Register a real adapter in `services/payments/providers.ts`. **Regulated activity — requires licensing + KYC/AML** |
| **Broker funding gateways** (Deriv / Weltrade deposits & withdrawals) | `BROKER_FUNDING_PROVIDER`, `DERIV_*`, `WELTRADE_*` (key/secret/base URL/webhook secret/funding paths/auth header), `BROKER_*` limits | Your Deriv & Weltrade API docs for the account type in use | **Manual by default.** A gateway goes live only when creds + webhook secret + endpoint paths are all set; otherwise requests stay admin-processed. Signed callbacks: `POST /api/broker/webhook/:broker`. Full reference: [`docs/BROKER_FUNDING.md`](docs/BROKER_FUNDING.md) |
| **Live market data** (optional charts) | `MARKET_DATA_PROVIDER`, `MARKET_DATA_URL`, `MARKET_DATA_API_KEY` | Any OHLC REST feed (your broker's market data, TwelveData, Polygon…) | **Disabled by default.** Until configured, `/api/signals/:id/chart` returns `configured:false` and the UI shows *"Live chart not connected"* — candles are never fabricated |
| **Production database** | `DATABASE_URL` | MySQL 8.0+ managed database | Configure a MySQL `mysql://` URL; MySQL is the only supported application database |
| **CDN for media** | — | S3 / Cloudflare R2 / Mux | Admins attach real lesson video/resource URLs; seeds ship with **no** fake media |
| **Email (verify/reset)** | not wired | SendGrid/Resend | Add a mailer if you want email verification |

> **Legal note:** holding client funds or moving money to third parties is regulated in most
> jurisdictions. Obtain the required licences and run KYC/AML before enabling a live
> deposit/withdrawal provider. ATG Traders does **not** offer brokerage and does **not**
> execute trades.

---

## 6. Testing

```bash
cd server && npm test
```

Boots the API on an ephemeral port and exercises registration, login, weak-password and
duplicate-email rejection, **audience-scoped signal visibility across all membership tiers**,
course entitlement (free vs. verified purchase), wallet deposit (stays `PENDING`) and
withdrawal (holds funds, rejection refunds), community posting + chat-open enforcement, and
RBAC (admin-only + unauthenticated access). It also guards the recent fixes:

- a signal published by an admin is **mirrored into the correct room** and removed on delete;
- an admin can **create a course, add/edit a lesson, attach/remove a resource, publish and delete**,
  while **drafts stay hidden** from non-admins (`?all=true` is admin-only);
- the **free-course cap** is enforced on both create and PATCH-to-free (`409` at the limit);
- a signal stores its **market/instrument group** (defaults to `Derived`);
- **completing every lesson issues a certificate** that is **owner-scoped** (list + fetch, unknown id → 404);
- the chart endpoint **never fabricates candles** (`configured:false` when no feed is set);
- there is **no trade-execution endpoint** (`/api/broker/order` → 404);
- wrong-current-password returns **401** and liking/commenting a missing post returns **404**
  (previously unhandled **500**s).

A second suite (`server/src/tests/brokerFunding.test.ts`) covers the broker funding module:

- config & gateway readiness (disabled until creds + webhook secret + paths exist), RBAC,
  deposit/withdrawal limits, idempotent resubmits, duplicate open requests, daily withdrawal
  cap, ownership (`404` for another user's request), **masked** admin lists + filters;
- lifecycle enforcement: withdrawals **cannot** be approved before `UNDER_REVIEW`, completion
  **without evidence is refused** (`EVIDENCE_REQUIRED`), every action lands in the audit log,
  internal notes stay hidden from the customer timeline;
- verified balances are hidden until verified; a **signature-verified webhook** is the only
  automated path to `COMPLETED` (replays ignored, bad signature rejected, broker without a
  secret rejects every callback, unknown reference → 404, settlement cannot bypass review);
- **ledger separation**: broker money never touches the wallet/purchase ledgers.

**30/30 smoke checks + 28/28 broker funding checks pass** on a clean DB.

Both sides also typecheck cleanly:

```bash
cd server && npx tsc -p tsconfig.json --noEmit
cd client && npx tsc --noEmit
```

---

## 7. Design fidelity

Matched to the supplied reference: warm cream background, white rounded cards with soft
shadows, gold gradient (`#F3D98B → #D4AF37 → #A67C00`) primary buttons and accents,
Poppins typography, pill filter chips, gold line-icons, green/red BUY/SELL pills,
balance card with sparkline, course progress bars, candlestick chart, and the five-item
bottom navigation (Home · Education · Signals · Community · Profile) which becomes a
sidebar on tablets/desktop. Fully responsive (Android, iPhone, tablet, PC).

## 8. Going to production

For the Railway + MySQL shared cloud deployment and Android/iPhone connection
steps, see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

The server is built for a **single origin in production**: it serves the compiled
client (`client/dist`) itself, so there is no Vite and no second hostname to secure.

### 8.1 Build & run

```bash
npm run install:all
npm run build              # client -> client/dist, server -> server/dist

# one-shot
cd server && NODE_ENV=production npm run start

# or as a supervised service (recommended)
npm install -g pm2
npm run start:pm2          # pm2 start ecosystem.config.cjs --env production
pm2 save && pm2 startup    # survive reboots
```

`SERVE_CLIENT=auto` (default) serves the build whenever `client/dist/index.html`
exists; set `true`/`false` to force it. Hard refreshes and deep links
(`/broker-funds`, `/admin`) fall back to the SPA shell.

### 8.2 Secrets & environment (the server refuses to boot without these)

```bash
cd server && cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # twice
```

| Variable | Required | Notes |
| --- | --- | --- |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | ✅ | ≥ 32 chars, different values. Production **refuses to start** on the dev defaults. |
| `NODE_ENV` | ✅ | `production` enables the CORS allowlist, immutable asset caching, stricter boot checks |
| `ALLOWED_ORIGINS` | ✅ | comma-separated https origins; everything else is rejected |
| `PUBLIC_URL` | ✅ | canonical https URL (webhooks + notification links) |
| `TRUST_PROXY` | if behind nginx/cloudflare | hop count so rate limits see real client IPs |
| `RATE_LIMIT_*` / `AUTH_RATE_LIMIT_MAX` | optional | global API bucket (300/15 min) + auth bucket (20/15 min) |
| `DATABASE_URL` | ✅ | MySQL 8.0+ connection string; all application environments use MySQL |

### 8.3 Refresh-token security (built in)

- Refresh tokens are **rotated on every use**; only SHA-256 hashes are stored
  (a DB leak never exposes a usable token).
- Replaying an old token is tolerated **once** within a 30 s grace window
  (concurrent tabs), then the whole session family is revoked → `401`.
- `POST /api/auth/logout` revokes server-side immediately; password changes should
  call the same revoke.
- Tampered/expired refresh tokens return `401` (never `500`).

### 8.4 Reverse proxy (nginx)

```nginx
server {
  server_name yourdomain.com;
  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;      # Socket.IO websockets
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Set `TRUST_PROXY=1` (or `2` behind a CDN) so rate limiting and audit logs record the
real client IP. Terminate TLS at the proxy — HTTPS is mandatory for Web Push and
broker webhooks.

### 8.5 Before you take real money

1. MySQL 8.0+ with automated, restorable backups. Review schema changes before
   applying `prisma db push` to an existing database.
2. Stripe (or a PSP) live keys; VAPID keys for Web Push; SMTP for email flows.
3. Broker gateway credentials — see [`docs/BROKER_FUNDING.md`](docs/BROKER_FUNDING.md).
4. Replace the seeded demo content, change the admin password.
5. Licensing + KYC/AML before enabling any deposit/withdrawal provider — ATG Traders
   holds no brokerage licence and executes no trades.
