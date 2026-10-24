# Deploy ATG with one shared cloud database

ATG's web, Android, and iPhone clients all use the same Express API. The API is
the only service that connects to MySQL; mobile apps must never connect directly
to the database. Socket.IO chat also connects to this API over HTTPS/WebSocket.

This guide uses Railway for the API and MySQL services. In this checkout the
application lives in the `ATG/` directory under the Git repository root; set
Railway's service root directory to `/ATG`. Hosting requires a
Railway account, a connected GitHub repository, and a paid plan suitable for
persistent financial records. Do not put production credentials in Git.

## 1. Create cloud services

1. Push this repository to a private GitHub repository. The root `.gitignore`
   and `ATG/.gitignore` exclude local editor files, environment files, database
   backups, and logs.
2. Create a Railway project from the repository and set the service root
   directory to `/ATG`. `railway.toml` configures the API build, start command,
   and health path.
3. Add a Railway MySQL service in the same project and environment. Keep it on
   private networking; do not create a public TCP proxy for normal app traffic.
4. Set the app service's `DATABASE_URL` to Railway's private MySQL connection
   URL using a Railway variable reference, not a copied credential.
5. Set `NODE_ENV=production`. Generate independent random `JWT_SECRET` and
   `JWT_REFRESH_SECRET` values of at least 32 characters, and add them as
   private app service variables.
6. Attach the owned `atg.com` domain to the app service, configure the DNS
   records Railway provides, and wait for HTTPS/TLS verification. Set
   `PUBLIC_URL` and `CLIENT_ORIGIN` to `https://atg.com`. Set `ALLOWED_ORIGINS`
   to the same origin if using a separate frontend. Keep the API and frontend
   on one origin unless there is a clear need for a separate site.
7. Add a Railway persistent volume to the app service, mounted at `/data`, and
   set `AVATAR_DIR=/data/avatars` in the app service variables. Avatar files
   must live on persistent storage so they survive deploys and restarts.

## 2. Create the schema and initial administrator

This deployment starts with a new, empty MySQL database; do not import local
database backups. Install the Railway CLI, authenticate in your browser, and
link it to the project:

```powershell
npm.cmd install --global @railway/cli
railway login
railway link
```

Then use the API service's private environment to prepare the database:

```powershell
npm.cmd ci --prefix ATG\server
railway run --service <api-service> npm.cmd run prisma:generate --prefix ATG\server
railway run --service <api-service> npm.cmd run prisma:push --prefix ATG\server
```

Create the administrator once by setting `BOOTSTRAP_ADMIN_EMAIL`,
`BOOTSTRAP_ADMIN_NAME`, and a unique `BOOTSTRAP_ADMIN_PASSWORD` of at least 16
characters as private Railway service variables, then run:

```powershell
railway run --service <api-service> npm.cmd run admin:bootstrap --prefix ATG\server
```

The bootstrap refuses to run if any user already exists. Remove the one-time
`BOOTSTRAP_ADMIN_PASSWORD` variable from Railway as soon as account creation
succeeds. Do not run the demo seed in production.

Deploy the API and verify `https://<app-domain>/api/health` returns HTTP 200.
Before opening registration or accepting payments, test administrator sign-in,
registration, profile/avatar persistence, community, signals, permissions, and
the payment flows you intend to enable. Enable scheduled MySQL backups and
confirm the restore process.

## 3. Connect Android and iPhone

Native builds embed the API origin at build time. Once the cloud HTTPS domain is
verified, configure the app from `ATG\mobile`:

```powershell
Set-Location .\ATG\mobile
npx.cmd eas-cli@latest login
npx.cmd eas-cli@latest build:configure
```

After configuration creates the Expo project, set `EXPO_PUBLIC_API_URL` to the
same HTTPS origin in that project's environment settings for preview and
production. It is public client configuration, not a secret. Then build:

```powershell
npx.cmd eas-cli@latest build --platform all --profile preview
```

The `mobile/eas.json` preview profile creates an Android APK for internal
testing and an iOS internal build. `build:configure` links this app to the Expo
account and adds its project ID to the local app configuration. Use the
production profile for store artifacts after testing and completing the
Android/Apple store account and signing setup. Install preview builds on
devices and verify that multiple phones sign into the same accounts, see the
same records, and exchange community chat messages. Native push notifications
additionally require APNs/FCM credentials and device-token registration; they
are not activated by this database deployment alone.

The existing web client automatically uses its own origin for the API when
`VITE_API_URL` is unset, so a single-origin web deployment needs no public
database URL. Do not expose MySQL port 3306 to the public internet.
