# ATG Traders React Native client

This Expo application is the React Native client for ATG Traders. It uses Expo
Router and the existing Express API and database. The React + Capacitor client
remains available for workflows not yet matched in the native app.

## Native features

- Registration, account recovery, secure token storage, and refresh
- Home, signals, saved pairs, course catalog/details, enrollment, and progress
- Native lesson video playback and PDF certificate sharing
- Community feed and authenticated Socket.IO group chat
- Profile, settings, notifications, wallet, broker funding, membership, and
  manual purchase requests with native proof-image selection
- Purchase history, receipts, support, and certificates
- Admin sections for overview, signals, rooms, courses/lessons/resources,
  purchase requests, users, payments/refunds/audit, transactions, broker funds,
  Weltrade accounts, and broadcasts
- A persisted read-only course catalog for offline viewing

The offline cache is intentionally limited to the course catalog. It is not the
web client's local database/demo mode, and other member or admin workflows
still require a connection.

## Setup

Use an API origin reachable from the device. Native API requests require HTTPS.

```powershell
$env:EXPO_PUBLIC_API_URL = "https://api.example.com"
npm install
npm run start
```

Native remote push requires an EAS project ID and valid Android/iOS push
credentials. Set `EXPO_PUBLIC_EAS_PROJECT_ID` for local builds or add the
project ID to `expo.extra.eas.projectId`; configure APNs/FCM credentials in
EAS. Push registration is opt-in from Notifications. The server also needs
outbound access to Expo's push service.

`npm run typecheck` and `npm run lint` validate the TypeScript sources.
`npx expo export --platform android --platform ios --platform web` validates
the platform bundles. A signed Android package requires Android build tooling
and signing configuration; iOS signing requires macOS, Xcode, and Apple
credentials.

## Remaining parity notes

The persisted catalog is not a full offline/demo implementation. Some
specialized web admin workflows (including detailed broker-funding
reconciliation and payment date-range reporting) remain web-only. Production
push delivery and signed store artifacts also require project credentials and
build configuration that are not stored in this repository.
