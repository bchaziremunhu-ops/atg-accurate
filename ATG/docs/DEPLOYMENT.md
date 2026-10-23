# Deploy ATG with one shared cloud database

ATG's web, Android, and iPhone clients all use the same Express API. The API is
the only service that connects to MySQL; mobile apps must never connect directly
to the database. Socket.IO chat also connects to this API over HTTPS/WebSocket.

This guide uses Railway for the API and MySQL services. Hosting requires a
Railway account, a connected GitHub repository, and a paid plan suitable for
persistent financial records. Do not put production credentials in Git.

## 1. Create cloud services

1. Push this repository to a private GitHub repository.
2. Create a Railway project from the repository, with its root at the repository
   root. `railway.toml` configures the API build, start command, and health path.
3. Add a Railway MySQL service in the same project and environment. Keep it on
   private networking; do not create a public TCP proxy for normal app traffic.
4. Set the app service's `DATABASE_URL` to Railway's private MySQL connection
   URL using a Railway variable reference, not a copied credential.
5. Generate independent random `JWT_SECRET` and `JWT_REFRESH_SECRET` values of
   at least 32 characters, and add them as private app service variables.
6. After Railway generates the app's HTTPS domain, set `PUBLIC_URL` and
   `CLIENT_ORIGIN` to that origin. Set `ALLOWED_ORIGINS` to the same origin if
   using a separate frontend. Keep the API and frontend on one origin unless
   there is a clear need for a separate site.
7. Deploy and confirm `https://<app-domain>/api/health` returns HTTP 200 and
   that the deployment's Socket.IO/WebSocket connection succeeds.

Enable scheduled MySQL volume backups before importing production records.
Confirm how to restore a backup. Take an additional manual backup immediately
before and after the import.

## 2. Create the schema and import data

The checked-in PostgreSQL backups and MySQL snapshot are local rollback artifacts;
they are not uploaded by a normal Git deployment. Keep them in the restricted
backup folder and transfer them only to a trusted, authenticated workstation.

Before first import:

1. Use a separate cloud MySQL database/environment as a staging target. Set its
   `DATABASE_URL` only in a private local shell for the migration operator.
2. Run `npm ci --prefix server`, then
   `npm run prisma:generate --prefix server`.
3. Create the schema with `npm run prisma:push --prefix server`. This syncs the
   Prisma schema; review any proposed changes and do not use a reset or
   `--accept-data-loss` option.
4. Import the frozen, verified snapshot from a trusted workstation with
   `node server/scripts/import-mysql-snapshot.mjs <private-snapshot.json>`.
   Verify all rows with
   `node server/scripts/verify-mysql-snapshot.mjs <private-snapshot.json>`.
   Both scripts require `DATABASE_URL` in the operator's private environment,
   refuse a populated import target, and avoid printing record contents.
5. Deploy the API against the imported staging database. Test sign-in, account
   recovery, permissions, courses, signals, community chat, notifications,
   payments, wallet withdrawals, broker-funding requests, and admin review.
6. To cut over, freeze writes to the old system, take a final consistent
   snapshot, import/verify it, change the app's private `DATABASE_URL` to the
   accepted cloud database, and redeploy. Keep the source and rollback backups
   until written acceptance plus the agreed retention period.

Do not run the seed command against imported production data. The seed script
updates the administrator credentials and replaces demo signals/courses.

## 3. Connect Android and iPhone

Native builds embed the API origin at build time. Once the cloud HTTPS domain is
verified, build the web assets and native packages with that URL:

```powershell
Set-Location .\client
$env:VITE_API_URL = "https://<app-domain>"
npm.cmd ci
npm.cmd run build
npx.cmd cap sync android
npx.cmd cap sync ios
```

Build/sign the Android APK/AAB using Android tooling. iOS signing, archiving,
and device installation require macOS and Xcode (or a trusted cloud macOS
builder). Install test builds on actual devices and verify that multiple phones
can sign into the same accounts, see the same records, and exchange community
chat messages. Native push notifications additionally require APNs/FCM
credentials and device-token registration; they are not activated by this
database deployment alone.

The existing web client automatically uses its own origin for the API when
`VITE_API_URL` is unset, so a single-origin web deployment needs no public
database URL. Do not expose MySQL port 3306 to the public internet.
