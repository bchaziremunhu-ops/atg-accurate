
import type {
  BrokerFundingConfig,
  BrokerId,
  BrokerSettings,
  BrokerSettingsView,
  Membership,
} from '../types';
import {
  DEFAULT_BROKER_SETTINGS,
  ensureDb,
  getDb,
  hashPassword,
  hashSecurityAnswer,
  id,
  nowIso,
  saveDb,
  verifyPassword,
  verifySecurityAnswer,
  type BrokerAccountRow,
  type BrokerTxRow,
  type CourseRow,
  type GroupRow,
  type LessonRow,
  type PostRow,
  type SignalRow,
  type TxRow,
  type UserRow,
} from './store';
import { normalizePhone } from '../phone';
import { SECURITY_QUESTIONS } from '../securityQuestions';

const SECURITY_QUESTION_IDS = new Set(SECURITY_QUESTIONS.map((q) => q.id));

export interface RouterResult {
  status: number;
  data: unknown;
}

class HttpError extends Error {
  constructor(
    public status: number,
    public payload: unknown,
  ) {
    super(typeof payload === 'object' && payload && 'error' in payload ? String((payload as { error: string }).error) : 'error');
  }
}

const err = (status: number, error: string) => new HttpError(status, { error });
const issues = (...messages: string[]): never => {
  throw new HttpError(422, { issues: messages.map((message) => ({ message })) });
};

interface Ctx {
  params: Record<string, string>;
  query: Record<string, unknown>;
  body: Record<string, unknown>;
  user: UserRow | null;
}

type Handler = (ctx: Ctx) => Promise<unknown> | unknown;

interface Route {
  method: string;
  pattern: string;
  handler: Handler;
  auth: boolean;
  admin: boolean;
}

const routes: Route[] = [];

function route(method: string, pattern: string, handler: Handler, opts: { auth?: boolean; admin?: boolean } = {}) {
  routes.push({ method, pattern, handler, auth: opts.auth ?? false, admin: opts.admin ?? false });
}


function signToken(user: UserRow): string {
  const payload = btoa(JSON.stringify({ sub: user.id, role: user.role }));
  return `atg.local.${payload}`;
}

function decodeToken(token: string): { sub: string } | null {
  try {
    if (!token.startsWith('atg.local.')) return null;
    const payload = JSON.parse(atob(token.slice('atg.local.'.length))) as { sub: string };
    return payload && typeof payload.sub === 'string' ? payload : null;
  } catch {
    return null;
  }
}

function publicUser(u: UserRow) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    phoneE164: u.phoneE164 ?? null,
    country: u.country,
    nationality: u.nationality ?? null,
    bio: u.bio,
    avatarUrl: u.avatarUrl,
    role: u.role,
    membership: u.membership,
    isVip: u.membership === 'VIP_DERIV' || u.membership === 'VIP_WELTRADE',
    vipExpiresAt: u.vipExpiresAt,
  };
}

function entitled(u: UserRow, tier: string): boolean {
  if (u.role === 'ADMIN') return true;
  if (tier === 'FREE') return true;
  if (tier === 'PAID') return u.membership === 'PAID' || u.membership.startsWith('VIP');
  return u.membership === tier;
}

function subscriptionView(db: ReturnType<typeof getDb>, u: UserRow) {
  const sub = db.subscriptions.find((s) => s.userId === u.id);
  if (!sub) return { plan: null, status: 'NONE', expiresAt: null, daysLeft: null, expired: false };
  const expired = new Date(sub.expiresAt).getTime() < Date.now();
  const daysLeft = Math.max(0, Math.ceil((new Date(sub.expiresAt).getTime() - Date.now()) / 86_400_000));
  return { ...sub, status: expired ? 'EXPIRED' : sub.status, daysLeft, expired };
}

function requireUser(ctx: Ctx): UserRow {
  if (!ctx.user) throw err(401, 'Authentication required');
  return ctx.user;
}

function requireAdmin(ctx: Ctx): UserRow {
  const u = requireUser(ctx);
  if (u.role !== 'ADMIN') throw err(403, 'Administrator access required');
  return u;
}


const BROKER_LABELS: Record<string, string> = { DERIV: 'Deriv', WELTRADE: 'Weltrade' };
const METHOD_LABELS: Record<string, string> = {
  ECOCASH: 'EcoCash',
  ONEMONEY: 'OneMoney',
  INNBUCKS: 'InnBucks',
  CASHSMILE: 'CashSmile',
  BANK_TRANSFER: 'Bank Transfer',
  USDT_TRC20: 'USDT (TRC20)',
};

function signalView(db: ReturnType<typeof getDb>, row: SignalRow, viewer: UserRow) {
  const author = db.users.find((u) => u.id === row.authorId);
  const { authorId: _ignored, ...rest } = row;
  void _ignored;
  return {
    ...rest,
    author: author ? { id: author.id, name: author.name, avatarUrl: author.avatarUrl } : undefined,
    locked: !entitled(viewer, row.audience),
  };
}

function lessonView(l: LessonRow, unlocked: boolean) {
  return { ...l, locked: !unlocked && !l.isFree };
}

function courseView(db: ReturnType<typeof getDb>, c: CourseRow, viewer: UserRow) {
  const unlocked = entitled(viewer, 'PAID') || c.price <= 0;
  const enrollment = db.enrollments.find((e) => e.userId === viewer.id && e.courseId === c.id);
  return {
    id: c.id,
    slug: c.slug,
    title: c.title,
    description: c.description,
    level: c.level,
    price: c.price,
    isFree: c.price <= 0,
    entitled: unlocked,
    isVip: c.isVip,
    published: c.published,
    coverUrl: c.coverUrl,
    lessonCount: c.lessons.length,
    durationMin: c.lessons.reduce((s, l) => s + l.durationMin, 0),
    lessons: c.lessons.map((l) => lessonView(l, unlocked)),
    resources: c.resources.map((r) => ({ ...r, locked: !unlocked })),
    progress: enrollment?.progress ?? 0,
    enrollmentId: enrollment ? `${enrollment.userId}:${enrollment.courseId}` : null,
  };
}

function groupView(db: ReturnType<typeof getDb>, g: GroupRow, viewer: UserRow) {
  const posts = db.posts.filter((p) => p.groupId === g.id);
  const messages = db.messages.filter((m) => m.groupId === g.id);
  const members = db.members.filter((m) => m.groupId === g.id);
  return {
    id: g.id,
    name: g.name,
    description: g.description,
    category: g.category,
    visibility: g.visibility,
    accessTier: g.accessTier,
    roomType: g.roomType,
    isChatOpen: g.isChatOpen,
    chatOpen: g.isChatOpen,
    canAccess: entitled(viewer, g.accessTier),
    joined: members.some((m) => m.userId === viewer.id) || g.ownerId === viewer.id,
    _count: { members: members.length, posts: posts.length, messages: messages.length },
  };
}

function postView(db: ReturnType<typeof getDb>, p: PostRow, viewer: UserRow) {
  const author = db.users.find((u) => u.id === p.authorId);
  const group = p.groupId ? db.groups.find((g) => g.id === p.groupId) : null;
  return {
    id: p.id,
    kind: p.kind,
    body: p.body,
    imageUrl: p.imageUrl,
    createdAt: p.createdAt,
    likeCount: p.likes.length,
    commentCount: db.comments.filter((c) => c.postId === p.id).length,
    likedByMe: p.likes.includes(viewer.id),
    author: author
      ? { id: author.id, name: author.name, avatarUrl: author.avatarUrl, role: author.role, isVip: author.isVip }
      : { id: 'unknown', name: 'Unknown', avatarUrl: null, role: 'USER', isVip: false },
    group: group ? { id: group.id, name: group.name, category: group.category } : undefined,
  };
}

function txView(t: TxRow) {
  return { ...t };
}

function brokerView(db: ReturnType<typeof getDb>, row: BrokerTxRow, viewer: UserRow) {
  void db;
  return {
    id: row.id,
    direction: row.direction,
    broker: row.broker,
    brokerLabel: BROKER_LABELS[row.broker] ?? row.broker,
    amount: row.amount,
    currency: row.currency,
    method: row.method,
    methodLabel: METHOD_LABELS[row.method] ?? row.method,
    feePct: row.feePct,
    feeAmount: row.feeAmount,
    status: row.status,
    reference: row.reference,
    provider: row.provider,
    processingMode: row.processingMode,
    providerRef: row.providerRef,
    paymentReference: row.paymentReference,
    destination: row.destination,
    destinationType: row.destinationType,
    adminNote: row.adminNote,
    failureReason: row.failureReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
    ownedBy: viewer.id,
  };
}

function maskDestination(dest: string | null): string | null {
  if (!dest) return null;
  if (dest.length <= 6) return 'â€¢â€¢â€¢â€¢â€¢â€¢';
  return `${dest.slice(0, 3)}â€¢â€¢â€¢â€¢${dest.slice(-2)}`;
}

function adminBrokerView(db: ReturnType<typeof getDb>, row: BrokerTxRow) {
  const user = db.users.find((u) => u.id === row.userId);
  return {
    id: row.id,
    direction: row.direction,
    broker: row.broker,
    amount: row.amount,
    currency: row.currency,
    method: row.method,
    feePct: row.feePct,
    feeAmount: row.feeAmount,
    status: row.status,
    reference: row.reference,
    provider: row.provider,
    processingMode: row.processingMode,
    providerRef: row.providerRef,
    paymentReference: row.paymentReference,
    destinationMasked: maskDestination(row.destination),
    hasDestination: row.destination !== null,
    internalNote: row.internalNote,
    adminNote: row.adminNote,
    failureReason: row.failureReason,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    user: user
      ? { id: user.id, name: user.name, email: user.email, membership: user.membership }
      : { id: 'unknown', name: 'Unknown', email: '', membership: 'FREE' },
  };
}


function settingsView(db: ReturnType<typeof getDb>): BrokerSettingsView {
  const settings: BrokerSettings = db.brokerSettings ?? DEFAULT_BROKER_SETTINGS;
  return {
    settings,
    limits: { ...settings, currency: 'USD' },
    currency: 'USD',
  };
}

function effectiveSettings(db: ReturnType<typeof getDb>): BrokerSettings {
  return db.brokerSettings ?? DEFAULT_BROKER_SETTINGS;
}

function brokerConfig(db: ReturnType<typeof getDb>): BrokerFundingConfig {
  const s = effectiveSettings(db);
  const methods = Object.entries(METHOD_LABELS).map(([key, label]) => ({ id: key, label, logo: null }));
  return {
    brokers: [
      { id: 'DERIV', label: 'Deriv' },
      { id: 'WELTRADE', label: 'Weltrade' },
    ],
    methods,
    limits: {
      currency: 'USD',
      deposit: s.deposit,
      withdrawal: s.withdrawal,
      pendingLimit: s.pendingLimit,
      feePct: s.feePct,
    },
    gateways: (['DERIV', 'WELTRADE'] as const).map((broker) => ({
      broker,
      name: 'Manual review',
      kind: 'manual' as const,
      configured: true,
      ready: true,
      reason: null,
    })),
    manualProcessing: true,
    notice: 'Deposits and withdrawals are reviewed manually by the administrator.',
  };
}

function audit(
  db: ReturnType<typeof getDb>,
  entry: {
    action: string;
    transactionId: string;
    broker: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    source: string;
    note?: string | null;
    actor?: UserRow | null;
    snapshot?: unknown;
  },
) {
  const snap = entry.snapshot as Record<string, unknown> | null | undefined;
  db.brokerAudit.unshift({
    id: id('aud'),
    action: entry.action,
    fromStatus: entry.fromStatus ?? null,
    toStatus: entry.toStatus ?? null,
    source: entry.source,
    provider: null,
    eventId: null,
    actorName: entry.actor?.name ?? null,
    actorRole: entry.actor?.role ?? null,
    note: entry.note ?? null,
    metadata: null,
    at: nowIso(),
    transaction: snap
      ? ({
          reference: String(snap.reference ?? ''),
          broker: entry.broker,
          direction: String(snap.direction ?? ''),
          amount: Number(snap.amount ?? 0),
          currency: 'USD',
          status: String(snap.status ?? ''),
        } as BrokerAuditEntryTx)
      : null,
  });
}

type BrokerAuditEntryTx = NonNullable<import('../types').BrokerAuditEntry['transaction']>;


