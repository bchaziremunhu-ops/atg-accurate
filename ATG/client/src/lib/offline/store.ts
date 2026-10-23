/**
 * On-device database for the explicitly selected offline/demo mode.
 *
 * This is separate from the shared server database and must not be used for
 * shared accounts or production transactions. The seed mirrors server demo
 * content; mutations persist in localStorage on this device.
 */

import type {
  BrokerAuditEntry,
  BrokerFundingStatus,
  BrokerId,
  BrokerSettings,
  Membership,
} from '../types';

export interface UserRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  /** Canonical international number (`+263771234567`) — new registrations only. */
  phoneE164?: string | null;
  passwordHash: string;
  country: string | null;
  nationality?: string | null;
  /** ISO date string (YYYY-MM-DD). */
  dateOfBirth?: string | null;
  address?: string | null;
  securityQuestion?: string | null;
  /** PBKDF2/scrypt-style hash of the normalised answer — never plaintext. */
  securityAnswerHash?: string | null;
  termsAcceptedAt?: string | null;
  privacyAcceptedAt?: string | null;
  recoveryAttempts?: number;
  recoveryLockedUntil?: string | null;
  bio: string | null;
  avatarUrl: string | null;
  role: 'USER' | 'ADMIN';
  membership: Membership;
  isVip: boolean;
  vipExpiresAt: string | null;
  wallet: { id: string; balance: number; currency: string };
  createdAt: string;
}

/** On-device analogue of the server SecurityEvent audit log. */
export interface SecurityEventRow {
  id: string;
  userId: string | null;
  phoneE164: string | null;
  type: string;
  meta?: string | null;
  createdAt: string;
}

export interface SignalRow {
  id: string;
  pair: string;
  market: string;
  direction: 'BUY' | 'SELL';
  entry: number | null;
  takeProfit: number | null;
  stopLoss: number | null;
  timeframe: string;
  tier: 'FREE' | 'VIP';
  audience: 'FREE' | 'PAID' | 'VIP_DERIV' | 'VIP_WELTRADE';
  status: 'OPEN' | 'HIT_TP' | 'HIT_SL' | 'CANCELLED';
  resultPips: number | null;
  resultPct: number | null;
  analysis: string | null;
  chartUrl: string | null;
  publishedAt: string;
  closedAt: string | null;
  authorId: string;
}

export interface LessonRow {
  id: string;
  title: string;
  description: string | null;
  videoUrl: string | null;
  durationMin: number;
  order: number;
  isFree: boolean;
}

export interface CourseRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  level: string;
  order: number;
  price: number;
  isVip: boolean;
  published: boolean;
  coverUrl: string | null;
  lessons: LessonRow[];
  resources: ResourceRow[];
}

export interface ResourceRow {
  id: string;
  courseId: string | null;
  title: string;
  type: string;
  url: string;
  sizeKb: number;
  isVip: boolean;
}

export interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  category: string;
  visibility: 'PUBLIC' | 'VIP';
  accessTier: 'FREE' | 'PAID' | 'VIP_DERIV' | 'VIP_WELTRADE';
  roomType: 'GENERAL' | 'DERIV' | 'WELTRADE';
  isChatOpen: boolean;
  ownerId: string;
}

export interface PostRow {
  id: string;
  groupId: string | null;
  authorId: string;
  kind: 'POST' | 'ANALYSIS' | 'WIN' | 'QUESTION';
  body: string;
  imageUrl: string | null;
  createdAt: string;
  likes: string[];
}

export interface CommentRow {
  id: string;
  postId: string;
  userId: string;
  body: string;
  createdAt: string;
}

export interface MessageRow {
  id: string;
  groupId: string;
  userId: string;
  body: string;
  createdAt: string;
}

export interface TxRow {
  id: string;
  userId: string;
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'PURCHASE' | 'REFUND' | 'SUBSCRIPTION';
  method: string | null;
  amount: number;
  fee: number;
  netAmount?: number | null;
  currency: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  reference: string;
  idempotencyKey?: string | null;
  note: string | null;
  destination: string | null;
  providerRef?: string | null;
  adminNote: string | null;
  processedAt: string | null;
  createdAt: string;
  statusHistory?: { id: string; fromStatus: string | null; toStatus: string; actorRole: string; note: string | null; createdAt: string }[];
}

export interface NotificationRow {
  id: string;
  userId: string;
  title: string;
  body: string;
  type: string;
  read: boolean;
  link: string | null;
  createdAt: string;
}

export interface EnrollmentRow {
  userId: string;
  courseId: string;
  progress: number;
  completedLessons: string[];
}

