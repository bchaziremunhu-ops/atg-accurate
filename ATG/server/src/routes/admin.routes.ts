import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler, validate } from '../lib/http.js';
import { HttpError } from '../middleware/error.js';
import { broadcastToAll, broadcastToAudience, notify } from '../services/notifications.service.js';
import { adminRefundAction, fulfilPurchase } from '../services/payments/index.js';
import { MEMBERSHIPS, type Membership } from '../lib/permissions.js';
import { env } from '../config/env.js';

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole('ADMIN'));

adminRouter.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const [
      users,
      signals,
      openSignals,
      courses,
      freeCourses,
      purchases,
      revenue,
      groups,
      posts,
      transactions,
      pendingTxns,
      pendingPurchases,
      pendingWithdrawals,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.signal.count(),
      prisma.signal.count({ where: { status: 'OPEN' } }),
      prisma.course.count(),
      prisma.course.count({ where: { price: { lte: 0 } } }),
      prisma.purchase.count({ where: { status: 'PAID' } }),
      prisma.purchase.aggregate({ where: { status: 'PAID' }, _sum: { amount: true } }),
      prisma.group.count(),
      prisma.groupPost.count(),
      prisma.transaction.count(),
      prisma.transaction.count({ where: { status: { in: ['PENDING', 'PROCESSING'] } } }),
      prisma.purchase.count({ where: { status: { in: ['PENDING', 'PROCESSING'] } } }),
      prisma.transaction.count({ where: { type: 'WITHDRAWAL', status: { in: ['PENDING', 'PROCESSING'] } } }),
    ]);

    const memberships = await prisma.user.groupBy({ by: ['membership'], _count: { _all: true } });

    const recentPurchases = await prisma.purchase.findMany({
      where: { status: 'PAID' },
      orderBy: { createdAt: 'desc' },
      take: 8,
      include: { user: { select: { name: true, email: true } } },
    });

    res.json({
      users,
      vips: memberships.filter((m) => m.membership.startsWith('VIP')).reduce((s, m) => s + m._count._all, 0),
      memberships: Object.fromEntries(memberships.map((m) => [m.membership, m._count._all])),
      signals,
      openSignals,
      courses,
      freeCourses,
      freeCourseLimit: env.maxFreeCourses,
      purchases,
      revenue: revenue._sum.amount ?? 0,
      groups,
      posts,
      transactions,
      pendingTxns,
      pendingPurchases,
      pendingWithdrawals,
      recentPurchases,
    });
  }),
);

adminRouter.get(
  '/users',
  asyncHandler(async (req, res) => {
    const q = req.query.q as string | undefined;
    const membership = req.query.membership as string | undefined;
    const users = await prisma.user.findMany({
      where: {
        ...(q ? { OR: [{ name: { contains: q } }, { email: { contains: q } }] } : {}),
        ...(membership ? { membership } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        membership: true,
        isVip: true,
        vipExpiresAt: true,
        createdAt: true,
        wallet: { select: { balance: true } },
        _count: { select: { purchases: true } },
      },
    });
    res.json(users);
  }),
);

const userUpdateSchema = z.object({
  role: z.enum(['USER', 'ADMIN']).optional(),
  membership: z.enum(MEMBERSHIPS as [Membership, ...Membership[]]).optional(),
  vipDays: z.number().int().min(1).max(3650).optional(),
});

adminRouter.patch(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const data = validate(userUpdateSchema, req.body);
    const update: Record<string, unknown> = {};
    if (data.role) update.role = data.role;

    let newMembership: Membership | undefined;
    if (data.membership) {
      newMembership = data.membership;
      const isVipTier = newMembership === 'VIP_DERIV' || newMembership === 'VIP_WELTRADE';
      update.membership = newMembership;
      update.isVip = isVipTier;
      update.vipExpiresAt = isVipTier ? new Date(Date.now() + (data.vipDays ?? 30) * 86_400_000) : null;
    }

    const user = await prisma.user.update({ where: { id: req.params.id }, data: update });

    if (newMembership) {
      const isVipTier = newMembership === 'VIP_DERIV' || newMembership === 'VIP_WELTRADE';
      if (isVipTier) {
        await prisma.subscription.upsert({
          where: { userId: user.id },
          update: { status: 'ACTIVE', expiresAt: user.vipExpiresAt ?? new Date(), plan: `VIP_${newMembership}` },
          create: {
            userId: user.id,
            plan: `VIP_${newMembership}`,
            status: 'ACTIVE',
            expiresAt: user.vipExpiresAt ?? new Date(),
            provider: 'admin',
          },
        });
      } else {
        await prisma.subscription
          .update({ where: { userId: user.id }, data: { status: 'CANCELLED' } })
          .catch(() => {});
      }
      const label: Record<Membership, string> = {
        FREE: 'Free',
        PAID: 'Paid course member',
        VIP_DERIV: 'Deriv VIP',
        VIP_WELTRADE: 'Weltrade VIP',
      };
      await notify({
        userId: user.id,
        title: `Membership updated: ${label[newMembership]}`,
        body: isVipTier
          ? `An administrator upgraded you to ${label[newMembership]}. Expires ${user.vipExpiresAt?.toDateString()}.`
          : `An administrator set your membership to ${label[newMembership]}.`,
        type: 'SUBSCRIPTION',
        link: '/profile',
      });
    }

    res.json({
      id: user.id,
      role: user.role,
      membership: user.membership,
      isVip: user.isVip,
      vipExpiresAt: user.vipExpiresAt,
    });
  }),
);

