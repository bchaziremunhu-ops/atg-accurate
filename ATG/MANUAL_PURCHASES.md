# Manual purchase approval

Paid course and membership purchases use the manual review flow; broker funding and withdrawals are separate.

## Customer flow

1. Open a paid course or a membership package and choose **Request purchase / renewal**.
2. Review the price, currency, membership duration, rooms, activation rule, and admin-configured payment instructions.
3. Submit the exact listed amount, payment method, transaction reference, optional payment date/note, and a JPEG, PNG, or WebP proof image no larger than 5 MB.
4. Track the request and decision in **Profile → Purchase History**. Requests can be cancelled until they are decided. Access is granted only after an admin checks and confirms receipt of the payment.

## Admin flow

Open **Admin → Purchase Requests** to configure payment instructions and membership packages, or review requests. Course prices, currencies, and sale status remain editable in the existing course manager. A request retains its item, price, currency, duration, rooms, and activation-rule snapshot if a package changes later.

Admins may mark a request under review, reject it with a reason, or approve it after confirming payment independently. Reused transaction references are flagged and require an investigation note before approval. Decision history records the actor, timestamp, status, reason, customer message, and internal notes; internal notes are not returned to customers.

Course approval creates a paid purchase, receipt, and enrollment for that course only. Membership approval creates room-specific entitlements. A package can start on approval or after current access for each included room; expiry is enforced by access checks. Renewal uses the same request and approval flow. A daily server job sends one-time reminders within three days and one day of each room entitlement's expiry, and a one-time expiry notice. A unique database record prevents duplicate notices if the job runs more than once.

## Database and private proof storage

The application uses MySQL. The additive Prisma schema update is applied with the `prisma:push` npm script from `server`. Back up the database before applying schema changes. Do not use destructive flags or point this workflow at PostgreSQL.

Proof images are written outside public static content. The default is `server/private/purchase-proofs`; set `PURCHASE_PROOF_DIR` to a durable private directory in production and ensure only the application process can read it. The authenticated proof endpoint permits only the request owner and admins.

The pre-change source and MySQL data exports are in `backups/`. Keep those backups protected because they may contain customer data.

## Local validation

Configure `server/.env` with the MySQL URL and auth secrets, apply the schema with `npm run prisma:push` from `server`, then start the API and client in separate terminals with `npm run dev` from `server` and `client`. The defaults are API port `4000` and client port `5273`.

For validation, run `npm run build` from both `server` and `client`. Database test suites create temporary records and therefore refuse to run unless `DATABASE_URL` names an isolated MySQL database ending in `_test` (for example, `atg_mysql_test`). Set the test URL in the shell before running the suites:

```powershell
$env:DATABASE_URL = "mysql://<user>:<password>@127.0.0.1:3306/atg_mysql_test"
npm test
$env:RUN_MANUAL_PURCHASE_TESTS = '1'
npm run test:manual-purchases
```

The manual purchase integration checks create temporary uniquely named users, course/package requests, and VIP rooms, then clean up those fixtures and uploaded proof files. Never point these suites at the live `atg_mysql` database.

The existing daily subscription scheduler also processes manual room-entitlement reminders. Legacy Paynow-independent subscriptions continue using the existing scheduler behavior.
