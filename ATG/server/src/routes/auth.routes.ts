import { Router, type Request } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { signAccessToken, verifyRefreshToken } from '../lib/jwt.js';
import { issueSession, revokeSession, rotateSession } from '../lib/sessions.js';
import { HttpError } from '../middleware/error.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, validate } from '../lib/http.js';
import { notify } from '../services/notifications.service.js';
import { effectiveMembership } from '../lib/permissions.js';
import { normalizePhone, type NormalizedPhone } from '../lib/phone.js';
import { isValidQuestionId, questionById, SECURITY_QUESTIONS } from '../lib/securityQuestions.js';
import { delayFailure, hashAnswer, verifyAnswer } from '../lib/securityAnswers.js';
import {
  recordSecurityEvent,
  requestActor,
  type SecurityEventType,
} from '../lib/securityEvents.js';
import {
  clearRecoveryFailures,
  isRecoveryLocked,
  recoveryLockRemainingMs,
  recordRecoveryFailure,
} from '../lib/recovery.js';

export const authRouter = Router();

const registerSchema = z.object({
  name: z.string().min(2, 'Enter your full legal name').max(120),
  phone: z.string().min(6, 'Enter a valid phone number').max(25),
  country: z.string().min(2, 'Select your country of residence').max(60),
  nationality: z.string().min(2, 'Select your nationality').max(60),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be in YYYY-MM-DD format'),
  address: z.string().max(200).optional().or(z.literal('')),
  securityQuestion: z.string().refine(isValidQuestionId, 'Choose a security question'),
  securityAnswer: z.string().min(2, 'Security answer must be at least 2 characters').max(100),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  confirmPassword: z.string().min(1, 'Confirm your password'),
  acceptTerms: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the Terms & Conditions' }),
  }),
  acceptPrivacy: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the Privacy Policy' }),
  }),
  email: z.string().email().optional().or(z.literal('')),
});

const loginSchema = z
  .object({
    identifier: z.string().min(1).optional(),
    email: z.string().min(1).optional(),
    phone: z.string().min(1).optional(),
    password: z.string().min(1),
  })
  .refine((d) => d.identifier || d.email || d.phone, {
    message: 'Enter your phone number or email',
  });

const phoneStepSchema = z.object({ phone: z.string().min(4).max(25) });

const identitySchema = phoneStepSchema.extend({
  fullName: z.string().min(2, 'Enter your full legal name').max(120),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be in YYYY-MM-DD format'),
});

const resetSchema = identitySchema.extend({
  answer: z.string().min(1, 'Enter your security answer').max(100),
  newPassword: z.string().min(8, 'Password must be at least 8 characters').max(128),
  confirmPassword: z.string().min(1, 'Confirm your password'),
});

const digits = (value: string) => value.replace(/\D/g, '');

const RECOVERY_GENERIC =
  "We couldn't verify those details. Check the phone number, full legal name and date of birth, then try again.";

const LOCKED_MESSAGE = (minutes: number) =>
  `Too many attempts. Account recovery is temporarily locked — try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`;

function normalizeName(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function parseDob(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  const now = new Date();
  if (date.getTime() > Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) {
    return null;
  }
  if (y < 1900) return null;
  return date;
}

function dobMatches(stored: Date | null, submitted: string): boolean {
  if (!stored) return false;
  const parsed = parseDob(submitted);
  if (!parsed) return false;
  return (
    stored.getUTCFullYear() === parsed.getUTCFullYear() &&
    stored.getUTCMonth() === parsed.getUTCMonth() &&
    stored.getUTCDate() === parsed.getUTCDate()
  );
}

async function findUserByPhone(normalized: NormalizedPhone) {
  return prisma.user.findFirst({
    where: { OR: [{ phoneE164: normalized.e164 }, { phone: normalized.digits }] },
  });
}

function resolvePhone(raw: string, countryHint?: string | null): NormalizedPhone {
  const normalized = normalizePhone(raw, countryHint);
  if (!normalized) {
    throw new HttpError(400, 'Enter a valid phone number including the international country code');
  }
  return normalized;
}

function audit(
  req: Request,
  type: SecurityEventType,
  extra: { userId?: string | null; phoneE164?: string | null; meta?: Record<string, unknown> },
) {
  const { ip, userAgent } = requestActor(req);
  return recordSecurityEvent({ type, ip, userAgent, ...extra });
}

function publicUser(u: {
  id: string;
  name: string;
  email: string;
  role: string;
  membership?: string;
  isVip: boolean;
  avatarUrl: string | null;
  vipExpiresAt: Date | null;
  phone?: string | null;
  phoneE164?: string | null;
  country?: string | null;
  nationality?: string | null;
  bio?: string | null;
}) {
  const membership = effectiveMembership({
    membership: u.membership,
    isVip: u.isVip,
    vipExpiresAt: u.vipExpiresAt,
  });
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    membership,
    isVip: membership === 'VIP_DERIV' || membership === 'VIP_WELTRADE',
    avatarUrl: u.avatarUrl,
    vipExpiresAt: u.vipExpiresAt,
    phone: u.phone,
    phoneE164: u.phoneE164,
    country: u.country,
    nationality: u.nationality,
    bio: u.bio,
  };
}