adminRouter.get(
  '/transactions',
  asyncHandler(async (req, res) => {
    const status = req.query.status as string | undefined;
    const type = req.query.type as string | undefined;
    const txns = await prisma.transaction.findMany({
      where: { ...(status ? { status } : {}), ...(type ? { type } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        user: { select: { name: true, email: true, membership: true } },
        statusHistory: { orderBy: { createdAt: 'asc' } },
      },
    });
    res.json(txns);
  }),
);

const txnActionSchema = z.object({
  action: z.enum(['approve', 'reject', 'processing', 'paid']),
  adminNote: z.string().trim().max(300).optional(),
  providerRef: z.string().trim().min(3).max(120).optional(),
});

adminRouter.patch(
  '/transactions/:id',
  asyncHandler(async (req, res) => {
    const { action, adminNote, providerRef } = validate(txnActionSchema, req.body);
    const updated = await prisma.$transaction(async (db) => {
      const txn = await db.transaction.findUnique({ where: { id: req.params.id } });
      if (!txn) throw new HttpError(404, 'Transaction not found');
      if (txn.status === 'COMPLETED' || txn.status === 'FAILED') {
        throw new HttpError(400, `Transaction already ${txn.status.toLowerCase()}`);
      }

      if (action === 'paid' && txn.type !== 'WITHDRAWAL') {
        throw new HttpError(400, 'Only a withdrawal can be marked paid');
      }
      if (action === 'paid' && txn.status !== 'PROCESSING') {
        throw new HttpError(409, 'Start payout processing before recording payment confirmation');
      }
      if (action === 'paid' && !providerRef) {
        throw new HttpError(400, 'Enter the verified payout reference before marking this withdrawal paid');
      }
      if (action === 'paid' && txn.method === 'USDT_TRC20' && !/^[a-fA-F0-9]{64}$/.test(providerRef ?? '')) {
        throw new HttpError(400, 'Enter the 64-character TRC20 transaction hash verified on-chain');
      }
      if (action === 'reject' && txn.type === 'WITHDRAWAL' && !adminNote) {
        throw new HttpError(400, 'A rejection reason is required');
      }

      const status =
        txn.type === 'WITHDRAWAL'
          ? action === 'reject'
            ? 'FAILED'
            : action === 'paid'
              ? 'COMPLETED'
              : 'PROCESSING'
          : action === 'approve'
            ? 'COMPLETED'
            : action === 'reject'
              ? 'FAILED'
              : 'PROCESSING';
      if (status === txn.status) throw new HttpError(409, `Transaction is already ${status.toLowerCase()}`);

      const changed = await db.transaction.updateMany({
        where: { id: txn.id, status: txn.status },
        data: {
          status,
          adminNote: adminNote ?? txn.adminNote,
          providerRef: providerRef ?? txn.providerRef,
          processedById: req.user!.id,
          processedAt: new Date(),
        },
      });
      if (changed.count !== 1) throw new HttpError(409, 'Transaction was updated by another administrator');

      if (action === 'approve' && txn.type === 'DEPOSIT') {
        await db.wallet.upsert({
          where: { userId: txn.userId },
          update: { balance: { increment: txn.amount } },
          create: { userId: txn.userId, balance: txn.amount },
        });
      }
      if (action === 'reject' && txn.type === 'WITHDRAWAL') {
        await db.wallet.upsert({
          where: { userId: txn.userId },
          update: { balance: { increment: txn.amount } },
          create: { userId: txn.userId, balance: txn.amount },
        });
      }

      await db.transactionStatusHistory.create({
        data: {
          transactionId: txn.id,
          fromStatus: txn.status,
          toStatus: status,
          actorId: req.user!.id,
          actorRole: 'ADMIN',
          note:
            action === 'paid'
              ? `Payout confirmed with reference ${providerRef}`
              : adminNote ?? (txn.type === 'WITHDRAWAL' && status === 'PROCESSING' ? 'Payout processing started; not yet confirmed paid.' : null),
        },
      });
      return db.transaction.findUniqueOrThrow({ where: { id: txn.id } });
    });

    if (updated.status === 'COMPLETED') {
      await notify({
        userId: updated.userId,
        title: updated.type === 'WITHDRAWAL' ? 'Withdrawal paid' : 'Deposit confirmed',
        body: `Your ${updated.type.toLowerCase()} of ${updated.currency} ${updated.amount.toFixed(2)} was completed.${updated.providerRef ? ` Payment reference: ${updated.providerRef}.` : ''}`,
        type: 'PAYMENT',
        link: '/wallet',
      });
    } else if (updated.status === 'FAILED') {
      await notify({
        userId: updated.userId,
        title: updated.type === 'WITHDRAWAL' ? 'Withdrawal rejected' : 'Deposit not verified',
        body:
          updated.type === 'WITHDRAWAL'
            ? `Your withdrawal was rejected and ${updated.currency} ${updated.amount.toFixed(2)} was returned to your wallet.${adminNote ? ` Reason: ${adminNote}` : ''}`
            : `We could not verify your deposit.${adminNote ? ` ${adminNote}` : ''}`,
        type: 'PAYMENT',
        link: '/wallet',
      });
    } else if (updated.type === 'WITHDRAWAL' && updated.status === 'PROCESSING') {
      await notify({
        userId: updated.userId,
        title: 'Withdrawal processing',
        body: `Your withdrawal ${updated.reference} is being processed. It is not marked paid yet.`,
        type: 'PAYMENT',
        link: '/wallet',
      });
    }

    res.json(updated);
  }),
);

adminRouter.get(
  '/purchases',
  asyncHandler(async (req, res) => {
    const status = req.query.status as string | undefined;
    const purchases = await prisma.purchase.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { user: { select: { name: true, email: true, membership: true } } },
    });
    res.json(purchases);
  }),
);