route('POST', '/auth/register', async (ctx) => {
  const db = getDb();
  const name = String(ctx.body.name ?? '').trim();
  const phoneRaw = String(ctx.body.phone ?? '').trim();
  const password = String(ctx.body.password ?? '');
  const confirmPassword = String(ctx.body.confirmPassword ?? password);
  const country = String(ctx.body.country ?? '').trim();
  const nationality = String(ctx.body.nationality ?? '').trim();
  const dateOfBirth = String(ctx.body.dateOfBirth ?? '').trim();
  const address = String(ctx.body.address ?? '').trim();
  const securityQuestion = String(ctx.body.securityQuestion ?? '').trim();
  const securityAnswer = String(ctx.body.securityAnswer ?? '').trim();
  const acceptTerms = ctx.body.acceptTerms === true;
  const acceptPrivacy = ctx.body.acceptPrivacy === true;

  if (name.length < 2) issues('Enter your full legal name');
  if (!country) issues('Select your country of residence');
  if (!nationality) issues('Select your nationality');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) issues('Enter your date of birth (YYYY-MM-DD)');
  if (!SECURITY_QUESTION_IDS.has(securityQuestion)) issues('Choose a security question');
  if (securityAnswer.trim().length < 2) issues('Security answer must be at least 2 characters');
  if (password.length < 8) issues('Password must be at least 8 characters');
  if (password !== confirmPassword) issues('Passwords do not match');
  if (!acceptTerms) throw err(400, 'You must accept the Terms & Conditions');
  if (!acceptPrivacy) throw err(400, 'You must accept the Privacy Policy');

  const normalized = normalizePhone(phoneRaw, country);
  if (!normalized) throw err(400, 'Enter a valid phone number including the international country code');
  const { e164, digits: phone } = normalized;

  if (db.users.some((u) => u.phone === phone || u.phoneE164 === e164)) {
    throw err(409, 'An account with that phone number already exists');
  }
  const email = `${phone}@atg.app`;
  if (db.users.some((u) => u.email === email)) throw err(409, 'An account with that email already exists');

  const dob = parseDobLocal(dateOfBirth);
  if (!dob) throw err(400, 'Enter a valid date of birth');

  const user: UserRow = {
    id: id('u'),
    name,
    email,
    phone,
    phoneE164: e164,
    passwordHash: await hashPassword(password),
    country,
    nationality,
    dateOfBirth,
    address: address || null,
    securityQuestion,
    securityAnswerHash: await hashSecurityAnswer(securityAnswer),
    termsAcceptedAt: nowIso(),
    privacyAcceptedAt: nowIso(),
    recoveryAttempts: 0,
    recoveryLockedUntil: null,
    bio: null,
    avatarUrl: null,
    role: 'USER',
    membership: 'FREE',
    isVip: false,
    vipExpiresAt: null,
    wallet: { id: id('w'), balance: 0, currency: 'USD' },
    createdAt: nowIso(),
  };
  db.users.push(user);
  recordSecurityEvent(db, 'REGISTER', user.id, e164);
  db.notifications.unshift({
    id: id('n'),
    userId: user.id,
    title: 'Welcome to ATG Traders 🎉',
    body: 'Your account is ready. Explore free signals and courses to get started.',
    type: 'SYSTEM',
    read: false,
    link: '/home',
    createdAt: nowIso(),
  });
  saveDb();
  return { status: 201, data: { user: publicUser(user), accessToken: signToken(user), refreshToken: signToken(user) } };
});

route('POST', '/auth/login', async (ctx) => {
  const db = getDb();
  const identifier = String(ctx.body.identifier ?? ctx.body.email ?? ctx.body.phone ?? '').trim();
  const password = String(ctx.body.password ?? '');
  const isEmail = identifier.includes('@');
  let user: UserRow | undefined;
  if (isEmail) {
    user = db.users.find((u) => u.email === identifier.toLowerCase());
  } else {
    const normalized = normalizePhone(identifier);
    if (normalized) {
      user = db.users.find((u) => u.phoneE164 === normalized.e164 || u.phone === normalized.digits);
    }
    if (!user) {
      const d = identifier.replace(/\D/g, '');
      if (d) user = db.users.find((u) => u.phone === d || u.phoneE164 === `+${d}`);
    }
  }
  const failMsg = isEmail ? 'Invalid email or password' : 'Invalid phone number or password';
  if (!user) {
    recordSecurityEvent(db, 'LOGIN_FAILED', null, null);
    throw err(401, failMsg);
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    recordSecurityEvent(db, 'LOGIN_FAILED', user.id, user.phoneE164 ?? null);
    throw err(401, failMsg);
  }
  recordSecurityEvent(db, 'LOGIN_SUCCESS', user.id, user.phoneE164 ?? null);
  saveDb();
  return { user: publicUser(user), accessToken: signToken(user), refreshToken: signToken(user) };
});


const RECOVERY_GENERIC =
  "We couldn't verify those details. Check the phone number, full legal name and date of birth, then try again.";

const RECOVERY_LOCK_MSG = 'Too many attempts. Account recovery is temporarily locked — try again in about 15 minutes.';

function normalizeNameLocal(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function parseDobLocal(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  const now = new Date();
  if (date.getTime() > Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) return null;
  if (y < 1900) return null;
  return date;
}

function dobMatchesLocal(stored: string | null, submitted: string): boolean {
  if (!stored) return false;
  const parsed = parseDobLocal(submitted);
  if (!parsed) return false;
  const [sy, sm, sd] = stored.split('-').map(Number);
  return sy === parsed.getUTCFullYear() && sm === parsed.getUTCMonth() + 1 && sd === parsed.getUTCDate();
}

function recordSecurityEvent(
  db: ReturnType<typeof getDb>,
  type: string,
  userId: string | null,
  phoneE164: string | null,
) {
  db.securityEvents.unshift({
    id: id('se'),
    userId,
    phoneE164,
    type,
    createdAt: nowIso(),
  });
  if (db.securityEvents.length > 500) db.securityEvents.length = 500;
}

function findUserByPhoneLocal(db: ReturnType<typeof getDb>, raw: string): UserRow | undefined {
  const normalized = normalizePhone(raw);
  if (normalized) {
    return db.users.find((u) => u.phoneE164 === normalized.e164 || u.phone === normalized.digits);
  }
  const d = raw.replace(/\D/g, '');
  if (d) return db.users.find((u) => u.phone === d || u.phoneE164 === `+${d}`);
  return undefined;
}

function isRecoveryLockedLocal(u: UserRow): boolean {
  return Boolean(u.recoveryLockedUntil && new Date(u.recoveryLockedUntil).getTime() > Date.now());
}

function recordRecoveryFailureLocal(u: UserRow): boolean {
  const attempts = (u.recoveryAttempts ?? 0) + 1;
  if (attempts >= 5) {
    u.recoveryAttempts = 0;
    u.recoveryLockedUntil = new Date(Date.now() + 15 * 60_000).toISOString();
    return true;
  }
  u.recoveryAttempts = attempts;
  return false;
}

function delayFailureLocal(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 400 + Math.floor(Math.random() * 250)));
}

route('GET', '/auth/security-questions', () => ({ questions: SECURITY_QUESTIONS }));

route('POST', '/auth/forgot/start', (ctx) => {
  const db = getDb();
  const phone = String(ctx.body.phone ?? '');
  const normalized = normalizePhone(phone);
  recordSecurityEvent(db, 'RECOVERY_STARTED', null, normalized?.e164 ?? null);
  saveDb();
  return { ok: true };
});

route('POST', '/auth/forgot/verify', async (ctx) => {
  const db = getDb();
  const phone = String(ctx.body.phone ?? '');
  const fullName = String(ctx.body.fullName ?? '');
  const dateOfBirth = String(ctx.body.dateOfBirth ?? '');
  const user = findUserByPhoneLocal(db, phone);
  if (!user) {
    await delayFailureLocal();
    throw err(400, RECOVERY_GENERIC);
  }
  if (isRecoveryLockedLocal(user)) {
    recordSecurityEvent(db, 'RECOVERY_LOCKED', user.id, user.phoneE164 ?? null);
    saveDb();
    throw err(429, RECOVERY_LOCK_MSG);
  }
  const nameOk = normalizeNameLocal(user.name) === normalizeNameLocal(fullName);
  const dobOk = dobMatchesLocal(user.dateOfBirth ?? null, dateOfBirth);
  if (!nameOk || !dobOk || !user.securityQuestion) {
    const locked = recordRecoveryFailureLocal(user);
    recordSecurityEvent(db, 'RECOVERY_IDENTITY_FAILED', user.id, user.phoneE164 ?? null);
    saveDb();
    await delayFailureLocal();
    if (locked) throw err(429, RECOVERY_LOCK_MSG);
    throw err(400, RECOVERY_GENERIC);
  }
  const question = SECURITY_QUESTIONS.find((q) => q.id === user.securityQuestion);
  recordSecurityEvent(db, 'RECOVERY_QUESTION_ISSUED', user.id, user.phoneE164 ?? null);
  saveDb();
  return { question: question ?? { id: user.securityQuestion, text: 'Security question' } };
});

route('POST', '/auth/forgot/reset', async (ctx) => {
  const db = getDb();
  const phone = String(ctx.body.phone ?? '');
  const fullName = String(ctx.body.fullName ?? '');
  const dateOfBirth = String(ctx.body.dateOfBirth ?? '');
  const answer = String(ctx.body.answer ?? '');
  const newPassword = String(ctx.body.newPassword ?? '');
  const confirmPassword = String(ctx.body.confirmPassword ?? '');
  if (newPassword !== confirmPassword) throw err(400, 'Passwords do not match');
  if (newPassword.length < 8) issues('Password must be at least 8 characters');

  const user = findUserByPhoneLocal(db, phone);
  if (!user) {
    await delayFailureLocal();
    throw err(400, RECOVERY_GENERIC);
  }
  if (isRecoveryLockedLocal(user)) {
    recordSecurityEvent(db, 'RECOVERY_LOCKED', user.id, user.phoneE164 ?? null);
    saveDb();
    throw err(429, RECOVERY_LOCK_MSG);
  }
  const nameOk = normalizeNameLocal(user.name) === normalizeNameLocal(fullName);
  const dobOk = dobMatchesLocal(user.dateOfBirth ?? null, dateOfBirth);
  if (!nameOk || !dobOk) {
    const locked = recordRecoveryFailureLocal(user);
    recordSecurityEvent(db, 'RECOVERY_IDENTITY_FAILED', user.id, user.phoneE164 ?? null);
    saveDb();
    await delayFailureLocal();
    if (locked) throw err(429, RECOVERY_LOCK_MSG);
    throw err(400, RECOVERY_GENERIC);
  }
  const answerOk = await verifySecurityAnswer(answer, user.securityAnswerHash ?? null);
  if (!answerOk) {
    const locked = recordRecoveryFailureLocal(user);
    recordSecurityEvent(db, 'RECOVERY_ANSWER_FAILED', user.id, user.phoneE164 ?? null);
    saveDb();
    await delayFailureLocal();
    if (locked) throw err(429, RECOVERY_LOCK_MSG);
    throw err(400, "That didn't match your account. Check your security answer and try again.");
  }
  user.passwordHash = await hashPassword(newPassword);
  user.recoveryAttempts = 0;
  user.recoveryLockedUntil = null;
  recordSecurityEvent(db, 'PASSWORD_RESET', user.id, user.phoneE164 ?? null);
  saveDb();
  return { ok: true, message: 'Your password has been updated. Sign in with your new password.' };
});

route('POST', '/auth/refresh', (ctx) => {
  const payload = decodeToken(String(ctx.body.refreshToken ?? ''));
  if (!payload) throw err(401, 'Invalid refresh token');
  const user = getDb().users.find((u) => u.id === payload.sub);
  if (!user) throw err(401, 'Invalid refresh token');
  return { accessToken: signToken(user), refreshToken: signToken(user) };
});

route(
  'GET',
  '/auth/me',
  (ctx) => {
    const db = getDb();
    const u = requireUser(ctx);
    return { ...publicUser(u), wallet: u.wallet, subscription: subscriptionView(db, u) };
  },
  { auth: true },
);

route(
  'POST',
  '/auth/logout',
  () => ({ ok: true }),
  { auth: true },
);


route(
  'GET',
  '/users/profile',
  (ctx) => {
    const u = requireUser(ctx);
    return { ...publicUser(u), wallet: u.wallet, subscription: subscriptionView(getDb(), u) };
  },
  { auth: true },
);

