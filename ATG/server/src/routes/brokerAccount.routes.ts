import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler, validate } from '../lib/http.js';
import { HttpError } from '../middleware/error.js';
import { notify } from '../services/notifications.service.js';
import { notifyFundingAdmins } from '../services/brokerFunding/index.js';

/**
 * Broker account registration (Weltrade) — customer + admin API.
 *
 * A member submits the client id their broker issued them. Nothing is granted
 * by submitting: `status` only ever moves to VERIFIED/REJECTED through an
 * administrator action (or, in a future integration, a signed provider
 * callback). Every state change is appended to `BrokerAccountEvent`.
 *
 * The customer router only ever reads and writes the caller's own row — there
 * is no path to another member's record. The admin router is role-guarded by
 * middleware, not by hiding buttons in the UI.
 */

export const brokerAccountRouter = Router();
brokerAccountRouter.use(requireAuth);

export const brokerAccountAdminRouter = Router();
brokerAccountAdminRouter.use(requireAuth, requireRole('ADMIN'));

const BROKER = 'WELTRADE';
const REGISTER_URL_KEY = 'weltradeRegisterUrl';

/**
 * The official sign-up link. `WELTRADE_REGISTER_URL` is the deploy-time default;
 * an administrator can override it at runtime (Setting table) without a
 * redeploy. Deliberately returns `null` when unset or malformed — the app never
 * substitutes a guessed or referral URL.
 */
function sanitizeUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

async function registerUrl(): Promise<string | null> {
  const stored = await prisma.setting.findUnique({ where: { key: REGISTER_URL_KEY } });
  return sanitizeUrl(stored?.value) ?? sanitizeUrl(env.weltradeRegisterUrl);
}

const submitSchema = z.object({
  clientId: z
    .string({ required_error: 'Client ID is required' })
    .trim()
    .min(3, 'Client ID must be at least 3 characters')
    .max(64, 'Client ID must be at most 64 characters')
    .regex(/^[A-Za-z0-9._-]+$/, 'Client ID may only contain letters, numbers, dots, dashes and underscores'),
});

const reviewSchema = z.object({
  action: z.enum(['verify', 'reject']),
  reason: z.string().trim().max(500).optional(),
});

type AccountRow = {
  id: string;
  userId: string;
  broker: string;
  clientId: string;
  status: string;
  rejectReason: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toCustomerView(a: AccountRow) {
  return {
    id: a.id,
    broker: a.broker,
    clientId: a.clientId,
    status: a.status, // PENDING | VERIFIED | REJECTED
    rejectReason: a.rejectReason,
    submittedAt: a.createdAt,
    reviewedAt: a.reviewedAt,
    updatedAt: a.updatedAt,
  };
}

function event(action: string, data: {
  fromStatus?: string | null;
  toStatus?: string | null;
  reason?: string | null;
  actorId?: string | null;
  actorRole?: string | null;
  actorName?: string | null;
}) {
  return { action, ...data };
}

// ---------------------------------------------------------------------------
// Customer
// ---------------------------------------------------------------------------

brokerAccountRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const account = await prisma.brokerAccount.findUnique({
      where: { userId_broker: { userId: req.user!.id, broker: BROKER } },
    });
    res.json({
      broker: BROKER,
      registerUrl: await registerUrl(),
      account: account ? toCustomerView(account) : null,
    });
  }),
);

brokerAccountRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { clientId } = validate(submitSchema, req.body);
    const userId = req.user!.id;
    const where = { userId_broker: { userId, broker: BROKER } };
    const existing = await prisma.brokerAccount.findUnique({ where });

    if (existing?.status === 'VERIFIED') {
      throw new HttpError(409, 'This Weltrade account is already verified. Contact support to change it.', 'ALREADY_VERIFIED');
    }

    let created = false;
    const account = existing
      ? await prisma.brokerAccount.update({
          where: { id: existing.id },
          data: {
            clientId,
            // A rejected submission goes back into the queue; a pending one
            // keeps its status (an edit never skips review).
            ...(existing.status === 'REJECTED' ? { status: 'PENDING', rejectReason: null } : {}),
            reviewedAt: null,
            reviewedById: null,
            events: {
              create: event(existing.status === 'REJECTED' ? 'RESUBMITTED' : 'UPDATED', {
                fromStatus: existing.status,
                toStatus: existing.status === 'REJECTED' ? 'PENDING' : existing.status,
                reason: `Client ID set to ${clientId}`,
                actorId: userId,
                actorRole: req.user!.role,
                actorName: req.user!.name,
              }),
            },
          },
          include: { events: true },
        })
      : await (async () => {
          created = true;
          return prisma.brokerAccount.create({
            data: {
              userId,
              broker: BROKER,
              clientId,
              status: 'PENDING',
              events: {
                create: event('SUBMITTED', {
                  fromStatus: null,
                  toStatus: 'PENDING',
                  reason: `Client ID set to ${clientId}`,
                  actorId: userId,
                  actorRole: req.user!.role,
                  actorName: req.user!.name,
                }),
              },
            },
            include: { events: true },
          });
        })();

    await notifyFundingAdmins({
      title: 'Weltrade account submitted',
      body: `${req.user!.name} submitted Weltrade Client ID ${clientId} for verification.`,
      link: '/admin',
    });

    res.status(created ? 201 : 200).json({
      account: toCustomerView(account),
      registerUrl: await registerUrl(),
      message: created
        ? 'Client ID submitted — pending administrator verification.'
        : 'Client ID updated — pending administrator verification.',
    });
  }),
);

