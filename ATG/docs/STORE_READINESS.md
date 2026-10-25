# App Store / Play Store Release Readiness

This checklist covers the final review-readiness stage for ATG Traders before publishing to the Apple App Store and Google Play Store.

## 1. Required legal and review assets

- Privacy Policy: completed in [docs/PRIVACY_POLICY.md](PRIVACY_POLICY.md)
- Terms of Service: completed in [docs/TERMS_OF_SERVICE.md](TERMS_OF_SERVICE.md)
- Support contact page and support email in the app
- Account deletion / data access request path for users
- Clear statement that ATG is an educational platform and not a regulated broker or investment advisor

## 2. App identity and store metadata

- App name: ATG Traders
- Bundle ID / package name:
  - Android: `com.atg.traders`
  - iOS: `com.atg.traders`
- Expo project already configured in [mobile/app.json](../mobile/app.json)
- EAS project ID already configured in [mobile/app.json](../mobile/app.json)
- Production API URL should be set in [mobile/eas.json](../mobile/eas.json)

## 3. Store submission requirements

### Apple App Store

- Apple Developer Program membership required
- App Store Connect app created
- iOS bundle identifier confirmed
- signing certificate and provisioning profile configured
- screenshots for iPhone and iPad device sizes
- privacy nutrition label completed
- age rating completed
- app review notes prepared
- support URL and privacy policy URL added

### Google Play Store

- Google Play Console account and app created
- Android package name confirmed
- signing key generated and uploaded
- Play App Integrity / Firebase setup only if using native push notifications; Firebase is not the app database or realtime layer
- store listing content and screenshots prepared
- content rating completed
- data safety form completed
- privacy policy URL provided

## 4. Policy / compliance notes

This app handles:

- account registration and authentication
- profile data and security answers
- course and signal access
- wallet and payment records
- community chat messages
- push notification tokens
- broker funding records and audit logs

Because the app includes financial education and member access flows, the store review should clearly present it as:

- educational content and signal discussion
- not a broker execution platform
- not a regulated financial adviser
- not a live trading execution system

## 5. Production readiness confirmation

Before publishing, verify the following in production:

- `/api/health` returns HTTP 200
- admin bootstrap works on a fresh database
- user registration, login, and refresh work
- payments are configured only where required
- push permission flow works on native devices
- Socket.IO chat works over HTTPS/WSS
- wallet / withdrawals / broker funding flows are fully tested
- logs and DB backups are enabled
- support and deletion workflows are documented

## 6. Recommended launch order

1. Deploy backend and PostgreSQL to production
2. Confirm API and admin access
3. Build native preview builds with EAS
4. Test on real devices
5. Complete privacy/data-safety forms
6. Submit for App Store / Play review
7. Release beta or internal testing before public launch

## 7. Final release gate

Only release to the public after:

- production API is stable
- all legal pages are live and linked
- the app has real device testing
- push and realtime flows have been tested live
- payment flows have been reviewed and approved
- app-review metadata is complete

---

This checklist is intentionally practical and store-focused. It complements the technical deployment instructions in [DEPLOYMENT.md](DEPLOYMENT.md).