route(
  'PATCH',
  '/users/profile',
  (ctx) => {
    const db = getDb();
    const u = requireUser(ctx);
    if (typeof ctx.body.name === 'string' && ctx.body.name.trim().length >= 2) u.name = ctx.body.name.trim();
    if (typeof ctx.body.country === 'string') u.country = ctx.body.country;
    if (typeof ctx.body.bio === 'string') u.bio = ctx.body.bio;
    if (typeof ctx.body.avatarUrl === 'string') u.avatarUrl = ctx.body.avatarUrl || null;
    if (typeof ctx.body.phone === 'string' && ctx.body.phone.trim()) {
      const phone = ctx.body.phone.replace(/\D/g, '');
      if (phone.length < 6) issues('Enter a valid phone number');
      if (db.users.some((other) => other.id !== u.id && other.phone === phone)) {
        throw err(409, 'An account with that phone number already exists');
      }
      u.phone = phone;
    }
    saveDb();
    return publicUser(u);
  },
  { auth: true },
);

route(
  'POST',
  '/users/change-password',
  async (ctx) => {
    const u = requireUser(ctx);
    const current = String(ctx.body.currentPassword ?? '');
    const next = String(ctx.body.newPassword ?? '');
    if (next.length < 8) issues('Password must be at least 8 characters');
    if (!(await verifyPassword(current, u.passwordHash))) throw err(401, 'Current password is incorrect');
    u.passwordHash = await hashPassword(next);
    saveDb();
    return { ok: true };
  },
  { auth: true },
);

route(
  'GET',
  '/users/watchlist',
  (ctx) => {
    const u = requireUser(ctx);
    return getDb()
      .watchlist.filter((w) => w.userId === u.id)
      .map((w) => ({ id: w.id, pair: w.pair, createdAt: w.createdAt }));
  },
  { auth: true },
);

route(
  'POST',
  '/users/watchlist',
  (ctx) => {
    const db = getDb();
    const u = requireUser(ctx);
    const pair = String(ctx.body.pair ?? '');
    if (!pair) issues('Pair is required');
    let row = db.watchlist.find((w) => w.userId === u.id && w.pair === pair);
    if (!row) {
      row = { id: id('wl'), userId: u.id, pair, createdAt: nowIso() };
      db.watchlist.push(row);
      saveDb();
    }
    return { id: row.id, pair: row.pair, createdAt: row.createdAt };
  },
  { auth: true },
);

route(
  'DELETE',
  '/users/watchlist/:pair',
  (ctx) => {
    const db = getDb();
    const u = requireUser(ctx);
    const pair = decodeURIComponent(ctx.params.pair);
    db.watchlist = db.watchlist.filter((w) => !(w.userId === u.id && w.pair === pair));
    saveDb();
    return { ok: true };
  },
  { auth: true },
);

route(
  'GET',
  '/users/certificates',
  () => [],
  { auth: true },
);

route(
  'GET',
  '/users/certificates/:id',
  () => {
    throw err(404, 'Certificate not found');
  },
  { auth: true },
);


route(
  'GET',
  '/signals',
  (ctx) => {
    const db = getDb();
    const u = requireUser(ctx);
    let rows = db.signals.filter((s) => entitled(u, s.audience));
    if (typeof ctx.query.audience === 'string' && ctx.query.audience) rows = rows.filter((s) => s.audience === ctx.query.audience);
    if (typeof ctx.query.status === 'string' && ctx.query.status) rows = rows.filter((s) => s.status === ctx.query.status);
    if (typeof ctx.query.pair === 'string' && ctx.query.pair) rows = rows.filter((s) => s.pair === ctx.query.pair);
    if (typeof ctx.query.q === 'string' && ctx.query.q) {
      const q = ctx.query.q.toLowerCase();
      rows = rows.filter((s) => s.pair.toLowerCase().includes(q) || (s.analysis ?? '').toLowerCase().includes(q));
    }
    return rows
      .slice()
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .map((s) => signalView(db, s, u));
  },
  { auth: true },
);

route(
  'GET',
  '/signals/rooms/access',
  (ctx) => {
    const u = requireUser(ctx);
    return {
      FREE: true,
      PAID: entitled(u, 'PAID'),
      VIP_DERIV: entitled(u, 'VIP_DERIV'),
      VIP_WELTRADE: entitled(u, 'VIP_WELTRADE'),
      membership: u.membership,
      isAdmin: u.role === 'ADMIN',
    };
  },
  { auth: true },
);

route(
  'GET',
  '/signals/results',
  (ctx) => {
    const db = getDb();
    const u = requireUser(ctx);
    const rows = db.signals.filter((s) => entitled(u, s.audience));
    const wins = rows.filter((s) => s.status === 'HIT_TP').length;
    const losses = rows.filter((s) => s.status === 'HIT_SL').length;
    const open = rows.filter((s) => s.status === 'OPEN').length;
    return {
      total: rows.length,
      wins,
      losses,
      open,
      winRate: wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : 0,
    };
  },
  { auth: true },
);

route(
  'GET',
  '/signals/:id/chart',
  (ctx) => {
    const db = getDb();
    const u = requireUser(ctx);
    const row = db.signals.find((s) => s.id === ctx.params.id && entitled(u, s.audience));
    if (!row) throw err(404, 'Signal not found');
    return {
      configured: false,
      provider: 'none',
      pair: row.pair,
      timeframe: ctx.query.timeframe ?? row.timeframe,
      entry: row.entry ?? 0,
      takeProfit: row.takeProfit ?? 0,
      stopLoss: row.stopLoss ?? 0,
      candles: [],
    };
  },
  { auth: true },
);

route(
  'GET',
  '/signals/:id',
  (ctx) => {
    const db = getDb();
    const u = requireUser(ctx);
    const row = db.signals.find((s) => s.id === ctx.params.id && entitled(u, s.audience));
    if (!row) throw err(404, 'Signal not found');
    return signalView(db, row, u);
  },
  { auth: true },
);

route(
  'POST',
  '/signals',
  (ctx) => {
    const db = getDb();
    requireAdmin(ctx);
    const pair = String(ctx.body.pair ?? '').trim();
    const direction = ctx.body.direction === 'SELL' ? 'SELL' : 'BUY';
    if (!pair) issues('Pair is required');
    const audience = (ctx.body.audience as SignalRow['audience']) || 'FREE';
    const row: SignalRow = {
      id: id('sig'),
      pair,
      market: String(ctx.body.market ?? 'Synthetic'),
      direction,
      entry: numberOrNull(ctx.body.entry),
      takeProfit: numberOrNull(ctx.body.takeProfit),
      stopLoss: numberOrNull(ctx.body.stopLoss),
      timeframe: String(ctx.body.timeframe ?? '1H'),
      tier: audience === 'FREE' ? 'FREE' : 'VIP',
      audience,
      status: (ctx.body.status as SignalRow['status']) || 'OPEN',
      resultPips: numberOrNull(ctx.body.resultPips),
      resultPct: numberOrNull(ctx.body.resultPct),
      analysis: (ctx.body.analysis as string | undefined) || null,
      chartUrl: null,
      publishedAt: nowIso(),
      closedAt: null,
      authorId: requireUser(ctx).id,
    };
    db.signals.unshift(row);
    saveDb();
    return signalView(db, row, ctx.user!);
  },
  { auth: true, admin: true },
);

route(
  'PATCH',
  '/signals/:id',
  (ctx) => {
    const db = getDb();
    requireAdmin(ctx);
    const row = db.signals.find((s) => s.id === ctx.params.id);
    if (!row) throw err(404, 'Signal not found');
    const scalarKeys = ['pair', 'market', 'timeframe', 'tier', 'audience', 'status', 'analysis'] as const;
    for (const key of scalarKeys) {
      if (typeof ctx.body[key] === 'string') (row as unknown as Record<string, unknown>)[key] = ctx.body[key];
    }
    for (const key of ['entry', 'takeProfit', 'stopLoss', 'resultPips', 'resultPct'] as const) {
      if (key in ctx.body) row[key] = numberOrNull(ctx.body[key]);
    }
    if (row.status !== 'OPEN' && !row.closedAt) row.closedAt = nowIso();
    saveDb();
    return signalView(db, row, ctx.user!);
  },
  { auth: true, admin: true },
);

route(
  'DELETE',
  '/signals/:id',
  (ctx) => {
    const db = getDb();
    requireAdmin(ctx);
    db.signals = db.signals.filter((s) => s.id !== ctx.params.id);
    saveDb();
    return { ok: true };
  },
  { auth: true, admin: true },
);

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}


route(
  'GET',
  '/courses',
  (ctx) => {
    const db = getDb();
    const u = requireUser(ctx);
    let rows = db.courses.filter((c) => c.published || u.role === 'ADMIN');
    if (typeof ctx.query.level === 'string' && ctx.query.level) rows = rows.filter((c) => c.level === ctx.query.level);
    if (ctx.query.all !== 'true' && u.role !== 'ADMIN') {
      rows = rows.filter((c) => c.published);
    }
    return rows.slice().sort((a, b) => a.order - b.order).map((c) => courseView(db, c, u));
  },
  { auth: true },
);

route(
  'POST',
  '/courses/:slug/enroll',
  (ctx) => {
    const db = getDb();
    const u = requireUser(ctx);
    const course = db.courses.find((c) => c.slug === ctx.params.slug);
    if (!course) throw err(404, 'Course not found');
    if (course.price > 0 && !entitled(u, 'PAID')) throw err(403, 'Payment required for this course');
    if (!db.enrollments.some((e) => e.userId === u.id && e.courseId === course.id)) {
      db.enrollments.push({ userId: u.id, courseId: course.id, progress: 0, completedLessons: [] });
      saveDb();
    }
    return { ok: true };
  },
  { auth: true },
);

route(
  'POST',
  '/courses/:slug/progress',
  (ctx) => {
    const db = getDb();
    const u = requireUser(ctx);
    const course = db.courses.find((c) => c.slug === ctx.params.slug);
    if (!course) throw err(404, 'Course not found');
    const lessonId = String(ctx.body.lessonId ?? '');
    const completed = ctx.body.completed !== false;
    let enrollment = db.enrollments.find((e) => e.userId === u.id && e.courseId === course.id);
    if (!enrollment) {
      enrollment = { userId: u.id, courseId: course.id, progress: 0, completedLessons: [] };
      db.enrollments.push(enrollment);
    }
    if (completed && !enrollment.completedLessons.includes(lessonId)) enrollment.completedLessons.push(lessonId);
    if (!completed) enrollment.completedLessons = enrollment.completedLessons.filter((l) => l !== lessonId);
    enrollment.progress = course.lessons.length
      ? Math.round((enrollment.completedLessons.length / course.lessons.length) * 100)
      : 0;
    saveDb();
    return { progress: enrollment.progress, completed };
  },
  { auth: true },
);

route(
  'GET',
  '/courses/:slug',
  (ctx) => {
    const db = getDb();
    const u = requireUser(ctx);
    const course = db.courses.find((c) => c.slug === ctx.params.slug);
    if (!course) throw err(404, 'Course not found');
    return courseView(db, course, u);
  },
  { auth: true },
);

route(
  'POST',
  '/courses',
  (ctx) => {
    const db = getDb();
    requireAdmin(ctx);
    const slug = String(ctx.body.slug ?? '').trim();
    const title = String(ctx.body.title ?? '').trim();
    if (!slug || !title) issues('Slug and title are required');
    if (db.courses.some((c) => c.slug === slug)) throw err(409, 'A course with that slug already exists');
    const course: CourseRow = {
      id: id('crs'),
      slug,
      title,
      description: (ctx.body.description as string | undefined) ?? null,
      level: String(ctx.body.level ?? 'Beginner'),
      order: db.courses.length,
      price: Number(ctx.body.price ?? 0) || 0,
      isVip: Boolean(ctx.body.isVip),
      published: ctx.body.published !== false,
      coverUrl: (ctx.body.coverUrl as string | undefined) ?? null,
      lessons: [],
      resources: [],
    };
    db.courses.push(course);
    saveDb();
    return courseView(db, course, ctx.user!);
  },
  { auth: true, admin: true },
);

route(
  'PATCH',
  '/courses/:slug',
  (ctx) => {
    const db = getDb();
    requireAdmin(ctx);
    const course = db.courses.find((c) => c.slug === ctx.params.slug);
    if (!course) throw err(404, 'Course not found');
    for (const key of ['title', 'description', 'level', 'coverUrl'] as const) {
      if (typeof ctx.body[key] === 'string') (course as unknown as Record<string, unknown>)[key] = ctx.body[key];
    }
    if ('price' in ctx.body) course.price = Number(ctx.body.price) || 0;
    if ('published' in ctx.body) course.published = Boolean(ctx.body.published);
    if ('isVip' in ctx.body) course.isVip = Boolean(ctx.body.isVip);
    saveDb();
    return courseView(db, course, ctx.user!);
  },
  { auth: true, admin: true },
);