// ---------------------------------------------------------------------------
// Admin — list, search/filter, verify / reject
// ---------------------------------------------------------------------------

const listSchema = z.object({
  status: z.enum(['PENDING', 'VERIFIED', 'REJECTED']).optional(),
  q: z.string().trim().max(120).optional(),
});

brokerAccountAdminRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { status, q } = validate(listSchema, req.query);

    const rows = await prisma.brokerAccount.findMany({
      where: {
        broker: BROKER,
        ...(status ? { status } : {}),
        ...(q
          ? {
              OR: [
                { clientId: { contains: q } },
                { user: { is: { name: { contains: q } } } },
                { user: { is: { email: { contains: q } } } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, membership: true } },
        events: { orderBy: { createdAt: 'desc' } },
      },
    });

    res.json({
      accounts: rows.map((r) => ({
        ...toCustomerView(r),
        user: r.user,
        events: r.events.map((e) => ({
          id: e.id,
          action: e.action,
          fromStatus: e.fromStatus,
          toStatus: e.toStatus,
          reason: e.reason,
          actorName: e.actorName,
          actorRole: e.actorRole,
          createdAt: e.createdAt,
        })),
      })),
      pending: await prisma.brokerAccount.count({ where: { broker: BROKER, status: 'PENDING' } }),
      verified: await prisma.brokerAccount.count({ where: { broker: BROKER, status: 'VERIFIED' } }),
      rejected: await prisma.brokerAccount.count({ where: { broker: BROKER, status: 'REJECTED' } }),
      registerUrl: await registerUrl(),
    });
  }),
);

const configSchema = z.object({
  registerUrl: z.string().trim().max(300).optional(),
});

brokerAccountAdminRouter.get(
  '/config',
  asyncHandler(async (_req, res) => {
    res.json({ registerUrl: await registerUrl() });
  }),
);

brokerAccountAdminRouter.put(
  '/config',
  asyncHandler(async (req, res) => {
    const { registerUrl: next } = validate(configSchema, req.body);
    if (next === undefined) throw new HttpError(400, 'registerUrl is required', 'BAD_REQUEST');
    if (next === '') {
      await prisma.setting.deleteMany({ where: { key: REGISTER_URL_KEY } });
      res.json({ registerUrl: await registerUrl() });
      return;
    }
    const clean = sanitizeUrl(next);
    if (!clean) {
      throw new HttpError(400, 'Enter a valid http(s) URL, or clear the field to remove it', 'INVALID_URL');
    }
    await prisma.setting.upsert({
      where: { key: REGISTER_URL_KEY },
      create: { key: REGISTER_URL_KEY, value: clean, updatedById: req.user!.id },
      update: { value: clean, updatedById: req.user!.id },
    });
    res.json({ registerUrl: await registerUrl() });
  }),
);

brokerAccountAdminRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { action, reason } = validate(reviewSchema, req.body);

    const existing = await prisma.brokerAccount.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, 'Account submission not found', 'NOT_FOUND');
    if (existing.status === 'VERIFIED' && action !== 'verify') {
      throw new HttpError(409, 'A verified account cannot be rejected', 'ALREADY_VERIFIED');
    }
    if (action === 'reject' && (!reason || reason.trim().length < 3)) {
      throw new HttpError(400, 'A rejection reason is required', 'REASON_REQUIRED');
    }

    const toStatus = action === 'verify' ? 'VERIFIED' : 'REJECTED';
    const account = await prisma.brokerAccount.update({
      where: { id: existing.id },
      data: {
        status: toStatus,
        rejectReason: action === 'reject' ? reason!.trim() : null,
        reviewedById: req.user!.id,
        reviewedAt: new Date(),
        events: {
          create: event(action === 'verify' ? 'VERIFIED' : 'REJECTED', {
            fromStatus: existing.status,
            toStatus,
            reason: action === 'reject' ? reason!.trim() : null,
            actorId: req.user!.id,
            actorRole: req.user!.role,
            actorName: req.user!.name,
          }),
        },
      },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, membership: true } },
        events: { orderBy: { createdAt: 'desc' } },
      },
    });

    await notify({
      userId: account.userId,
      title: action === 'verify' ? 'Weltrade account verified' : 'Weltrade account rejected',
      body:
        action === 'verify'
          ? `Your Weltrade Client ID ${account.clientId} has been verified.`
          : `Your Weltrade Client ID ${account.clientId} was rejected: ${reason!.trim()}`,
      type: 'PAYMENT',
      link: '/home',
    });

    res.json({
      ...toCustomerView(account),
      user: account.user,
      events: account.events.map((e) => ({
        id: e.id,
        action: e.action,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        reason: e.reason,
        actorName: e.actorName,
        actorRole: e.actorRole,
        createdAt: e.createdAt,
      })),
    });
  }),
);