export interface PurchaseRow {
  id: string;
  userId: string;
  itemType: string;
  itemId: string;
  itemTitle: string;
  amount: number;
  currency: string;
  status: 'PENDING' | 'PROCESSING' | 'PAID' | 'FAILED' | 'REFUNDED';
  provider: string;
  method: string | null;
  proofNote: string | null;
  adminNote: string | null;
  createdAt: string;
}

export interface BrokerTxRow {
  id: string;
  userId: string;
  direction: 'DEPOSIT' | 'WITHDRAWAL';
  broker: BrokerId;
  amount: number;
  currency: string;
  method: string;
  paymentReference: string | null;
  feePct: number;
  feeAmount: number;
  status: BrokerFundingStatus;
  reference: string;
  provider: string;
  processingMode: 'manual' | 'automated';
  providerRef: string | null;
  destination: string | null;
  destinationType: string | null;
  adminNote: string | null;
  internalNote: string | null;
  failureReason: string | null;
  evidence: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  processedAt: string | null;
  timeline: {
    id: string;
    action: string;
    fromStatus: string | null;
    toStatus: string | null;
    source: string;
    note: string | null;
    at: string;
  }[];
}

export interface BrokerBalanceRow {
  id: string;
  userId: string;
  broker: BrokerId;
  currency: string;
  balance: number;
  source: string;
  reference: string | null;
  verifiedAt: string | null;
  updatedAt: string;
}

export interface WatchRow {
  id: string;
  userId: string;
  pair: string;
  createdAt: string;
}

// Broker ACCOUNT registration (Weltrade): the member's client id + admin review.
export interface BrokerAccountEventRow {
  id: string;
  accountId: string;
  action: string; // SUBMITTED | UPDATED | RESUBMITTED | VERIFIED | REJECTED
  fromStatus: string | null;
  toStatus: string | null;
  reason: string | null;
  actorName: string | null;
  actorRole: string | null;
  createdAt: string;
}