authRouter.get('/security-questions', (_req, res) => {
  res.json({ questions: SECURITY_QUESTIONS });
});

authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const data = validate(registerSchema, req.body);
    const normalized = resolvePhone(data.phone, data.country);
    const dob = parseDob(data.dateOfBirth);
    if (!dob) throw new HttpError(400, 'Enter a valid date of birth');

    const email = (data.email || `${normalized.digits}@atg.app`).toLowerCase();

    const clash = await prisma.user.findFirst({
      where: {
        OR: [
          { phoneE164: normalized.e164 },
          { phone: normalized.digits },
          ...(data.email ? [{ email }] : []),
        ],
      },
      select: { id: true, phoneE164: true, phone: true, email: true },
    });
    if (clash) {
      if (clash.phoneE164 === normalized.e164 || clash.phone === normalized.digits) {
        throw new HttpError(409, 'An account with that phone number already exists');
      }
      throw new HttpError(409, 'An account with that email already exists');
    }

    const passwordHash = await bcrypt.hash(data.password, 12);
    const answerHash = await hashAnswer(data.securityAnswer);
    const acceptedAt = new Date();

    let user;
    try {
      user = await prisma.user.create({
        data: {
          name: data.name.trim(),
          email,
          phone: normalized.digits,
          phoneE164: normalized.e164,
          country: data.country.trim(),
          nationality: data.nationality.trim(),
          dateOfBirth: dob,
          address: data.address?.trim() || null,
          securityQuestion: data.securityQuestion,
          securityAnswerHash: answerHash,
          termsAcceptedAt: acceptedAt,
          privacyAcceptedAt: acceptedAt,
          passwordHash,
          wallet: { create: { balance: 0 } },
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        throw new HttpError(409, 'An account with that phone number already exists');
      }
      throw e;
    }

    await audit(req, 'REGISTER', {
      userId: user.id,
      phoneE164: normalized.e164,
      meta: { country: data.country, nationality: data.nationality },
    });

    await notify({
      userId: user.id,
      title: 'Welcome to ATG Traders 🎉',
      body: 'Your account is ready. Explore free signals and courses to get started.',
      type: 'SYSTEM',
      link: '/home',
    });

    const payload = { sub: user.id, role: user.role, isVip: user.isVip };
    res.status(201).json({
      user: publicUser(user),
      accessToken: signAccessToken(payload),
      refreshToken: await issueSession(payload),
    });
  }),
);

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const data = validate(loginSchema, req.body);
    const raw = (data.identifier ?? data.email ?? data.phone ?? '').trim();
    const isEmail = raw.includes('@');

    let user = null;
    if (isEmail) {
      user = await prisma.user.findUnique({ where: { email: raw.toLowerCase() } });
    } else {
      const normalized = normalizePhone(raw);
      if (normalized) {
        user = await findUserByPhone(normalized);
      }
      if (!user) {
        const d = digits(raw);
        if (d) user = await prisma.user.findFirst({ where: { OR: [{ phone: d }, { phoneE164: `+${d}` }] } });
      }
    }

    const invalidMessage = isEmail ? 'Invalid email or password' : 'Invalid phone number or password';
    const auditLoginFailure = () =>
      audit(req, 'LOGIN_FAILED', {
        userId: user?.id ?? null,
        phoneE164: user?.phoneE164 ?? null,
        meta: { identifier: isEmail ? 'email' : 'phone' },
      });

    if (!user) {
      await auditLoginFailure();
      throw new HttpError(401, invalidMessage);
    }
    const ok = await bcrypt.compare(data.password, user.passwordHash);
    if (!ok) {
      await auditLoginFailure();
      throw new HttpError(401, invalidMessage);
    }

    await audit(req, 'LOGIN_SUCCESS', { userId: user.id, phoneE164: user.phoneE164 });

    const payload = { sub: user.id, role: user.role, isVip: user.isVip };
    res.json({
      user: publicUser(user),
      accessToken: signAccessToken(payload),
      refreshToken: await issueSession(payload),
    });
  }),
);


authRouter.post(
  '/forgot/start',
  asyncHandler(async (req, res) => {
    validate(phoneStepSchema, req.body);
    const normalized = normalizePhone(String(req.body.phone ?? ''));
    await audit(req, 'RECOVERY_STARTED', { phoneE164: normalized?.e164 ?? null });
    res.json({ ok: true });
  }),
);