const purchaseActionSchema = z.object({
  action: z.enum(['verify', 'reject']),
  adminNote: z.string().max(300).optional(),
});

adminRouter.patch(
  '/purchases/:id',
  asyncHandler(async (req, res) => {
    const { action, adminNote } = validate(purchaseActionSchema, req.body);
    const purchase = await prisma.purchase.findUnique({ where: { id: req.params.id } });
    if (!purchase) throw new HttpError(404, 'Purchase not found');
    if (purchase.status === 'PAID') throw new HttpError(400, 'Purchase already verified');

    if (action === 'verify') {
      const fulfilled = await fulfilPurchase(purchase.id, req.user!.id);
      return res.json(fulfilled);
    }

    const updated = await prisma.purchase.update({
      where: { id: purchase.id },
      data: { status: 'FAILED', proofNote: adminNote ?? purchase.proofNote },
    });
    await notify({
      userId: purchase.userId,
      title: 'Payment not verified',
      body: `We could not verify your payment for "${purchase.itemTitle}".${adminNote ? ` ${adminNote}` : ''}`,
      type: 'PAYMENT',
      link: '/profile/purchases',
    });
    res.json(updated);
  }),
);

const broadcastSchema = z.object({
  title: z.string().min(2).max(120),
  body: z.string().min(2).max(500),
  type: z.string().default('SYSTEM'),
  link: z.string().optional(),
  audience: z.enum(['FREE', 'PAID', 'VIP_DERIV', 'VIP_WELTRADE']).optional(),
});

adminRouter.post(
  '/broadcast',
  asyncHandler(async (req, res) => {
    const data = validate(broadcastSchema, req.body);
    const results = data.audience
      ? await broadcastToAudience(data.audience, data)
      : await broadcastToAll(data);
    res.json({ ok: true, delivered: results.length });
  }),
);

const resourceSchema = z.object({
  courseId: z.string().optional().nullable(),
  title: z.string().min(1),
  type: z.enum(['PDF', 'EBOOK', 'SHEET']).default('PDF'),
  url: z.string().url(),
  sizeKb: z.coerce.number().default(0),
  isVip: z.boolean().default(false),
});

adminRouter.post(
  '/resources',
  asyncHandler(async (req, res) => {
    const data = validate(resourceSchema, req.body);
    if (data.courseId) {
      const course = await prisma.course.findUnique({ where: { id: data.courseId } });
      if (!course) throw new HttpError(404, 'Course not found');
    }
    const resource = await prisma.resource.create({ data });
    res.status(201).json(resource);
  }),
);