route(
  'DELETE',
  '/courses/:slug',
  (ctx) => {
    const db = getDb();
    requireAdmin(ctx);
    const course = db.courses.find((c) => c.slug === ctx.params.slug);
    if (!course) throw err(404, 'Course not found');
    db.courses = db.courses.filter((c) => c.id !== course.id);
    db.enrollments = db.enrollments.filter((e) => e.courseId !== course.id);
    saveDb();
    return { ok: true };
  },
  { auth: true, admin: true },
);

route(
  'POST',
  '/courses/:slug/lessons',
  (ctx) => {
    const db = getDb();
    requireAdmin(ctx);
    const course = db.courses.find((c) => c.slug === ctx.params.slug);
    if (!course) throw err(404, 'Course not found');
    const title = String(ctx.body.title ?? '').trim();
    if (!title) issues('Lesson title is required');
    const lesson: LessonRow = {
      id: id('les'),
      title,
      description: (ctx.body.description as string | undefined) ?? null,
      videoUrl: (ctx.body.videoUrl as string | undefined) ?? null,
      durationMin: Number(ctx.body.durationMin ?? 10) || 10,
      order: course.lessons.length,
      isFree: course.lessons.length === 0,
    };
    course.lessons.push(lesson);
    saveDb();
    return lesson;
  },
  { auth: true, admin: true },
);

route(
  'PATCH',
  '/courses/:slug/lessons/:lessonId',
  (ctx) => {
    const db = getDb();
    requireAdmin(ctx);
    const course = db.courses.find((c) => c.slug === ctx.params.slug);
    if (!course) throw err(404, 'Course not found');
    const lesson = course.lessons.find((l) => l.id === ctx.params.lessonId);
    if (!lesson) throw err(404, 'Lesson not found');
    for (const key of ['title', 'description', 'videoUrl'] as const) {
      if (typeof ctx.body[key] === 'string') (lesson as unknown as Record<string, unknown>)[key] = ctx.body[key];
    }
    if ('durationMin' in ctx.body) lesson.durationMin = Number(ctx.body.durationMin) || lesson.durationMin;
    if ('isFree' in ctx.body) lesson.isFree = Boolean(ctx.body.isFree);
    saveDb();
    return lesson;
  },
  { auth: true, admin: true },
);

route(
  'DELETE',
  '/courses/:slug/lessons/:lessonId',
  (ctx) => {
    const db = getDb();
    requireAdmin(ctx);
    const course = db.courses.find((c) => c.slug === ctx.params.slug);
    if (!course) throw err(404, 'Course not found');
    course.lessons = course.lessons.filter((l) => l.id !== ctx.params.lessonId);
    saveDb();
    return { ok: true };
  },
  { auth: true, admin: true },
);


route(
  'GET',
  '/community/groups',
  (ctx) => {
    const db = getDb();
    const u = requireUser(ctx);
    return db.groups.map((g) => groupView(db, g, u));
  },
  { auth: true },
);