export interface BrokerAccountRow {
  id: string;
  userId: string;
  broker: BrokerId;
  clientId: string;
  status: 'PENDING' | 'VERIFIED' | 'REJECTED';
  rejectReason: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionRow {
  userId: string;
  plan: string;
  status: string;
  startedAt: string;
  expiresAt: string;
  autoRenew: boolean;
}

export interface OfflineDb {
  v: number;
  users: UserRow[];
  signals: SignalRow[];
  courses: CourseRow[];
  groups: GroupRow[];
  posts: PostRow[];
  comments: CommentRow[];
  messages: MessageRow[];
  members: { groupId: string; userId: string }[];
  txs: TxRow[];
  notifications: NotificationRow[];
  enrollments: EnrollmentRow[];
  purchases: PurchaseRow[];
  brokerTx: BrokerTxRow[];
  brokerBalances: BrokerBalanceRow[];
  brokerSettings: BrokerSettings | null;
  brokerAudit: BrokerAuditEntry[];
  brokerAccounts: BrokerAccountRow[];
  brokerAccountEvents: BrokerAccountEventRow[];
  /** Admin-configurable Weltrade sign-up link; null means "not configured". */
  weltradeRegisterUrl: string | null;
  watchlist: WatchRow[];
  subscriptions: SubscriptionRow[];
  /** On-device security audit log (registration, logins, recovery). */
  securityEvents: SecurityEventRow[];
}

const KEY = 'atg.offline.db';

/**
 * Official Weltrade portal baked into the standalone build so the card's button
 * works on a phone with no server to read configuration from. Admins can still
 * replace it at runtime (Admin → Weltrade Accounts).
 */
export const DEFAULT_WELTRADE_REGISTER_URL = 'https://secure.weltrade.com';

export const DEFAULT_BROKER_SETTINGS: BrokerSettings = {
  deposit: { min: 10, max: 50000 },
  withdrawal: { min: 10, max: 50000, dailyMax: 20000 },
  pendingLimit: 5,
  feePct: 0,
};

export function id(prefix = 'x'): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

// --- password hashing (WebCrypto, with a sync fallback for odd contexts) ---

export async function hashPassword(password: string): Promise<string> {
  const salt = Math.random().toString(36).slice(2, 12);
  return `s1:${salt}:${await sha256Hex(salt + password)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split(':');
  if (scheme !== 's1' || !salt || !hash) return false;
  return (await sha256Hex(salt + password)) === hash;
}

// --- security answers (PBKDF2, same threat model as the server's scrypt) ---

/** Canonical form — must match the server's normalizeAnswer(). */
export function normalizeAnswer(raw: string): string {
  return (raw ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

const PBKDF2_ITERATIONS = 310_000;

/**
 * Hashes a security answer with PBKDF2-SHA256 and a per-answer random salt.
 * Format: `pbkdf2:<iterations>:<saltB64>:<hashB64>`. Answers are low-entropy
 * secrets, so a fast unsalted hash would be brute-forceable from a stolen
 * device backup — the KDF is deliberate.
 */
export async function hashSecurityAnswer(raw: string): Promise<string> {
  const answer = normalizeAnswer(raw);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await pbkdf2(answer, salt, PBKDF2_ITERATIONS);
  return `pbkdf2:${PBKDF2_ITERATIONS}:${b64(salt)}:${b64(derived)}`;
}

export async function verifySecurityAnswer(raw: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [scheme, iterStr, saltB64, hashB64] = stored.split(':');
  if (scheme !== 'pbkdf2' || !saltB64 || !hashB64) return false;
  const iterations = Number(iterStr);
  if (!Number.isInteger(iterations) || iterations < 1) return false;
  const salt = fromB64(saltB64);
  const expected = fromB64(hashB64);
  const derived = await pbkdf2(normalizeAnswer(raw), salt, iterations);
  if (derived.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < derived.length; i++) diff |= derived[i] ^ expected[i];
  return diff === 0;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  const encLocal = new TextEncoder();
  if (!subtle) {
    // Extremely old WebView without WebCrypto: iterated SHA-256 as a
    // degraded-but-still-salted fallback (verify follows the stored scheme).
    let out = new Uint8Array(await sha256Buf([salt, encLocal.encode(password)]));
    for (let i = 1; i < Math.min(iterations, 20_000); i++) {
      out = new Uint8Array(await sha256Buf([out, encLocal.encode(password)]));
    }
    return out;
  }
  const key = await subtle.importKey('raw', encLocal.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

async function sha256Buf(parts: Uint8Array[]): Promise<ArrayBuffer> {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const joined = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    joined.set(p, off);
    off += p.length;
  }
  return crypto.subtle.digest('SHA-256', joined);
}

function b64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(value: string): Uint8Array {
  const s = atob(value);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function sha256Hex(input: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // crypto.subtle only exists in secure contexts — e.g. a PWA opened over
  // http:// on a LAN address has none. Fall back to the same SHA-256,
  // synchronously, so hashes stay strong and identical either way.
  return sha256Sync(input);
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** Pure-JS SHA-256 (lowercase hex) — used when WebCrypto is unavailable. */
export function sha256Sync(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bytes.length >>> 29);
  view.setUint32(padded.length - 4, (bytes.length << 3) >>> 0);

  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let off = 0; off < padded.length; off += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(off + t * 4);
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let t = 0; t < 64; t++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + s1 + ch + SHA256_K[t] + w[t]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      h = g; g = f; f = e;
      e = (d + t1) >>> 0;
      d = c; c = b; b = a;
      a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }

  let out = '';
  for (let i = 0; i < 8; i++) out += H[i].toString(16).padStart(8, '0');
  return out;
}

// --- load / save -----------------------------------------------------------

let cache: OfflineDb | null = null;
let initPromise: Promise<OfflineDb> | null = null;

export function getDb(): OfflineDb {
  if (!cache) throw new Error('offline database not initialised');
  return cache;
}

export function saveDb(): void {
  if (cache) localStorage.setItem(KEY, JSON.stringify(cache));
}

export function ensureDb(): Promise<OfflineDb> {
  initPromise ??= init();
  return initPromise;
}

async function init(): Promise<OfflineDb> {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as OfflineDb;
      if (parsed && parsed.v === 1 && Array.isArray(parsed.users) && parsed.users.length > 0) {
        // Backfill columns added by later app versions. An explicit `null`
        // link means an admin cleared it — only fill in when the column is
        // missing entirely (an install from before this feature existed).
        parsed.brokerAccounts ??= [];
        parsed.brokerAccountEvents ??= [];
        parsed.securityEvents ??= [];
        if (parsed.weltradeRegisterUrl === undefined) {
          parsed.weltradeRegisterUrl = DEFAULT_WELTRADE_REGISTER_URL;
        }
        // New registration/recovery columns on existing users.
        for (const u of parsed.users) {
          u.phoneE164 ??= null;
          u.nationality ??= null;
          u.dateOfBirth ??= null;
          u.address ??= null;
          u.securityQuestion ??= null;
          u.securityAnswerHash ??= null;
          u.termsAcceptedAt ??= null;
          u.privacyAcceptedAt ??= null;
          u.recoveryAttempts ??= 0;
          u.recoveryLockedUntil ??= null;
        }
        cache = parsed;
        return cache;
      }
    } catch {
      /* corrupted — reseed below */
    }
  }
  cache = await seed();
  saveDb();
  return cache;
}

/** Test hook: forget the in-memory copy (does not touch storage). */
export function _resetCache(): void {
  cache = null;
  initPromise = null;
}

// --- seed ------------------------------------------------------------------

const GOLD = 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=800&q=80';

async function seed(): Promise<OfflineDb> {
  const adminId = 'u-admin-blessed';
  const admin: UserRow = {
    id: adminId,
    name: 'Blessed',
    email: 'blessed@atg.com',
    phone: null,
    phoneE164: null,
    passwordHash: await hashPassword('1953'),
    country: null,
    nationality: null,
    dateOfBirth: null,
    address: null,
    securityQuestion: null,
    securityAnswerHash: null,
    termsAcceptedAt: null,
    privacyAcceptedAt: null,
    recoveryAttempts: 0,
    recoveryLockedUntil: null,
    bio: 'Official ATG Traders administrator.',
    avatarUrl: null,
    role: 'ADMIN',
    membership: 'VIP_DERIV',
    isVip: true,
    vipExpiresAt: null,
    wallet: { id: 'w-admin', balance: 100000, currency: 'USD' },
    createdAt: nowIso(),
  };

  const signals: SignalRow[] = (
    [
      ['Volatility 75 (V75)', 'Synthetic', 'BUY', 385620, 386200, 384900, '15m', 'VIP_DERIV', 'VIP', 'OPEN', null, null, 'Holding above the 385,600 support with bullish momentum on the 15m. Watching for a breakout continuation.'],
      ['Volatility 100 (V100)', 'Synthetic', 'BUY', 1532.4, 1544.1, 1524.9, '1H', 'VIP_DERIV', 'VIP', 'OPEN', null, null, 'Trend continuation on the 1H.'],
      ['EUR/USD', 'Forex', 'SELL', 1.0872, 1.0822, 1.0905, '1H', 'VIP_WELTRADE', 'VIP', 'OPEN', null, null, 'Rejection from the 1.0900 supply zone. Targeting the 1.0820 demand.'],
      ['XAU/USD (Gold)', 'Metals', 'BUY', 2384.5, 2402.0, 2372.0, '4H', 'VIP_WELTRADE', 'VIP', 'HIT_TP', 175, 0.73, 'Gold reclaimed the 4H trend line; momentum favoured the bulls.'],
      ['Boom 500', 'Synthetic', 'SELL', 12458.2, 12438.2, 12478.5, '5m', 'FREE', 'FREE', 'OPEN', null, null, 'Overbought on the 5m after a sharp spike. Bearish reversal setup.'],
      ['Crash 500', 'Synthetic', 'BUY', 9452.3, 9502.3, 9420.1, '15m', 'FREE', 'FREE', 'HIT_TP', 50, 0.53, 'Support bounce with rising volume.'],
      ['PainX 400', 'Synthetic', 'BUY', 4512.8, 4560.0, 4480.0, '15m', 'FREE', 'FREE', 'OPEN', null, null, 'Free setup for the community.'],
      ['Step Index', 'Synthetic', 'SELL', 8921.5, 8870.0, 8960.0, '30m', 'VIP_DERIV', 'VIP', 'HIT_SL', -38, -0.43, 'Failed breakdown, stopped out.'],
    ] as const
  ).map((row, i) => ({
    id: `sig-${i + 1}`,
    pair: row[0],
    market: row[1],
    direction: row[2] as 'BUY' | 'SELL',
    entry: row[3] as number,
    takeProfit: row[4] as number,
    stopLoss: row[5] as number,
    timeframe: row[6] as string,
    audience: row[7] as SignalRow['audience'],
    tier: row[8] as 'FREE' | 'VIP',
    status: row[9] as SignalRow['status'],
    resultPips: row[10] as number | null,
    resultPct: row[11] as number | null,
    analysis: row[12] as string,
    chartUrl: null,
    publishedAt: new Date(Date.now() - i * 3600_000).toISOString(),
    closedAt: null,
    authorId: adminId,
  }));

  const courseDefs = [
    ['introduction-to-trading', 'Introduction to Trading', 'Beginner', 0, 12, ['What is trading?', 'Market participants', 'Reading a chart']],
    ['understanding-synthetic-indices', 'Understanding Synthetic Indices', 'Beginner', 0, 15, ['What are synthetic indices?', 'Volatility & Crash/Boom', 'Risk on synthetics']],
    ['risk-management', 'Risk Management Basics', 'Beginner', 0, 14, ['Position sizing', 'Stop-loss discipline', 'Drawdown control']],
    ['trading-strategies', 'Trading Strategies', 'Intermediate', 19.99, 18, ['Trend following', 'Breakout strategies', 'Entry & exit timing']],
    ['live-trading-examples', 'Live Trading Examples', 'Advanced', 29.99, 20, ['Live V75 trade', 'Live Boom 500 trade']],
    ['advanced-price-action', 'Advanced Price Action', 'Advanced', 39.99, 24, ['Market structure', 'Liquidity & sweeps', 'Multi-timeframe entries']],
  ] as const;

  const courses: CourseRow[] = courseDefs.map(([slug, title, level, price, duration, lessons], i) => ({
    id: `crs-${i + 1}`,
    slug,
    title,
    description: `${title} — practical, repeatable skills.${price > 0 ? ' Paid course — unlock after verified payment.' : ' Free short course.'}`,
    level,
    order: i,
    price,
    isVip: false,
    published: true,
    coverUrl: `${GOLD}&sig=${i}`,
    lessons: lessons.map((t, idx) => ({
      id: `crs-${i + 1}-l${idx + 1}`,
      title: t,
      description: null,
      videoUrl: null,
      durationMin: Math.round(duration / lessons.length),
      order: idx,
      isFree: idx === 0,
    })),
    resources: [],
  }));

  const groupRows: [string, string, string, GroupRow['roomType'], GroupRow['accessTier']][] = [
    ['General', 'Connect. Learn. Share.', 'General', 'GENERAL', 'FREE'],
    ['Market Analysis', 'Share your charts and setups.', 'Analysis', 'GENERAL', 'FREE'],
    ['Deriv VIP', 'Deriv synthetic indices signals & chat.', 'General', 'DERIV', 'VIP_DERIV'],
    ['Weltrade VIP', 'Weltrade FX & metals signals room.', 'General', 'WELTRADE', 'VIP_WELTRADE'],
  ];
  const groups: GroupRow[] = groupRows.map(([name, description, category, roomType, accessTier], i) => ({
    id: `grp-${i + 1}`,
    name,
    description,
    category,
    visibility: accessTier === 'FREE' ? 'PUBLIC' : 'VIP',
    accessTier,
    roomType,
    isChatOpen: true,
    ownerId: adminId,
  }));

  const posts: PostRow[] = [
    {
      id: 'post-1',
      groupId: 'grp-1',
      authorId: adminId,
      kind: 'POST',
      body: "Let's stay focused this week. Discipline always wins 💪",
      imageUrl: null,
      createdAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      likes: [],
    },
    {
      id: 'post-2',
      groupId: 'grp-2',
      authorId: adminId,
      kind: 'WIN',
      body: 'Nice reaction on V75 after the signal 🔥\nWhat a session!',
      imageUrl: `${GOLD}&sig=post1`,
      createdAt: new Date(Date.now() - 25 * 60_000).toISOString(),
      likes: [],
    },
    {
      id: 'post-3',
      groupId: 'grp-3',
      authorId: adminId,
      kind: 'ANALYSIS',
      body: 'V75 broke the 385,600 resistance. Watching for a retest to add. 🎯',
      imageUrl: null,
      createdAt: new Date(Date.now() - 15 * 60_000).toISOString(),
      likes: [],
    },
    {
      id: 'post-4',
      groupId: 'grp-4',
      authorId: adminId,
      kind: 'ANALYSIS',
      body: 'Gold TP hit at 2402.0 ✅ Beautiful 4H setup.',
      imageUrl: null,
      createdAt: new Date(Date.now() - 35 * 60_000).toISOString(),
      likes: [],
    },
  ];

  return {
    v: 1,
    users: [admin],
    signals,
    courses,
    groups,
    posts,
    comments: [],
    messages: [],
    members: [{ groupId: 'grp-1', userId: adminId }],
    txs: [],
    notifications: [],
    enrollments: [],
    purchases: [],
    brokerTx: [],
    brokerBalances: [],
    brokerSettings: null,
    brokerAudit: [],
    brokerAccounts: [],
    brokerAccountEvents: [],
    weltradeRegisterUrl: DEFAULT_WELTRADE_REGISTER_URL,
    watchlist: [],
    subscriptions: [],
    securityEvents: [],
  };
}
