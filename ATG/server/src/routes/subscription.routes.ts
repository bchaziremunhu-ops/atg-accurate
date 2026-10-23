import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../lib/http.js';
import { HttpError } from '../middleware/error.js';
import { getSubscriptionPlans, resolvePlan } from '../services/payments/plans.js';

export const subscriptionRouter = Router();

subscriptionRouter.use(requireAuth);

subscriptionRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const sub = await prisma.subscription.findUnique({ where: { userId: req.user!.id } });
    const roomAccess = await prisma.membershipRoomAccess.findMany({
      where: { userId: req.user!.id },
      orderBy: { startsAt: 'desc' },
    });
    const now = Date.now();
    if (!sub) return res.json({ plan: null, status: 'NONE', expiresAt: null, daysLeft: null, expired: false, roomAccess });
    const expired = sub.expiresAt.getTime() < now;
    res.json({
      ...sub,
      status: expired ? 'EXPIRED' : sub.status,
      daysLeft: Math.max(0, Math.ceil((sub.expiresAt.getTime() - now) / 86_400_000)),
      expired,
      roomAccess,
    });
  }),
);

/** Plans (prices/durations live in the database — Setting-backed). */
subscriptionRouter.get(
  '/plans',
  asyncHandler(async (_req, res) => {
    res.json(await getSubscriptionPlans());
  }),
);

subscriptionRouter.post(
  '/cancel',
  asyncHandler(async (req, res) => {
    const sub = await prisma.subscription.findUnique({ where: { userId: req.user!.id } });
    if (!sub) throw new HttpError(404, 'No active subscription');
    const updated = await prisma.subscription.update({
      where: { userId: req.user!.id },
      data: { autoRenew: false },
    });
    res.json(updated);
  }),
);

/**
 * Paid subscription renewals are unavailable until a payment provider is
 * configured.
 */
subscriptionRouter.post(
  '/renew',
  asyncHandler(async (req, res) => {
    const { planId } = z.object({ planId: z.string().optional() }).parse(req.body ?? {});
    await resolvePlan(planId);

    throw new HttpError(503, 'Paid subscription checkout is currently unavailable.');
  }),
);