route(
  'GET',
  '/community/groups/:id/messages',
  (ctx) => {
    const db = getDb();
    const u = requireUser(ctx);
    const group = db.groups.find((g) => g.id === ctx.params.id);
    if (!group) throw err(404, 'Group not found');
    if (!entitled(u, group.accessTier)) throw err(403, 'This room requires a higher membership');
    const messages = db.messages
      .filter((m) => m.groupId === group.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((m) => {
        const author = db.users.find((usr) => usr.id === m.userId);
        return {
          id: m.id,
          groupId: m.groupId,
          body: m.body,
          createdAt: m.createdAt,
          user: author ? { id: author.id, name: author.name, avatarUrl: author.avatarUrl } : { id: 'x', name: 'Member', avatarUrl: null },
        };
      });
    return { chatOpen: group.isChatOpen, messages };
  },
  { auth: true },
);

route(
  'POST',
  '/community/groups/:id/messages',
  (ctx) => {
    const db = getDb();
    const u = requireUser(ctx);
    const group = db.groups.find((g) => g.id === ctx.params.id);
    if (!group) throw err(404, 'Group not found');
    if (!entitled(u, group.accessTier)) throw err(403, 'This room requires a higher membership');
    const body = String(ctx.body.body ?? '').trim();
    if (!body) issues('Message cannot be empty');
    const row = { id: id('msg'), groupId: group.id, userId: u.id, body, createdAt: nowIso() };
    db.messages.push(row);
    saveDb();
    return { id: row.id, groupId: row.groupId, body: row.body, createdAt: row.createdAt, user: { id: u.id, name: u.name, avatarUrl: u.avatarUrl } };
  },
  { auth: true },
);

route(
  'GET',
  '/community/groups/:id',
  (ctx) => {
    const db = getDb();
    const u = requireUser(ctx);
    const group = db.groups.find((g) => g.id === ctx.params.id);
    if (!group) throw err(404, 'Group not found');
    return groupView(db, group, u);
  },
  { auth: true },
);

route(
  'POST',
  '/community/groups/:id/join',
  (ctx) => {
    const db = getDb();
    const u = requireUser(ctx);
    const group = db.groups.find((g) => g.id === ctx.params.id);
    if (!group) throw err(404, 'Group not found');
    if (!entitled(u, group.accessTier)) throw err(403, 'This room requires a higher membership');
    if (!db.members.some((m) => m.groupId === group.id && m.userId === u.id)) {
      db.members.push({ groupId: group.id, userId: u.id });
      saveDb();
    }
    return { ok: true };
  },
  { auth: true },
);

route(
  'DELETE',
  '/community/groups/:id/join',
  (ctx) => {
    const db = getDb();
    const u = requireUser(ctx);
    db.members = db.members.filter((m) => !(m.groupId === ctx.params.id && m.userId === u.id));
    saveDb();
    return { ok: true };
  },
  { auth: true },
);

route(
  'GET',
  '/community/posts',
  (ctx) => {
    const db = getDb();
    const u = requireUser(ctx);
    let rows = db.posts.slice();
    if (typeof ctx.query.groupId === 'string' && ctx.query.groupId) rows = rows.filter((p) => p.groupId === ctx.query.groupId);
    if (typeof ctx.query.category === 'string' && ctx.query.category) rows = rows.filter((p) => p.kind === ctx.query.category);
    if (typeof ctx.query.q === 'string' && ctx.query.q) {
      const q = ctx.query.q.toLowerCase();
      rows = rows.filter((p) => p.body.toLowerCase().includes(q));
    }
    rows = rows.filter((p) => {
      const group = p.groupId ? db.groups.find((g) => g.id === p.groupId) : null;
      return p.authorId === u.id || !group || entitled(u, group.accessTier);
    });
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((p) => postView(db, p, u));
  },
  { auth: true },
);

route(
  'POST',
  '/community/posts',
  (ctx) => {
    const db = getDb();
    const u = requireUser(ctx);
    const body = String(ctx.body.body ?? '').trim();
    if (!body) issues('Post body is required');
    const groupId = (ctx.body.groupId as string | undefined) || null;
    if (groupId) {
      const group = db.groups.find((g) => g.id === groupId);
      if (!group) throw err(404, 'Group not found');
      if (!entitled(u, group.accessTier)) throw err(403, 'This room requires a higher membership');
    }
    const row: PostRow = {
      id: id('post'),
      groupId,
      authorId: u.id,
      kind: (ctx.body.kind as PostRow['kind']) || 'POST',
      body,
      imageUrl: (ctx.body.imageUrl as string | undefined) || null,
      createdAt: nowIso(),
      likes: [],
    };
    db.posts.unshift(row);
    saveDb();
    return postView(db, row, u);
  },
  { auth: true },
);

route(
  'POST',
  '/community/posts/:id/like',
  (ctx) => {
    const db = getDb();
    const u = requireUser(ctx);
    const post = db.posts.find((p) => p.id === ctx.params.id);
    if (!post) throw err(404, 'Post not found');
    const liked = post.likes.includes(u.id);
    post.likes = liked ? post.likes.filter((l) => l !== u.id) : [...post.likes, u.id];
    saveDb();
    return { liked: !liked };
  },
  { auth: true },
);

route(
  'GET',
  '/community/posts/:id/comments',
  (ctx) => {
    const db = getDb();
    const post = db.posts.find((p) => p.id === ctx.params.id);
    if (!post) throw err(404, 'Post not found');
    return db.comments
      .filter((c) => c.postId === post.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((c) => {
        const author = db.users.find((u) => u.id === c.userId);
        return {
          id: c.id,
          body: c.body,
          createdAt: c.createdAt,
          user: author ? { id: author.id, name: author.name, avatarUrl: author.avatarUrl } : { id: 'x', name: 'Member', avatarUrl: null },
        };
      });
  },
  { auth: true },
);

route(
  'POST',
  '/community/posts/:id/comments',
  (ctx) => {
    const db = getDb();
    const u = requireUser(ctx);
    const post = db.posts.find((p) => p.id === ctx.params.id);
    if (!post) throw err(404, 'Post not found');
    const body = String(ctx.body.body ?? '').trim();
    if (!body) issues('Comment cannot be empty');
    const row = { id: id('cmt'), postId: post.id, userId: u.id, body, createdAt: nowIso() };
    db.comments.push(row);
    saveDb();
    return { id: row.id, body: row.body, createdAt: row.createdAt, user: { id: u.id, name: u.name, avatarUrl: u.avatarUrl } };
  },
  { auth: true },
);


route(
  'GET',
  '/wallet',
  (ctx) => {
    const u = requireUser(ctx);
    return {
      id: u.wallet.id,
      balance: u.wallet.balance,
      currency: u.wallet.currency,
      providerConfigured: false,
      methods: ['ECOCASH', 'ONEMONEY', 'INNBUCKS', 'CASHSMILE', 'BANK_TRANSFER'],
    };
  },
  { auth: true },
);

route(
  'GET',
  '/wallet/withdrawal-config',
  () => ({ min: 1, max: 50000, feePct: 0, manualReview: true, methods: ['BANK_TRANSFER', 'ECOCASH', 'ONEMONEY', 'INNBUCKS', 'CASHSMILE', 'USDT_TRC20'] }),
  { auth: true },
);

route(
  'GET',
  '/wallet/transactions',
  (ctx) => {
    const u = requireUser(ctx);
    return getDb()
      .txs.filter((t) => t.userId === u.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(txView);
  },
  { auth: true },
);

route(
  'POST',
  '/wallet/deposit',
  (ctx) => {
    const db = getDb();
    const u = requireUser(ctx);
    const amount = Number(ctx.body.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) issues('Enter a valid amount');
    const tx: TxRow = {
      id: id('tx'),
      userId: u.id,
      type: 'DEPOSIT',
      method: String(ctx.body.method ?? 'ECOCASH'),
      amount,
      fee: 0,
      currency: String(ctx.body.currency ?? 'USD'),
      status: 'PENDING',
      reference: `ATG-DEP-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      note: null,
      destination: null,
      adminNote: null,
      processedAt: null,
      createdAt: nowIso(),
    };
    db.txs.unshift(tx);
    saveDb();
    return { transaction: txView(tx), provider: 'manual' };
  },
  { auth: true },
);

route(
  'POST',
  '/wallet/withdraw',
  (ctx) => {
    const db = getDb();
    const u = requireUser(ctx);
    const amount = Number(ctx.body.amount ?? 0);
    const destination = String(ctx.body.destination ?? '').trim();
    if (!Number.isFinite(amount) || amount <= 0) issues('Enter a valid amount');
    if (!destination) issues('Destination is required');
    if (amount < 1 || amount > 50000) throw err(400, 'Withdrawal amount is outside configured limits');
    if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-8) issues('Use at most two decimal places');
    const method = String(ctx.body.method ?? 'ECOCASH');
    const methods = ['BANK_TRANSFER', 'ECOCASH', 'ONEMONEY', 'INNBUCKS', 'CASHSMILE', 'USDT_TRC20'];
    if (!methods.includes(method)) issues('Choose a supported payout method');
    if (method === 'USDT_TRC20' && !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(destination)) {
      issues('Enter a valid TRON wallet address for USDT (TRC20)');
    }
    const idempotencyKey = String(ctx.body.idempotencyKey ?? '').trim();
    const existing = idempotencyKey ? db.txs.find((t) => t.userId === u.id && t.idempotencyKey === idempotencyKey) : null;
    if (existing) {
      if (existing.amount !== amount || existing.method !== method || existing.destination !== destination) {
        throw err(409, 'This request key was already used for a different withdrawal');
      }
      return { transaction: txView(existing), provider: 'manual', duplicate: true };
    }
    if (amount > u.wallet.balance) throw err(400, 'Insufficient balance');
    u.wallet.balance = Math.round((u.wallet.balance - amount) * 100) / 100;
    const fee = 0;
    const tx: TxRow = {
      id: id('tx'),
      userId: u.id,
      type: 'WITHDRAWAL',
      method,
      amount,
      fee,
      netAmount: amount - fee,
      currency: u.wallet.currency,
      status: 'PENDING',
      reference: `ATG-WDR-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      idempotencyKey: idempotencyKey || null,
      note: 'Manual payout review required; request is not yet paid.',
      destination,
      providerRef: null,
      adminNote: null,
      processedAt: null,
      createdAt: nowIso(),
      statusHistory: [
        { id: id('txh'), fromStatus: null, toStatus: 'PENDING', actorRole: 'USER', note: 'Funds held pending payout review.', createdAt: nowIso() },
      ],
    };
    db.txs.unshift(tx);
    saveDb();
    return { transaction: txView(tx), provider: 'manual', duplicate: false };
  },
  { auth: true },
);


route(
  'GET',
  '/payments/config',
  () => ({
    stripeConfigured: false,
    currency: 'USD',
    vipPriceMonthly: 29.99,
    gateways: [
      {
        name: 'Manual review',
        kind: 'manual',
        configured: true,
        methods: ['ECOCASH', 'ONEMONEY', 'INNBUCKS', 'CASHSMILE', 'BANK_TRANSFER'],
      },
    ],
    methods: ['ECOCASH', 'ONEMONEY', 'INNBUCKS', 'CASHSMILE', 'BANK_TRANSFER'],
  }),
  { auth: true },
);

route(
  'GET',
  '/payments/purchases',
  (ctx) => {
    const u = requireUser(ctx);
    return getDb()
      .purchases.filter((p) => p.userId === u.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(purchaseView);
  },
  { auth: true },
);

function purchaseView(p: import('./store').PurchaseRow) {
  const { userId: _user, adminNote: _admin, ...rest } = p;
  void _user;
  void _admin;
  return rest;
}

route(
  'POST',
  '/payments/checkout',
  (ctx) => {
    const db = getDb();
    const u = requireUser(ctx);
    const itemType = String(ctx.body.itemType ?? 'COURSE');
    const itemId = String(ctx.body.itemId ?? '');
    let itemTitle = 'VIP Subscription';
    let amount = 29.99;
    if (itemType === 'COURSE') {
      const course = db.courses.find((c) => c.id === itemId || c.slug === itemId);
      if (!course) throw err(404, 'Course not found');
      if (course.price <= 0) throw err(400, 'This course is free');
      itemTitle = course.title;
      amount = course.price;
    }
    const purchase: import('./store').PurchaseRow = {
      id: id('pur'),
      userId: u.id,
      itemType,
      itemId,
      itemTitle,
      amount,
      currency: 'USD',
      status: 'PROCESSING',
      provider: 'manual',
      method: (ctx.body.method as string | undefined) ?? 'ECOCASH',
      proofNote: null,
      adminNote: null,
      createdAt: nowIso(),
    };
    db.purchases.unshift(purchase);
    saveDb();
    return {
      provider: 'manual',
      purchaseId: purchase.id,
      status: purchase.status,
      instructions: 'Send the payment using your chosen method, then submit your proof of payment for review.',
    };
  },
  { auth: true },
);

route(
  'POST',
  '/payments/purchases/:id/submit',
  (ctx) => {
    const db = getDb();
    const u = requireUser(ctx);
    const purchase = db.purchases.find((p) => p.id === ctx.params.id && p.userId === u.id);
    if (!purchase) throw err(404, 'Purchase not found');
    purchase.proofNote = String(ctx.body.proofNote ?? '');
    purchase.status = 'PENDING';
    saveDb();
    return purchaseView(purchase);
  },
  { auth: true },
);


route(
  'GET',
  '/subscriptions',
  (ctx) => {
    const u = requireUser(ctx);
    return subscriptionView(getDb(), u);
  },
  { auth: true },
);

route(
  'POST',
  '/subscriptions/cancel',
  (ctx) => {
    const db = getDb();
    const u = requireUser(ctx);
    const sub = db.subscriptions.find((s) => s.userId === u.id);
    if (sub) {
      sub.status = 'CANCELLED';
      sub.autoRenew = false;
      saveDb();
    }
    return subscriptionView(db, u);
  },
  { auth: true },
);

route(
  'POST',
  '/subscriptions/renew',
  (ctx) => {
    const db = getDb();
    const u = requireUser(ctx);
    const purchase: import('./store').PurchaseRow = {
      id: id('pur'),
      userId: u.id,
      itemType: 'SUBSCRIPTION',
      itemId: 'vip-monthly',
      itemTitle: 'VIP Subscription (monthly)',
      amount: 29.99,
      currency: 'USD',
      status: 'PROCESSING',
      provider: 'manual',
      method: 'ECOCASH',
      proofNote: null,
      adminNote: null,
      createdAt: nowIso(),
    };
    db.purchases.unshift(purchase);
    saveDb();
    return {
      provider: 'manual',
      purchaseId: purchase.id,
      instructions: 'Send the payment using your chosen method, then submit your proof of payment for review.',
    };
  },
  { auth: true },
);


route(
  'GET',
  '/notifications',
  (ctx) => {
    const u = requireUser(ctx);
    const rows = getDb()
      .notifications.filter((n) => n.userId === u.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      notifications: rows.map(({ userId: _u, ...rest }) => {
        void _u;
        return rest;
      }),
      unread: rows.filter((n) => !n.read).length,
    };
  },
  { auth: true },
);

route(
  'POST',
  '/notifications/read-all',
  (ctx) => {
    const db = getDb();
    const u = requireUser(ctx);
    for (const n of db.notifications) if (n.userId === u.id) n.read = true;
    saveDb();
    return { ok: true };
  },
  { auth: true },
);

route(
  'POST',
  '/notifications/:id/read',
  (ctx) => {
    const db = getDb();
    const u = requireUser(ctx);
    const n = db.notifications.find((row) => row.id === ctx.params.id && row.userId === u.id);
    if (n) {
      n.read = true;
      saveDb();
    }
    return { ok: true };
  },
  { auth: true },
);

route(
  'GET',
  '/notifications/push/public-key',
  () => ({ publicKey: '' }),
  { auth: true },
);

route(
  'POST',
  '/notifications/push/subscribe',
  () => ({ ok: true }),
  { auth: true },
);


route(
  'GET',
  '/admin/stats',
  (ctx) => {
    const db = getDb();
    requireAdmin(ctx);
    const paid = db.purchases.filter((p) => p.status === 'PAID');
    const pending = (s: string) => s === 'PENDING' || s === 'PROCESSING';
    const memberships: Record<string, number> = {};
    for (const u of db.users) memberships[u.membership] = (memberships[u.membership] ?? 0) + 1;
    return {
      users: db.users.length,
      vips: db.users.filter((u) => u.membership.startsWith('VIP')).length,
      memberships,
      signals: db.signals.length,
      openSignals: db.signals.filter((s) => s.status === 'OPEN').length,
      courses: db.courses.length,
      freeCourses: db.courses.filter((c) => c.price <= 0).length,
      freeCourseLimit: 5,
      purchases: paid.length,
      revenue: paid.reduce((sum, p) => sum + p.amount, 0),
      groups: db.groups.length,
      posts: db.posts.length,
      transactions: db.txs.length,
      pendingTxns: db.txs.filter((t) => pending(t.status)).length,
      pendingPurchases: db.purchases.filter((p) => pending(p.status)).length,
      pendingWithdrawals: db.txs.filter((t) => t.type === 'WITHDRAWAL' && pending(t.status)).length,
      recentPurchases: paid.slice(0, 8).map((p) => {
        const owner = db.users.find((x) => x.id === p.userId);
        return { ...purchaseView(p), user: { name: owner?.name ?? 'Unknown', email: owner?.email ?? '' } };
      }),
    };
  },
  { auth: true, admin: true },
);

route(
  'GET',
  '/admin/users',
  (ctx) => {
    const db = getDb();
    requireAdmin(ctx);
    let rows = db.users.slice();
    if (typeof ctx.query.q === 'string' && ctx.query.q) {
      const q = ctx.query.q.toLowerCase();
      rows = rows.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
    }
    if (typeof ctx.query.membership === 'string' && ctx.query.membership) {
      rows = rows.filter((u) => u.membership === ctx.query.membership);
    }
    return rows.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      membership: u.membership,
      isVip: u.isVip,
      vipExpiresAt: u.vipExpiresAt,
      wallet: { balance: u.wallet.balance },
      _count: { purchases: db.purchases.filter((p) => p.userId === u.id).length },
    }));
  },
  { auth: true, admin: true },
);

route(
  'PATCH',
  '/admin/users/:id',
  (ctx) => {
    const db = getDb();
    requireAdmin(ctx);
    const user = db.users.find((u) => u.id === ctx.params.id);
    if (!user) throw err(404, 'User not found');
    if (typeof ctx.body.role === 'string') user.role = ctx.body.role === 'ADMIN' ? 'ADMIN' : 'USER';
    if (typeof ctx.body.membership === 'string') {
      user.membership = ctx.body.membership as Membership;
      user.isVip = user.membership.startsWith('VIP');
    }
    if ('vipDays' in ctx.body && Number(ctx.body.vipDays) > 0) {
      user.membership = 'VIP_DERIV';
      user.isVip = true;
      user.vipExpiresAt = new Date(Date.now() + Number(ctx.body.vipDays) * 86_400_000).toISOString();
    }
    saveDb();
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      membership: user.membership,
      isVip: user.isVip,
      vipExpiresAt: user.vipExpiresAt,
      wallet: { balance: user.wallet.balance },
      _count: { purchases: db.purchases.filter((p) => p.userId === user.id).length },
    };
  },
  { auth: true, admin: true },
);

route(
  'GET',
  '/admin/transactions',
  (ctx) => {
    const db = getDb();
    requireAdmin(ctx);
    let rows = db.txs.slice();
    if (typeof ctx.query.status === 'string' && ctx.query.status) rows = rows.filter((t) => t.status === ctx.query.status);
    if (typeof ctx.query.type === 'string' && ctx.query.type) rows = rows.filter((t) => t.type === ctx.query.type);
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((t) => {
      const owner = db.users.find((u) => u.id === t.userId);
      return { ...txView(t), user: { name: owner?.name ?? 'Unknown', email: owner?.email ?? '' } };
    });
  },
  { auth: true, admin: true },
);

route(
  'PATCH',
  '/admin/transactions/:id',
  (ctx) => {
    const db = getDb();
    requireAdmin(ctx);
    const tx = db.txs.find((t) => t.id === ctx.params.id);
    if (!tx) throw err(404, 'Transaction not found');
    const owner = db.users.find((u) => u.id === tx.userId);
    const action = String(ctx.body.action ?? '');
    if (tx.status === 'COMPLETED' || tx.status === 'FAILED') throw err(400, `Transaction already ${tx.status.toLowerCase()}`);
    const note = typeof ctx.body.adminNote === 'string' ? ctx.body.adminNote.trim() : '';
    const providerRef = typeof ctx.body.providerRef === 'string' ? ctx.body.providerRef.trim() : '';
    const fromStatus = tx.status;
    if (action === 'approve') {
      if (tx.type === 'WITHDRAWAL') {
        tx.status = 'PROCESSING';
      } else {
        tx.status = 'COMPLETED';
        if (owner) owner.wallet.balance = Math.round((owner.wallet.balance + tx.amount) * 100) / 100;
      }
    } else if (action === 'reject') {
      if (tx.type === 'WITHDRAWAL' && note.length < 3) issues('A rejection reason is required');
      tx.status = 'FAILED';
      if (owner && tx.type === 'WITHDRAWAL') owner.wallet.balance = Math.round((owner.wallet.balance + tx.amount) * 100) / 100;
    } else if (action === 'processing') {
      tx.status = 'PROCESSING';
    } else if (action === 'paid') {
      if (tx.type !== 'WITHDRAWAL') issues('Only withdrawals can be marked paid');
      if (tx.status !== 'PROCESSING') throw err(409, 'Start payout processing before recording payment confirmation');
      if (providerRef.length < 3) issues('Enter the verified payout reference');
      tx.status = 'COMPLETED';
      tx.providerRef = providerRef;
    } else {
      issues('Unknown action');
    }
    tx.processedAt = nowIso();
    if (note) tx.adminNote = note;
    tx.statusHistory ??= [];
    tx.statusHistory.push({
      id: id('txh'),
      fromStatus,
      toStatus: tx.status,
      actorRole: 'ADMIN',
      note: action === 'paid' ? `Payout confirmed with reference ${providerRef}` : note || null,
      createdAt: nowIso(),
    });
    saveDb();
    const ownerAfter = db.users.find((u) => u.id === tx.userId);
    return { ...txView(tx), user: { name: ownerAfter?.name ?? 'Unknown', email: ownerAfter?.email ?? '' } };
  },
  { auth: true, admin: true },
);