authRouter.post(
  '/forgot/verify',
  asyncHandler(async (req, res) => {
    const data = validate(identitySchema, req.body);
    const normalized = normalizePhone(data.phone);
    const user = normalized ? await findUserByPhone(normalized) : null;

    if (!user) {
      await delayFailure();
      throw new HttpError(400, RECOVERY_GENERIC);
    }

    if (isRecoveryLocked(user)) {
      const minutes = Math.max(1, Math.ceil(recoveryLockRemainingMs(user) / 60_000));
      await audit(req, 'RECOVERY_LOCKED', { userId: user.id, phoneE164: user.phoneE164 });
      throw new HttpError(429, LOCKED_MESSAGE(minutes));
    }

    const nameOk = normalizeName(user.name) === normalizeName(data.fullName);
    const dobOk = dobMatches(user.dateOfBirth, data.dateOfBirth);

    if (!nameOk || !dobOk || !user.securityQuestion) {
      const { locked } = await recordRecoveryFailure(user.id);
      await audit(req, 'RECOVERY_IDENTITY_FAILED', {
        userId: user.id,
        phoneE164: user.phoneE164,
        meta: { locked },
      });
      await delayFailure();
      if (locked) throw new HttpError(429, LOCKED_MESSAGE(15));
      throw new HttpError(400, RECOVERY_GENERIC);
    }

    const question = questionById(user.securityQuestion);
    await audit(req, 'RECOVERY_QUESTION_ISSUED', { userId: user.id, phoneE164: user.phoneE164 });
    res.json({ question: question ?? { id: user.securityQuestion, text: 'Security question' } });
  }),
);

authRouter.post(
  '/forgot/reset',
  asyncHandler(async (req, res) => {
    const data = validate(resetSchema, req.body);
    if (data.newPassword !== data.confirmPassword) {
      throw new HttpError(400, 'Passwords do not match');
    }

    const normalized = normalizePhone(data.phone);
    const user = normalized ? await findUserByPhone(normalized) : null;

    if (!user) {
      await delayFailure();
      throw new HttpError(400, RECOVERY_GENERIC);
    }

    if (isRecoveryLocked(user)) {
      const minutes = Math.max(1, Math.ceil(recoveryLockRemainingMs(user) / 60_000));
      await audit(req, 'RECOVERY_LOCKED', { userId: user.id, phoneE164: user.phoneE164 });
      throw new HttpError(429, LOCKED_MESSAGE(minutes));
    }

    const nameOk = normalizeName(user.name) === normalizeName(data.fullName);
    const dobOk = dobMatches(user.dateOfBirth, data.dateOfBirth);
    if (!nameOk || !dobOk) {
      const { locked } = await recordRecoveryFailure(user.id);
      await audit(req, 'RECOVERY_IDENTITY_FAILED', {
        userId: user.id,
        phoneE164: user.phoneE164,
        meta: { step: 'reset', locked },
      });
      await delayFailure();
      if (locked) throw new HttpError(429, LOCKED_MESSAGE(15));
      throw new HttpError(400, RECOVERY_GENERIC);
    }

    const answerOk = await verifyAnswer(data.answer, user.securityAnswerHash);
    if (!answerOk) {
      const { locked } = await recordRecoveryFailure(user.id);
      await audit(req, 'RECOVERY_ANSWER_FAILED', {
        userId: user.id,
        phoneE164: user.phoneE164,
        meta: { locked },
      });
      await delayFailure();
      if (locked) throw new HttpError(429, LOCKED_MESSAGE(15));
      throw new HttpError(400, "That didn't match your account. Check your security answer and try again.");
    }

    const passwordHash = await bcrypt.hash(data.newPassword, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });
    await revokeSession(user.id);
    await clearRecoveryFailures(user.id);
    await audit(req, 'PASSWORD_RESET', { userId: user.id, phoneE164: user.phoneE164 });

    res.json({ ok: true, message: 'Your password has been updated. Sign in with your new password.' });
  }),
);

authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const { refreshToken } = z.object({ refreshToken: z.string().min(10) }).parse(req.body);

    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      throw new HttpError(401, 'Invalid refresh token');
    }

    const rotated = await rotateSession(refreshToken, payload);
    if (!rotated.ok) throw new HttpError(401, 'Refresh token revoked');

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new HttpError(401, 'Invalid refresh token');

    res.json({
      accessToken: signAccessToken({ sub: user.id, role: user.role, isVip: user.isVip }),
      refreshToken: rotated.token,
    });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: { wallet: true, subscription: true },
    });
    if (!user) throw new HttpError(404, 'User not found');
    res.json({ ...publicUser(user), wallet: user.wallet, subscription: user.subscription });
  }),
);

authRouter.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    await revokeSession(req.user!.id);
    res.json({ ok: true });
  }),
);
