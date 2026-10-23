import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// src/config -> server/.env, dist/src/config -> server/.env (one level deeper)
const serverRoot = existsSync(path.resolve(__dirname, '../../prisma/schema.prisma'))
  ? path.resolve(__dirname, '../..')
  : path.resolve(__dirname, '../../..');
const envCandidates = [
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../../../.env'),
  path.resolve(process.cwd(), '.env'),
];
dotenv.config({ path: envCandidates.find((p) => existsSync(p)) ?? envCandidates[0] });

function optional(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}

export const env = {
  nodeEnv: optional('NODE_ENV', 'development'),
  host: optional('HOST', '0.0.0.0'),
  port: Number(optional('PORT', '4000')),
  clientOrigin: optional('CLIENT_ORIGIN', 'http://localhost:5273'),
  publicUrl: optional('PUBLIC_URL', 'http://localhost:5273'),
  databaseUrl: optional('DATABASE_URL'),

  jwtSecret: optional('JWT_SECRET', 'dev-secret'),
  jwtRefreshSecret: optional('JWT_REFRESH_SECRET', 'dev-refresh-secret'),
  accessTokenTtl: optional('ACCESS_TOKEN_TTL', '15m'),
  refreshTokenTtl: optional('REFRESH_TOKEN_TTL', '30d'),

  // ---- Production / hardening ----
  // Comma-separated CORS allowlist used in production (dev reflects any origin).
  allowedOrigins: optional('ALLOWED_ORIGINS', ''),
  // 'false' (default) | 'true' | hop count | IP list — set when behind a reverse proxy.
  trustProxy: optional('TRUST_PROXY', 'false'),
  rateLimitWindowMs: Number(optional('RATE_LIMIT_WINDOW_MS', String(15 * 60_000))),
  rateLimitMax: Number(optional('RATE_LIMIT_MAX', '300')),
  authRateLimitMax: Number(optional('AUTH_RATE_LIMIT_MAX', '20')),
  // Account-recovery endpoints (/api/auth/forgot/*) — deliberately stricter
  // than general auth because they are the only password-reset path.
  recoveryRateLimitMax: Number(optional('RECOVERY_RATE_LIMIT_MAX', '10')),
  // auto = serve client/dist whenever it exists (production build); true/false force it.
  serveClient: optional('SERVE_CLIENT', 'auto'),
  clientDistDir: optional('CLIENT_DIST', ''),
  purchaseProofDir: optional('PURCHASE_PROOF_DIR', path.resolve(serverRoot, 'private', 'purchase-proofs')),

  stripeSecretKey: optional('STRIPE_SECRET_KEY'),
  stripeWebhookSecret: optional('STRIPE_WEBHOOK_SECRET'),
  stripePriceVipMonthly: optional('STRIPE_PRICE_VIP_MONTHLY'),
  stripeCurrency: optional('STRIPE_CURRENCY', 'usd'),

  vapidPublicKey: optional('VAPID_PUBLIC_KEY'),
  vapidPrivateKey: optional('VAPID_PRIVATE_KEY'),
  vapidSubject: optional('VAPID_SUBJECT', 'mailto:admin@atgtraders.example'),

  fcmServerKey: optional('FCM_SERVER_KEY'),

  // Deposits / withdrawals provider (manual by default — never auto-settles).
  paymentProvider: optional('PAYMENT_PROVIDER', 'manual'),
  paymentApiKey: optional('PAYMENT_API_KEY'),
  paymentApiSecret: optional('PAYMENT_API_SECRET'),

  // Optional live market data. Disabled unless a provider + URL are configured.
  marketDataProvider: optional('MARKET_DATA_PROVIDER', 'disabled'),
  marketDataUrl: optional('MARKET_DATA_URL'),
  marketDataApiKey: optional('MARKET_DATA_API_KEY'),

  // ---- Broker funding (Deposits into / withdrawals out of Deriv & Weltrade) ----
  // Manual by default: nothing is ever marked Completed without real evidence.
  brokerFundingProvider: optional('BROKER_FUNDING_PROVIDER', 'manual'),
  brokerCurrency: optional('BROKER_CURRENCY', 'USD').toUpperCase(),

  // Deriv gateway — disabled until both the API key and the webhook secret exist.
  derivApiKey: optional('DERIV_API_KEY'),
  derivApiSecret: optional('DERIV_API_SECRET'),
  derivAppId: optional('DERIV_APP_ID'),
  derivBaseUrl: optional('DERIV_BASE_URL', 'https://api.deriv.com'),
  derivWebhookSecret: optional('DERIV_WEBHOOK_SECRET'),
  derivFundingDepositPath: optional('DERIV_FUNDING_DEPOSIT_PATH'),
  derivFundingWithdrawPath: optional('DERIV_FUNDING_WITHDRAW_PATH'),
  derivFundingBalancePath: optional('DERIV_FUNDING_BALANCE_PATH'),
  derivFundingAuthHeader: optional('DERIV_FUNDING_AUTH_HEADER', 'Authorization'),
  derivFundingAuthScheme: optional('DERIV_FUNDING_AUTH_SCHEME', 'Bearer'),
  derivWebhookHeader: optional('DERIV_WEBHOOK_HEADER', 'X-ATG-Signature'),

  // Weltrade gateway — disabled until both the API key and the webhook secret exist.
  weltradeApiKey: optional('WELTRADE_API_KEY'),
  weltradeApiSecret: optional('WELTRADE_API_SECRET'),
  weltradeBaseUrl: optional('WELTRADE_BASE_URL', 'https://api.weltrade.com'),
  weltradeWebhookSecret: optional('WELTRADE_WEBHOOK_SECRET'),
  weltradeFundingDepositPath: optional('WELTRADE_FUNDING_DEPOSIT_PATH'),
  weltradeFundingWithdrawPath: optional('WELTRADE_FUNDING_WITHDRAW_PATH'),
  weltradeFundingBalancePath: optional('WELTRADE_FUNDING_BALANCE_PATH'),
  weltradeFundingAuthHeader: optional('WELTRADE_FUNDING_AUTH_HEADER', 'Authorization'),
  weltradeFundingAuthScheme: optional('WELTRADE_FUNDING_AUTH_SCHEME', 'Bearer'),
  weltradeWebhookHeader: optional('WELTRADE_WEBHOOK_HEADER', 'X-ATG-Signature'),

  // Official Weltrade sign-up page the dashboard card links to. Deliberately
  // empty by default: the app must never invent a referral URL or imply a
  // partnership, so an operator sets this to the link they are entitled to use.
  weltradeRegisterUrl: optional('WELTRADE_REGISTER_URL'),

  // Server-side limits (all enforced on every request, never only on the client).
  brokerDepositMin: Number(optional('BROKER_DEPOSIT_MIN', '10')),
  brokerDepositMax: Number(optional('BROKER_DEPOSIT_MAX', '50000')),
  brokerWithdrawalMin: Number(optional('BROKER_WITHDRAWAL_MIN', '10')),
  brokerWithdrawalMax: Number(optional('BROKER_WITHDRAWAL_MAX', '50000')),
  brokerWithdrawalDailyMax: Number(optional('BROKER_WITHDRAWAL_DAILY_MAX', '20000')),
  brokerPendingLimit: Number(optional('BROKER_PENDING_LIMIT', '5')),
  // Admin fee taken on deposits (% of the requested amount). Default 0 so the
  // app never silently charges; admins set the real rate in Admin → Broker
  // Funds → Limits (stored in Setting, overrides this default).
  brokerDepositFeePct: Number(optional('BROKER_DEPOSIT_FEE_PCT', '0')),

  // ATG wallet withdrawals are manually paid by an administrator until a
  // real payout provider is configured. Fee defaults to zero and is snapshotted
  // on each request.
  walletWithdrawalMin: Number(optional('WALLET_WITHDRAWAL_MIN', '1')),
  walletWithdrawalMax: Number(optional('WALLET_WITHDRAWAL_MAX', '50000')),
  walletWithdrawalFeePct: Number(optional('WALLET_WITHDRAWAL_FEE_PCT', '0')),

  // Free courses are capped so the paid catalogue stays the main offer.
  maxFreeCourses: Number(optional('MAX_FREE_COURSES', '5')),
};