route(
  'POST',
  '/admin/broadcast',
  (ctx) => {
    const db = getDb();
    requireAdmin(ctx);
    const title = String(ctx.body.title ?? '').trim();
    const body = String(ctx.body.body ?? '').trim();
    if (!title || !body) issues('Title and body are required');
    const audience = String(ctx.body.audience ?? 'ALL');
    const targets = db.users.filter((u) => {
      if (u.role === 'ADMIN') return false;
      if (audience === 'VIP') return u.membership.startsWith('VIP');
      if (audience === 'FREE') return u.membership === 'FREE';
      return true;
    });
    for (const target of targets) {
      db.notifications.unshift({
        id: id('n'),
        userId: target.id,
        title,
        body,
        type: String(ctx.body.type ?? 'SYSTEM'),
        read: false,
        link: (ctx.body.link as string | undefined) ?? null,
        createdAt: nowIso(),
      });
    }
    saveDb();
    return { ok: true, count: targets.length };
  },
  { auth: true, admin: true },
);

route(
  'GET',
  '/admin/purchases',
  (ctx) => {
    const db = getDb();
    requireAdmin(ctx);
    let rows = db.purchases.slice();
    if (typeof ctx.query.status === 'string' && ctx.query.status) rows = rows.filter((p) => p.status === ctx.query.status);
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((p) => {
      const owner = db.users.find((u) => u.id === p.userId);
      return { ...purchaseView(p), user: { name: owner?.name ?? 'Unknown', email: owner?.email ?? '' } };
    });
  },
  { auth: true, admin: true },
);

route(
  'PATCH',
  '/admin/purchases/:id',
  (ctx) => {
    const db = getDb();
    requireAdmin(ctx);
    const purchase = db.purchases.find((p) => p.id === ctx.params.id);
    if (!purchase) throw err(404, 'Purchase not found');
    const action = String(ctx.body.action ?? '');
    if (action === 'verify') {
      purchase.status = 'PAID';
      if (purchase.itemType === 'COURSE' && !db.enrollments.some((e) => e.userId === purchase.userId && e.courseId === purchase.itemId)) {
        db.enrollments.push({ userId: purchase.userId, courseId: purchase.itemId, progress: 0, completedLessons: [] });
      }
      const owner = db.users.find((u) => u.id === purchase.userId);
      if (owner && purchase.itemType === 'SUBSCRIPTION') {
        const expiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
        const existing = db.subscriptions.find((s) => s.userId === owner.id);
        if (existing) Object.assign(existing, { plan: 'VIP', status: 'ACTIVE', expiresAt, startedAt: nowIso(), autoRenew: true });
        else db.subscriptions.push({ userId: owner.id, plan: 'VIP', status: 'ACTIVE', startedAt: nowIso(), expiresAt, autoRenew: true });
        owner.membership = 'VIP_DERIV';
        owner.isVip = true;
      }
    } else if (action === 'reject') {
      purchase.status = 'FAILED';
    } else {
      issues('Unknown action');
    }
    if (typeof ctx.body.adminNote === 'string') purchase.adminNote = ctx.body.adminNote;
    saveDb();
    const owner = db.users.find((u) => u.id === purchase.userId);
    return { ...purchaseView(purchase), user: { name: owner?.name ?? 'Unknown', email: owner?.email ?? '' } };
  },
  { auth: true, admin: true },
);

route(
  'GET',
  '/admin/groups',
  (ctx) => {
    const db = getDb();
    const u = requireAdmin(ctx);
    return db.groups.map((g) => groupView(db, g, u));
  },
  { auth: true, admin: true },
);

route(
  'POST',
  '/admin/groups',
  (ctx) => {
    const db = getDb();
    const u = requireAdmin(ctx);
    const name = String(ctx.body.name ?? '').trim();
    if (!name) issues('Group name is required');
    const group: GroupRow = {
      id: id('grp'),
      name,
      description: (ctx.body.description as string | undefined) ?? null,
      category: String(ctx.body.category ?? 'General'),
      visibility: (ctx.body.visibility as GroupRow['visibility']) || 'PUBLIC',
      accessTier: (ctx.body.accessTier as GroupRow['accessTier']) || 'FREE',
      roomType: (ctx.body.roomType as GroupRow['roomType']) || 'GENERAL',
      isChatOpen: ctx.body.isChatOpen !== false,
      ownerId: u.id,
    };
    db.groups.push(group);
    saveDb();
    return groupView(db, group, u);
  },
  { auth: true, admin: true },
);

route(
  'PATCH',
  '/admin/groups/:id',
  (ctx) => {
    const db = getDb();
    const u = requireAdmin(ctx);
    const group = db.groups.find((g) => g.id === ctx.params.id);
    if (!group) throw err(404, 'Group not found');
    for (const key of ['name', 'description', 'category'] as const) {
      if (typeof ctx.body[key] === 'string') (group as unknown as Record<string, unknown>)[key] = ctx.body[key];
    }
    for (const key of ['visibility', 'accessTier', 'roomType'] as const) {
      if (typeof ctx.body[key] === 'string') (group as unknown as Record<string, unknown>)[key] = ctx.body[key];
    }
    if ('isChatOpen' in ctx.body) group.isChatOpen = Boolean(ctx.body.isChatOpen);
    saveDb();
    return groupView(db, group, u);
  },
  { auth: true, admin: true },
);

route(
  'DELETE',
  '/admin/groups/:id',
  (ctx) => {
    const db = getDb();
    requireAdmin(ctx);
    db.groups = db.groups.filter((g) => g.id !== ctx.params.id);
    db.members = db.members.filter((m) => m.groupId !== ctx.params.id);
    saveDb();
    return { ok: true };
  },
  { auth: true, admin: true },
);

route(
  'POST',
  '/admin/resources',
  (ctx) => {
    const db = getDb();
    requireAdmin(ctx);
    const courseId = String(ctx.body.courseId ?? '');
    const course = db.courses.find((c) => c.id === courseId);
    if (!course) throw err(404, 'Course not found');
    const resource: ResourceRowImport = {
      id: id('res'),
      courseId: course.id,
      title: String(ctx.body.title ?? 'Resource'),
      type: String(ctx.body.type ?? 'PDF'),
      url: String(ctx.body.url ?? ''),
      sizeKb: Number(ctx.body.sizeKb ?? 0) || 0,
      isVip: Boolean(ctx.body.isVip),
    };
    course.resources.push(resource);
    saveDb();
    return resource;
  },
  { auth: true, admin: true },
);

type ResourceRowImport = import('./store').ResourceRow;

route(
  'DELETE',
  '/admin/resources/:id',
  (ctx) => {
    const db = getDb();
    requireAdmin(ctx);
    for (const course of db.courses) {
      const before = course.resources.length;
      course.resources = course.resources.filter((r) => r.id !== ctx.params.id);
      if (course.resources.length !== before) {
        saveDb();
        return { ok: true };
      }
    }
    throw err(404, 'Resource not found');
  },
  { auth: true, admin: true },
);


route('GET', '/broker/config', () => brokerConfig(getDb()), { auth: true });

route(
  'GET',
  '/broker/balances',
  (ctx) => {
    const db = getDb();
    const u = requireUser(ctx);
    const balances = (['DERIV', 'WELTRADE'] as const).map((broker) => {
      const row = db.brokerBalances.find((b) => b.userId === u.id && b.broker === broker);
      return {
        broker,
        brokerLabel: BROKER_LABELS[broker],
        available: Boolean(row),
        balance: row ? row.balance : null,
        currency: 'USD',
        source: row?.source ?? null,
        verifiedAt: row?.verifiedAt ?? null,
      };
    });
    return { balances, notice: 'Broker balances are recorded manually by the administrator.' };
  },
  { auth: true },
);

function brokerList(db: ReturnType<typeof getDb>, u: UserRow, direction: 'DEPOSIT' | 'WITHDRAWAL', query: Record<string, unknown>) {
  let rows = db.brokerTx.filter((t) => t.userId === u.id && t.direction === direction);
  if (typeof query.broker === 'string' && query.broker) rows = rows.filter((t) => t.broker === query.broker);
  if (typeof query.status === 'string' && query.status) rows = rows.filter((t) => t.status === query.status);
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((t) => brokerView(db, t, u));
}

route('GET', '/broker/deposits', (ctx) => brokerList(getDb(), requireUser(ctx), 'DEPOSIT', ctx.query), { auth: true });
route('GET', '/broker/withdrawals', (ctx) => brokerList(getDb(), requireUser(ctx), 'WITHDRAWAL', ctx.query), { auth: true });

route(
  'GET',
  '/broker/transactions',
  (ctx) => {
    const db = getDb();
    const u = requireUser(ctx);
    let rows = db.brokerTx.filter((t) => t.userId === u.id);
    if (typeof ctx.query.direction === 'string' && ctx.query.direction) rows = rows.filter((t) => t.direction === ctx.query.direction);
    if (typeof ctx.query.broker === 'string' && ctx.query.broker) rows = rows.filter((t) => t.broker === ctx.query.broker);
    if (typeof ctx.query.status === 'string' && ctx.query.status) rows = rows.filter((t) => t.status === ctx.query.status);
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((t) => brokerView(db, t, u));
  },
  { auth: true },
);

route(
  'GET',
  '/broker/transactions/:id',
  (ctx) => {
    const db = getDb();
    const u = requireUser(ctx);
    const row = db.brokerTx.find((t) => t.id === ctx.params.id && t.userId === u.id);
    if (!row) throw err(404, 'Transaction not found');
    return { ...brokerView(db, row, u), timeline: row.timeline };
  },
  { auth: true },
);

function pendingCount(db: ReturnType<typeof getDb>, userId: string): number {
  const active = ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING'];
  return db.brokerTx.filter((t) => t.userId === userId && active.includes(t.status)).length;
}