adminRouter.delete(
  '/resources/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.resource.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, 'Resource not found');
    await prisma.resource.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  }),
);

adminRouter.get(
  '/groups',
  asyncHandler(async (_req, res) => {
    const groups = await prisma.group.findMany({
      include: { _count: { select: { members: true, posts: true, messages: true } } },
      orderBy: [{ roomType: 'asc' }, { createdAt: 'asc' }],
    });
    res.json(groups);
  }),
);

const groupSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  category: z.enum(['General', 'Analysis', 'Wins', 'Questions']).default('General'),
  accessTier: z.enum(['FREE', 'PAID', 'VIP_DERIV', 'VIP_WELTRADE']).default('FREE'),
  roomType: z.enum(['GENERAL', 'DERIV', 'WELTRADE']).default('GENERAL'),
  isChatOpen: z.boolean().default(true),
});

adminRouter.post(
  '/groups',
  asyncHandler(async (req, res) => {
    const data = validate(groupSchema, req.body);
    const group = await prisma.group.create({
      data: { ...data, visibility: data.accessTier === 'FREE' ? 'PUBLIC' : 'VIP', ownerId: req.user!.id },
    });
    res.status(201).json(group);
  }),
);

adminRouter.patch(
  '/groups/:id',
  asyncHandler(async (req, res) => {
    const data = validate(groupSchema.partial(), req.body);
    const group = await prisma.group.update({
      where: { id: req.params.id },
      data: {
        ...data,
        ...(data.accessTier ? { visibility: data.accessTier === 'FREE' ? 'PUBLIC' : 'VIP' } : {}),
      },
    });
    if (typeof data.isChatOpen === 'boolean') {
      await notify({
        userId: group.ownerId ?? req.user!.id,
        title: data.isChatOpen ? `Chat opened in ${group.name}` : `Chat closed in ${group.name}`,
        body: data.isChatOpen ? 'You can post messages again.' : 'An administrator closed the chat in this room.',
        type: 'COMMUNITY',
      }).catch(() => {});
    }
    res.json(group);
  }),
);

adminRouter.delete(
  '/groups/:id',
  asyncHandler(async (req, res) => {
    await prisma.group.delete({ where: { id: req.params.id } }).catch(() => {});
    res.json({ ok: true });
  }),
);


adminRouter.get(
  '/payments',
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : undefined;
    const provider = typeof req.query.provider === 'string' && req.query.provider ? req.query.provider : undefined;
    const q = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim() : undefined;
    const from = typeof req.query.from === 'string' && req.query.from ? new Date(req.query.from) : undefined;
    const to = typeof req.query.to === 'string' && req.query.to ? new Date(req.query.to) : undefined;

    const purchases = await prisma.purchase.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(provider ? { provider } : {}),
        ...(from || to
          ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
          : {}),
        ...(q
          ? {
              OR: [
                { providerRef: { contains: q } },
                { itemTitle: { contains: q } },
                { user: { is: { email: { contains: q } } } },
                { user: { is: { name: { contains: q } } } },
                { payment: { is: { providerTransactionRef: { contains: q } } } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        user: { select: { name: true, email: true, phone: true, membership: true } },
        payment: true,
        receipt: { select: { receiptNumber: true } },
        refunds: { orderBy: { createdAt: 'desc' } },
      },
    });
    res.json(purchases);
  }),
);

adminRouter.get(
  '/payments/audit',
  asyncHandler(async (req, res) => {
    const purchaseId = typeof req.query.purchaseId === 'string' ? req.query.purchaseId : undefined;
    const logs = await prisma.paymentAuditLog.findMany({
      where: purchaseId ? { purchaseId } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json(logs);
  }),
);

adminRouter.get(
  '/refunds',
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : undefined;
    const refunds = await prisma.refund.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        user: { select: { name: true, email: true, phone: true } },
        purchase: { select: { itemTitle: true, itemType: true, provider: true, providerRef: true, status: true } },
      },
    });
    res.json(refunds);
  }),
);

const refundActionSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT', 'COMPLETE', 'FAIL']),
  reason: z.string().max(500).optional(),
  providerRef: z.string().max(120).optional(),
});

adminRouter.post(
  '/refunds/:id',
  asyncHandler(async (req, res) => {
    const { action, reason, providerRef } = validate(refundActionSchema, req.body);
    const refund = await adminRefundAction(req.params.id, action, req.user!.id, { reason, providerRef });
    res.json(refund);
  }),
);