if (!env.databaseUrl || !/^mysql:\/\//i.test(env.databaseUrl)) {
  throw new Error('DATABASE_URL must be set to a MySQL connection string');
}

export const integrations = {
  stripe: Boolean(env.stripeSecretKey),
  stripeWebhook: Boolean(env.stripeWebhookSecret),
  webPush: Boolean(env.vapidPublicKey && env.vapidPrivateKey),
  fcm: Boolean(env.fcmServerKey),
  payments: env.paymentProvider !== 'manual' && Boolean(env.paymentApiKey),
  marketData: env.marketDataProvider !== 'disabled' && Boolean(env.marketDataUrl),

  // A broker gateway is only "live" when BOTH a credential set and a webhook
  // secret are present — otherwise requests run through manual admin review.
  derivFunding: Boolean(env.derivApiKey && env.derivApiSecret && env.derivWebhookSecret),
  weltradeFunding: Boolean(env.weltradeApiKey && env.weltradeApiSecret && env.weltradeWebhookSecret),
};

export function isProduction(): boolean {
  return env.nodeEnv === 'production';
}

/** CORS `origin` option: allowlist in production, reflect any origin in dev. */
export function corsOrigin(): true | string[] {
  if (!isProduction()) return true;
  const list = env.allowedOrigins
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return [...new Set([...list, env.clientOrigin, 'capacitor://localhost', 'https://localhost'])];
}

const WEAK_SECRETS = new Set([
  'dev-secret',
  'dev-refresh-secret',
  'changeme',
  'change-me',
  'secret',
  'password',
  'atg-local-dev-secret-change-me',
  'atg-local-dev-refresh-change-me',
]);

/**
 * Refuses to boot production with development/default secrets. Called once at
 * startup — a weak JWT secret lets anyone mint an admin token.
 */
export function assertProductionEnv(): void {
  if (!isProduction()) return;
  const problems: string[] = [];
  for (const [name, value] of [
    ['JWT_SECRET', env.jwtSecret],
    ['JWT_REFRESH_SECRET', env.jwtRefreshSecret],
  ] as const) {
    if (!value || value.length < 32 || WEAK_SECRETS.has(value.toLowerCase())) {
      problems.push(`${name} must be set to a random string of at least 32 characters`);
    }
  }
  if (env.jwtSecret === env.jwtRefreshSecret) {
    problems.push('JWT_SECRET and JWT_REFRESH_SECRET must be different');
  }
  if (!env.publicUrl.startsWith('https://')) {
    console.warn('[warn] PUBLIC_URL is not https:// — Web Push and broker webhooks will not work.');
  }
  if (problems.length) {
    throw new Error(
      `Refusing to start in production:\n  - ${problems.join('\n  - ')}\n` +
        'Generate them with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"',
    );
  }
}