route(
  'POST',
  '/broker/deposits',
  (ctx) => {
    const db = getDb();
    const u = requireUser(ctx);
    const s = effectiveSettings(db);
    const broker = String(ctx.body.broker ?? '') as BrokerId;
    const amount = Number(ctx.body.amount ?? 0);
    const method = String(ctx.body.method ?? '');
    const paymentReference = String(ctx.body.paymentReference ?? '').trim();
    if (broker !== 'DERIV' && broker !== 'WELTRADE') issues('Choose a broker');
    if (!Number.isFinite(amount) || amount < s.deposit.min) issues(`Minimum deposit is $${s.deposit.min}`);
    if (amount > s.deposit.max) issues(`Maximum deposit is $${s.deposit.max}`);
    if (!method) issues('Choose a payment method');
    if (!paymentReference) issues('Payment reference is required');
    if (method === 'USDT_TRC20' && !/^[a-fA-F0-9]{64}$/.test(paymentReference)) {
      issues('Enter the 64-character USDT TRC20 transaction hash');
    }
    if (pendingCount(db, u.id) >= s.pendingLimit) issues(`You can have at most ${s.pendingLimit} pending requests`);

    const feeAmount = Math.round(amount * s.feePct) / 100;
    const row: BrokerTxRow = {
      id: id('btx'),
      userId: u.id,
      direction: 'DEPOSIT',
      broker,
      amount,
      currency: 'USD',
      method,
      paymentReference,
      feePct: s.feePct,
      feeAmount,
      status: 'PENDING',
      reference: `ATG-BD-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      provider: 'manual',
      processingMode: 'manual',
      providerRef: null,
      destination: null,
      destinationType: null,
      adminNote: null,
      internalNote: null,
      failureReason: null,
      evidence: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      completedAt: null,
      processedAt: null,
      timeline: [
        { id: id('tl'), action: 'SUBMITTED', fromStatus: null, toStatus: 'PENDING', source: 'USER', note: null, at: nowIso() },
      ],
    };
    db.brokerTx.unshift(row);
    audit(db, { action: 'SUBMIT_DEPOSIT', transactionId: row.id, broker, toStatus: 'PENDING', source: 'USER', actor: u, snapshot: row });
    saveDb();
    return {
      status: 201,
      data: {
        transaction: brokerView(db, row, u),
        duplicate: false,
        mode: 'manual',
        provider: 'manual',
        instructions: 'Send the funds using your chosen method and keep the payment reference â€” the administrator will verify and complete the deposit.',
      },
    };
  },
  { auth: true },
);

route(
  'POST',
  '/broker/withdrawals',
  (ctx) => {
    const db = getDb();
    const u = requireUser(ctx);
    const s = effectiveSettings(db);
    const broker = String(ctx.body.broker ?? '') as BrokerId;
    const amount = Number(ctx.body.amount ?? 0);
    const method = String(ctx.body.method ?? '');
    const destination = String(ctx.body.destination ?? '').trim();
    const destinationType = String(ctx.body.destinationType ?? '');
    const paymentReference = String(ctx.body.paymentReference ?? '').trim();
    if (broker !== 'DERIV' && broker !== 'WELTRADE') issues('Choose a broker');
    if (!Number.isFinite(amount) || amount < s.withdrawal.min) issues(`Minimum withdrawal is $${s.withdrawal.min}`);
    if (amount > s.withdrawal.max) issues(`Maximum withdrawal is $${s.withdrawal.max}`);
    if (!method) issues('Choose a payment method');
    if (!destination) issues('Destination is required');
    if (!destinationType) issues('Destination type is required');
    if (destinationType === 'CRYPTO_WALLET' && method !== 'USDT_TRC20') {
      issues('USDT wallet destinations require the USDT (TRC20) method');
    }
    if (method === 'USDT_TRC20' && destinationType !== 'CRYPTO_WALLET') {
      issues('USDT withdrawals must use a crypto wallet destination on TRC20');
    }
    if (method === 'USDT_TRC20' && !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(destination)) {
      issues('Enter a valid TRON wallet address for USDT (TRC20)');
    }
    if (paymentReference.trim().length < 3) {
      issues(`Enter your ${broker === 'DERIV' ? 'Deriv account ID' : 'Weltrade client ID'}`);
    }
    if (pendingCount(db, u.id) >= s.pendingLimit) issues(`You can have at most ${s.pendingLimit} pending requests`);
    const today = nowIso().slice(0, 10);
    const withdrawnToday = db.brokerTx
      .filter((t) => t.userId === u.id && t.direction === 'WITHDRAWAL' && t.createdAt.slice(0, 10) === today && t.status !== 'REJECTED')
      .reduce((sum, t) => sum + t.amount, 0);
    if (withdrawnToday + amount > s.withdrawal.dailyMax) issues(`Daily withdrawal limit is $${s.withdrawal.dailyMax}`);

    const feeAmount = Math.round(amount * s.feePct) / 100;
    const row: BrokerTxRow = {
      id: id('btx'),
      userId: u.id,
      direction: 'WITHDRAWAL',
      broker,
      amount,
      currency: 'USD',
      method,
      paymentReference: (ctx.body.paymentReference as string | undefined) || null,
      feePct: s.feePct,
      feeAmount,
      status: 'PENDING',
      reference: `ATG-BW-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      provider: 'manual',
      processingMode: 'manual',
      providerRef: null,
      destination,
      destinationType,
      adminNote: null,
      internalNote: null,
      failureReason: null,
      evidence: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      completedAt: null,
      processedAt: null,
      timeline: [
        { id: id('tl'), action: 'SUBMITTED', fromStatus: null, toStatus: 'PENDING', source: 'USER', note: null, at: nowIso() },
      ],
    };
    db.brokerTx.unshift(row);
    audit(db, { action: 'SUBMIT_WITHDRAWAL', transactionId: row.id, broker, toStatus: 'PENDING', source: 'USER', actor: u, snapshot: row });
    saveDb();
    return {
      status: 201,
      data: {
        transaction: brokerView(db, row, u),
        duplicate: false,
        mode: 'manual',
        provider: 'manual',
        instructions: 'The administrator will review and process your withdrawal.',
      },
    };
  },
  { auth: true },
);


function adminBrokerList(db: ReturnType<typeof getDb>, direction: 'DEPOSIT' | 'WITHDRAWAL', query: Record<string, unknown>) {
  let rows = db.brokerTx.filter((t) => t.direction === direction);
  if (typeof query.broker === 'string' && query.broker) rows = rows.filter((t) => t.broker === query.broker);
  if (typeof query.status === 'string' && query.status) rows = rows.filter((t) => t.status === query.status);
  if (typeof query.q === 'string' && query.q) {
    const q = query.q.toLowerCase();
    rows = rows.filter((t) => {
      const owner = db.users.find((u) => u.id === t.userId);
      return (
        t.reference.toLowerCase().includes(q) ||
        String(t.amount).includes(q) ||
        (owner?.name ?? '').toLowerCase().includes(q) ||
        (owner?.email ?? '').toLowerCase().includes(q)
      );
    });
  }
  if (typeof query.minAmount === 'string' && query.minAmount) rows = rows.filter((t) => t.amount >= Number(query.minAmount));
  if (typeof query.maxAmount === 'string' && query.maxAmount) rows = rows.filter((t) => t.amount <= Number(query.maxAmount));
  if (typeof query.from === 'string' && query.from) {
    const from = query.from;
    rows = rows.filter((t) => t.createdAt >= from);
  }
  if (typeof query.to === 'string' && query.to) rows = rows.filter((t) => t.createdAt.slice(0, 10) <= String(query.to));
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((t) => adminBrokerView(db, t));
}

route('GET', '/admin/broker/deposits', (ctx) => adminBrokerList(getDb(), 'DEPOSIT', ctx.query), { auth: true, admin: true });
route('GET', '/admin/broker/withdrawals', (ctx) => adminBrokerList(getDb(), 'WITHDRAWAL', ctx.query), { auth: true, admin: true });

route(
  'GET',
  '/admin/broker/stats',
  (ctx) => {
    const db = getDb();
    requireAdmin(ctx);
    const countByStatus = (direction: 'DEPOSIT' | 'WITHDRAWAL') => {
      const out: Record<string, number> = {};
      for (const t of db.brokerTx.filter((row) => row.direction === direction)) out[t.status] = (out[t.status] ?? 0) + 1;
      return out;
    };
    const completedRows = db.brokerTx.filter((t) => t.status === 'COMPLETED');
    return {
      deposits: countByStatus('DEPOSIT'),
      withdrawals: countByStatus('WITHDRAWAL'),
      completed: { count: completedRows.length, amount: completedRows.reduce((sum, t) => sum + t.amount, 0) },
      gateways: brokerConfig(db).gateways,
      currency: 'USD',
    };
  },
  { auth: true, admin: true },
);

route(
  'GET',
  '/admin/broker/transactions/:id',
  (ctx) => {
    const db = getDb();
    requireAdmin(ctx);
    const row = db.brokerTx.find((t) => t.id === ctx.params.id);
    if (!row) throw err(404, 'Transaction not found');
    return {
      ...adminBrokerView(db, row),
      destination: row.destination,
      destinationType: row.destinationType,
      evidence: row.evidence,
      evidenceType: row.evidence ? 'NOTE' : null,
      processedAt: row.processedAt,
      audit: db.brokerAudit.filter((a) => a.transaction?.reference === row.reference),
    };
  },
  { auth: true, admin: true },
);

const BROKER_ACTIONS: Record<string, BrokerTxRow['status']> = {
  review: 'UNDER_REVIEW',
  approve: 'APPROVED',
  start_processing: 'PROCESSING',
  complete: 'COMPLETED',
  reject: 'REJECTED',
  fail: 'FAILED',
};

route(
  'PATCH',
  '/admin/broker/transactions/:id',
  (ctx) => {
    const db = getDb();
    const admin = requireAdmin(ctx);
    const row = db.brokerTx.find((t) => t.id === ctx.params.id);
    if (!row) throw err(404, 'Transaction not found');
    const action = String(ctx.body.action ?? '');
    const next = BROKER_ACTIONS[action];
    if (!next) issues('Unknown action');
    const previous = row.status;
    row.status = next;
    row.updatedAt = nowIso();
    if (next === 'COMPLETED') {
      row.completedAt = nowIso();
      row.processedAt = nowIso();
    }
    if (typeof ctx.body.adminNote === 'string') row.adminNote = ctx.body.adminNote;
    if (typeof ctx.body.internalNote === 'string') row.internalNote = ctx.body.internalNote;
    if (typeof ctx.body.providerRef === 'string') row.providerRef = ctx.body.providerRef || null;
    if (typeof ctx.body.evidence === 'string') row.evidence = ctx.body.evidence || null;
    if (typeof ctx.body.failureReason === 'string') row.failureReason = ctx.body.failureReason || null;
    row.timeline.push({
      id: id('tl'),
      action: action.toUpperCase(),
      fromStatus: previous,
      toStatus: next,
      source: 'ADMIN',
      note: row.adminNote ?? row.internalNote ?? null,
      at: nowIso(),
    });
    audit(db, {
      action: `STATUS_${action.toUpperCase()}`,
      transactionId: row.id,
      broker: row.broker,
      fromStatus: previous,
      toStatus: next,
      source: 'ADMIN',
      note: row.adminNote ?? row.internalNote ?? null,
      actor: admin,
      snapshot: row,
    });
    saveDb();
    return adminBrokerView(db, row);
  },
  { auth: true, admin: true },
);

route(
  'POST',
  '/admin/broker/transactions/:id/notes',
  (ctx) => {
    const db = getDb();
    const admin = requireAdmin(ctx);
    const row = db.brokerTx.find((t) => t.id === ctx.params.id);
    if (!row) throw err(404, 'Transaction not found');
    const note = String(ctx.body.note ?? '').trim();
    if (!note) issues('Note is required');
    row.internalNote = note;
    row.updatedAt = nowIso();
    row.timeline.push({ id: id('tl'), action: 'NOTE_ADDED', fromStatus: row.status, toStatus: row.status, source: 'ADMIN', note, at: nowIso() });
    audit(db, { action: 'NOTE_ADDED', transactionId: row.id, broker: row.broker, source: 'ADMIN', note, actor: admin, snapshot: row });
    saveDb();
    return adminBrokerView(db, row);
  },
  { auth: true, admin: true },
);

route(
  'GET',
  '/admin/broker/audit',
  (ctx) => {
    const db = getDb();
    requireAdmin(ctx);
    let rows = db.brokerAudit.slice();
    if (typeof ctx.query.action === 'string' && ctx.query.action) rows = rows.filter((a) => a.action === ctx.query.action);
    if (typeof ctx.query.source === 'string' && ctx.query.source) rows = rows.filter((a) => a.source === ctx.query.source);
    if (typeof ctx.query.transactionId === 'string' && ctx.query.transactionId) {
      const tx = db.brokerTx.find((t) => t.id === ctx.query.transactionId);
      rows = rows.filter((a) => a.transaction?.reference === tx?.reference);
    }
    if (typeof ctx.query.broker === 'string' && ctx.query.broker) rows = rows.filter((a) => a.transaction?.broker === ctx.query.broker);
    if (typeof ctx.query.from === 'string' && ctx.query.from) {
      const from = ctx.query.from;
      rows = rows.filter((a) => a.at >= from);
    }
    if (typeof ctx.query.to === 'string' && ctx.query.to) rows = rows.filter((a) => a.at.slice(0, 10) <= String(ctx.query.to));
    return rows.sort((a, b) => b.at.localeCompare(a.at));
  },
  { auth: true, admin: true },
);

route(
  'GET',
  '/admin/broker/balances',
  (ctx) => {
    const db = getDb();
    requireAdmin(ctx);
    let rows = db.brokerBalances.slice();
    if (typeof ctx.query.broker === 'string' && ctx.query.broker) rows = rows.filter((b) => b.broker === ctx.query.broker);
    return rows.map((b) => {
      const owner = db.users.find((u) => u.id === b.userId);
      return { ...b, user: owner ? { id: owner.id, name: owner.name, email: owner.email } : undefined };
    });
  },
  { auth: true, admin: true },
);

