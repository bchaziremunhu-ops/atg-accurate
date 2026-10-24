import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, validate } from '../lib/http.js';
import { fulfilPurchase, requestRefund } from '../services/payments/index.js';
import { getSubscriptionPlans, resolvePlan } from '../services/payments/plans.js';
import { HttpError } from '../middleware/error.js';

export const paymentRouter = Router();

paymentRouter.get(
  '/config',
  asyncHandler(async (_req, res) => {
    res.json({
      paymentsAvailable: false,
      currency: 'USD',
      vipPriceMonthly: 29.99,
      plans: await getSubscriptionPlans(),
    });
  }),
);

paymentRouter.get(
  '/purchases',
  requireAuth,
  asyncHandler(async (req, res) => {
    const purchases = await prisma.purchase.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      include: { payment: true, receipt: true, refunds: { orderBy: { createdAt: 'desc' } } },
    });
    res.json(purchases);
  }),
);

paymentRouter.get(
  '/receipts',
  requireAuth,
  asyncHandler(async (req, res) => {
    const receipts = await prisma.receipt.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json(receipts);
  }),
);

paymentRouter.get(
  '/receipts/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const receipt = await prisma.receipt.findUnique({
      where: { id: req.params.id },
      include: { purchase: { select: { provider: true, providerRef: true, status: true } } },
    });
    if (!receipt || (receipt.userId !== req.user!.id && req.user!.role !== 'ADMIN')) {
      throw new HttpError(404, 'Receipt not found');
    }
    res.json(receipt);
  }),
);

paymentRouter.get(
  '/orders/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const purchase = await prisma.purchase.findUnique({
      where: { id: req.params.id },
      include: { payment: true, receipt: true },
    });
    if (!purchase || purchase.userId !== req.user!.id) throw new HttpError(404, 'Order not found');
    res.json(purchase);
  }),
);

paymentRouter.get(
  '/refunds',
  requireAuth,
  asyncHandler(async (req, res) => {
    const refunds = await prisma.refund.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      include: { purchase: { select: { itemTitle: true, itemType: true } } },
    });
    res.json(refunds);
  }),
);

paymentRouter.post(
  '/purchases/:id/refund-request',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { reason } = z.object({ reason: z.string().min(5).max(500) }).parse(req.body);
    const refund = await requestRefund(req.user!.id, req.params.id, reason);
    res.status(201).json(refund);
  }),
);

const checkoutSchema = z.object({
  itemType: z.enum(['COURSE', 'RESOURCE', 'SUBSCRIPTION']),
  itemId: z.string(),
  method: z.string().optional(),
  gateway: z.string().optional(),
});

paymentRouter.post(
  '/checkout',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = validate(checkoutSchema, req.body);

    let itemTitle = 'Purchase';
    let amount = 0;
    let planItemId = data.itemId;

    if (data.itemType === 'COURSE') {
      const course = await prisma.course.findUnique({ where: { id: data.itemId } });
      if (!course) throw new HttpError(404, 'Course not found');
      itemTitle = course.title;
      amount = course.price;
    } else if (data.itemType === 'RESOURCE') {
      const resource = await prisma.resource.findUnique({ where: { id: data.itemId } });
      if (!resource) throw new HttpError(404, 'Resource not found');
      itemTitle = resource.title;
      amount = 9.99;
    } else {
      const plan = await resolvePlan(!data.itemId || data.itemId === 'VIP_MONTHLY' ? undefined : data.itemId);
      itemTitle = plan.title;
      amount = plan.price;
      planItemId = plan.id;
    }

    if (amount <= 0) {
      const purchase = await prisma.purchase.create({
        data: {
          userId: req.user!.id,
          itemType: data.itemType,
          itemId: planItemId,
          itemTitle,
          amount: 0,
          status: 'PENDING',
          provider: 'free',
        },
      });
      await fulfilPurchase(purchase.id);
      return res.status(201).json({ provider: 'free', purchaseId: purchase.id, status: 'PAID', completed: true });
    }

    throw new HttpError(503, 'Paid checkout is currently unavailable.');
  }),
);