route(
  'POST',
  '/admin/broker/balances',
  (ctx) => {
    const db = getDb();
    requireAdmin(ctx);
    const userId = String(ctx.body.userId ?? '');
    const broker = String(ctx.body.broker ?? '') as BrokerId;
    const balance = Number(ctx.body.balance ?? 0);
    const user = db.users.find((u) => u.id === userId);
    if (!user) issues('User not found');
    if (broker !== 'DERIV' && broker !== 'WELTRADE') issues('Choose a broker');
    if (!Number.isFinite(balance) || balance < 0) issues('Enter a valid balance');
    let row = db.brokerBalances.find((b) => b.userId === userId && b.broker === broker);
    if (!row) {
      row = {
        id: id('bb'),
        userId,
        broker,
        currency: 'USD',
        balance,
        source: String(ctx.body.source ?? 'MANUAL'),
        reference: (ctx.body.reference as string | undefined) ?? null,
        verifiedAt: nowIso(),
        updatedAt: nowIso(),
      };
      db.brokerBalances.push(row);
    } else {
      row.balance = balance;
      row.source = String(ctx.body.source ?? row.source);
      row.reference = (ctx.body.reference as string | undefined) ?? row.reference;
      row.verifiedAt = nowIso();
      row.updatedAt = nowIso();
    }
    saveDb();
    return { ok: true };
  },
  { auth: true, admin: true },
);

route(
  'GET',
  '/admin/broker/settings',
  (ctx) => {
    requireAdmin(ctx);
    return settingsView(getDb());
  },
  { auth: true, admin: true },
);

route(
  'PUT',
  '/admin/broker/settings',
  (ctx) => {
    const db = getDb();
    requireAdmin(ctx);
    const next: BrokerSettings = JSON.parse(JSON.stringify(db.brokerSettings ?? DEFAULT_BROKER_SETTINGS));
    const apply = (group: 'deposit' | 'withdrawal', key: 'min' | 'max' | 'dailyMax') => {
      const section = ctx.body[group] as Record<string, unknown> | undefined;
      const value = section?.[key];
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        (next[group] as unknown as Record<string, number>)[key] = value;
      }
    };
    apply('deposit', 'min');
    apply('deposit', 'max');
    apply('withdrawal', 'min');
    apply('withdrawal', 'max');
    apply('withdrawal', 'dailyMax');
    if (typeof ctx.body.pendingLimit === 'number') next.pendingLimit = Math.min(50, Math.max(1, Math.round(ctx.body.pendingLimit)));
    if (typeof ctx.body.feePct === 'number') next.feePct = Math.min(100, Math.max(0, ctx.body.feePct));
    if (next.deposit.min >= next.deposit.max) issues('Deposit minimum must be less than the maximum');
    if (next.withdrawal.min >= next.withdrawal.max) issues('Withdrawal minimum must be less than the maximum');
    if (next.withdrawal.max > next.withdrawal.dailyMax) issues('Withdrawal maximum must not exceed the daily limit');
    db.brokerSettings = next;
    saveDb();
    return settingsView(db);
  },
  { auth: true, admin: true },
);


const CLIENT_ID_RE = /^[A-Za-z0-9._-]{3,64}$/;

function sanitizeRegisterUrl(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function pushNotification(db: ReturnType<typeof getDb>, userId: string, title: string, body: string, link = '/home') {
  db.notifications.unshift({ id: id('n'), userId, title, body, type: 'PAYMENT', read: false, link, createdAt: nowIso() });
}

function accountView(row: BrokerAccountRow) {
  return {
    id: row.id,
    broker: row.broker,
    clientId: row.clientId,
    status: row.status,
    rejectReason: row.rejectReason,
    submittedAt: row.createdAt,
    reviewedAt: row.reviewedAt,
    updatedAt: row.updatedAt,
  };
}

function adminAccountView(db: ReturnType<typeof getDb>, row: BrokerAccountRow) {
  const owner = db.users.find((u) => u.id === row.userId);
  return {
    ...accountView(row),
    user: owner
      ? { id: owner.id, name: owner.name, email: owner.email, phone: owner.phone, membership: owner.membership }
      : { id: 'unknown', name: 'Unknown', email: '', phone: null, membership: 'FREE' as Membership },
    events: db.brokerAccountEvents
      .filter((e) => e.accountId === row.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(({ accountId: _a, ...rest }) => {
        void _a;
        return rest;
      }),
  };
}

function recordAccountEvent(
  db: ReturnType<typeof getDb>,
  accountId: string,
  input: {
    action: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    reason?: string | null;
    actor?: UserRow | null;
  },
) {
  db.brokerAccountEvents.unshift({
    id: id('bev'),
    accountId,
    action: input.action,
    fromStatus: input.fromStatus ?? null,
    toStatus: input.toStatus ?? null,
    reason: input.reason ?? null,
    actorName: input.actor?.name ?? null,
    actorRole: input.actor?.role ?? null,
    createdAt: nowIso(),
  });
}

route(
  'GET',
  '/weltrade-account',
  (ctx) => {
    const db = getDb();
    const u = requireUser(ctx);
    const account = db.brokerAccounts.find((a) => a.userId === u.id && a.broker === 'WELTRADE') ?? null;
    return {
      broker: 'WELTRADE',
      registerUrl: sanitizeRegisterUrl(db.weltradeRegisterUrl),
      account: account ? accountView(account) : null,
    };
  },
  { auth: true },
);

route(
  'POST',
  '/weltrade-account',
  (ctx) => {
    const db = getDb();
    const u = requireUser(ctx);
    const clientId = String(ctx.body.clientId ?? '').trim();
    if (!CLIENT_ID_RE.test(clientId)) issues('Client ID must be 3-64 letters, numbers, dots, dashes or underscores');

    let row = db.brokerAccounts.find((a) => a.userId === u.id && a.broker === 'WELTRADE');
    if (row?.status === 'VERIFIED') throw err(409, 'This Weltrade account is already verified. Contact support to change it.');

    let created = false;
    if (row) {
      const previous = row.status;
      const wasRejected = previous === 'REJECTED';
      row.clientId = clientId;
      if (wasRejected) {
        row.status = 'PENDING';
        row.rejectReason = null;
      }
      row.reviewedAt = null;
      row.updatedAt = nowIso();
      recordAccountEvent(db, row.id, {
        action: wasRejected ? 'RESUBMITTED' : 'UPDATED',
        fromStatus: previous,
        toStatus: row.status,
        reason: `Client ID set to ${clientId}`,
        actor: u,
      });
    } else {
      created = true;
      row = {
        id: id('bac'),
        userId: u.id,
        broker: 'WELTRADE',
        clientId,
        status: 'PENDING',
        rejectReason: null,
        reviewedAt: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      db.brokerAccounts.unshift(row);
      recordAccountEvent(db, row.id, {
        action: 'SUBMITTED',
        fromStatus: null,
        toStatus: 'PENDING',
        reason: `Client ID set to ${clientId}`,
        actor: u,
      });
    }

    for (const admin of db.users.filter((usr) => usr.role === 'ADMIN' && usr.id !== u.id)) {
      pushNotification(
        db,
        admin.id,
        'Weltrade account submitted',
        `${u.name} submitted Weltrade Client ID ${clientId} for verification.`,
        '/admin',
      );
    }
    saveDb();

    return {
      status: created ? 201 : 200,
      data: {
        account: accountView(row),
        registerUrl: sanitizeRegisterUrl(db.weltradeRegisterUrl),
        message: created
          ? 'Client ID submitted â€” pending administrator verification.'
          : 'Client ID updated â€” pending administrator verification.',
      },
    };
  },
  { auth: true },
);

route(
  'GET',
  '/admin/weltrade-accounts/config',
  (ctx) => {
    requireAdmin(ctx);
    return { registerUrl: sanitizeRegisterUrl(getDb().weltradeRegisterUrl) };
  },
  { auth: true, admin: true },
);

route(
  'PUT',
  '/admin/weltrade-accounts/config',
  (ctx) => {
    const db = getDb();
    requireAdmin(ctx);
    const next = String(ctx.body.registerUrl ?? '').trim();
    if (next.length > 300) issues('Registration URL is too long');
    const clean = next ? sanitizeRegisterUrl(next) : null;
    if (next && !clean) throw err(400, 'Enter a valid http(s) URL, or clear the field to remove it');
    db.weltradeRegisterUrl = clean;
    saveDb();
    return { registerUrl: clean };
  },
  { auth: true, admin: true },
);

route(
  'GET',
  '/admin/weltrade-accounts',
  (ctx) => {
    const db = getDb();
    requireAdmin(ctx);
    let rows = db.brokerAccounts.filter((a) => a.broker === 'WELTRADE');
    if (typeof ctx.query.status === 'string' && ctx.query.status) rows = rows.filter((a) => a.status === ctx.query.status);
    if (typeof ctx.query.q === 'string' && ctx.query.q) {
      const q = ctx.query.q.toLowerCase();
      rows = rows.filter((a) => {
        const owner = db.users.find((u) => u.id === a.userId);
        return (
          a.clientId.toLowerCase().includes(q) ||
          (owner?.name ?? '').toLowerCase().includes(q) ||
          (owner?.email ?? '').toLowerCase().includes(q)
        );
      });
    }
    const count = (status: BrokerAccountRow['status']) =>
      db.brokerAccounts.filter((a) => a.broker === 'WELTRADE' && a.status === status).length;
    return {
      accounts: rows
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((a) => adminAccountView(db, a)),
      pending: count('PENDING'),
      verified: count('VERIFIED'),
      rejected: count('REJECTED'),
      registerUrl: sanitizeRegisterUrl(db.weltradeRegisterUrl),
    };
  },
  { auth: true, admin: true },
);

route(
  'PATCH',
  '/admin/weltrade-accounts/:id',
  (ctx) => {
    const db = getDb();
    const admin = requireAdmin(ctx);
    const row = db.brokerAccounts.find((a) => a.id === ctx.params.id);
    if (!row) throw err(404, 'Account submission not found');
    const action = String(ctx.body.action ?? '');
    if (action !== 'verify' && action !== 'reject') issues('Unknown action');
    if (row.status === 'VERIFIED' && action !== 'verify') throw err(409, 'A verified account cannot be rejected');
    const reason = typeof ctx.body.reason === 'string' ? ctx.body.reason.trim() : '';
    if (action === 'reject' && reason.length < 3) throw err(400, 'A rejection reason is required');

    const from = row.status;
    row.status = action === 'verify' ? 'VERIFIED' : 'REJECTED';
    row.rejectReason = action === 'reject' ? reason : null;
    row.reviewedAt = nowIso();
    row.updatedAt = nowIso();
    recordAccountEvent(db, row.id, {
      action: action === 'verify' ? 'VERIFIED' : 'REJECTED',
      fromStatus: from,
      toStatus: row.status,
      reason: action === 'reject' ? reason : null,
      actor: admin,
    });
    pushNotification(
      db,
      row.userId,
      action === 'verify' ? 'Weltrade account verified' : 'Weltrade account rejected',
      action === 'verify'
        ? `Your Weltrade Client ID ${row.clientId} has been verified.`
        : `Your Weltrade Client ID ${row.clientId} was rejected: ${reason}`,
    );
    saveDb();
    return adminAccountView(db, row);
  },
  { auth: true, admin: true },
);


function match(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = path.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const p = patternParts[i];
    if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(pathParts[i]);
    else if (p !== pathParts[i]) return null;
  }
  return params;
}

export async function handle(
  method: string,
  path: string,
  query: Record<string, unknown>,
  body: Record<string, unknown>,
  authorization?: string,
): Promise<RouterResult> {
  try {
    await ensureDb();
    const cleanPath = path.replace(/\/+$/, '') || '/';
    const db = getDb();

    let user: UserRow | null = null;
    if (authorization?.startsWith('Bearer ')) {
      const payload = decodeToken(authorization.slice(7));
      user = payload ? db.users.find((u) => u.id === payload.sub) ?? null : null;
    }

    for (const r of routes) {
      if (r.method !== method) continue;
      const params = match(r.pattern, cleanPath);
      if (!params) continue;
      if ((r.auth || r.admin) && !user) throw err(401, 'Authentication required');
      if (r.admin && user && user.role !== 'ADMIN') throw err(403, 'Administrator access required');
      const ctx: Ctx = { params, query, body, user };
      const result = await r.handler(ctx);
      if (result && typeof result === 'object' && 'status' in result && 'data' in result) {
        return result as RouterResult;
      }
      return { status: 200, data: result };
    }
    throw err(404, 'Not found');
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, data: e.payload };
    return { status: 500, data: { error: e instanceof Error ? e.message : 'Server error' } };
  }
}
