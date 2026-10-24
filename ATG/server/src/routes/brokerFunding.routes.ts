import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler, validate } from '../lib/http.js';
import { HttpError } from '../middleware/error.js';
import { notify } from '../services/notifications.service.js';
import {
  BROKERS,
  FUNDING_METHODS,
  METHOD_LABEL,
  type Broker,
  describeFundingMode,
  getFundingAdapter,
  listFundingGateways,
  verifyBrokerWebhook,
  WebhookVerificationError,
  webhookSignatureHeader,
} from '../services/brokerFunding/adapters.js';
import {
  applyTransition,
  advanceTo,
  depositFee,
  emitFundingUpdate,
  fundingLimits,
  isTerminal,
  maskDestination,
  newFundingReference,
  notifyFundingAdmins,
  recordAudit,
  type FundingStatus,
} from '../services/brokerFunding/index.js';
import { brokerPatchSchema, updateBrokerSettings, getBrokerSettings } from '../lib/settings.js';


export const brokerRouter = Router();
brokerRouter.use(requireAuth);

export const brokerAdminRouter = Router();
brokerAdminRouter.use(requireAuth, requireRole('ADMIN'));

const METHODS = FUNDING_METHODS;

const METHOD_ID: Record<string, string> = {
  BANK_TRANSFER: 'bank',
  ECOCASH: 'ecocash',
  ONEMONEY: 'onemoney',
  INNBUCKS: 'innbucks',
  CASHSMILE: 'cashsmile',
};


function brokerLabel(broker: string): string {
  return broker === 'DERIV' ? 'Deriv' : 'Weltrade';
}

interface ListQuery {
  status?: string;
  broker?: string;
  q?: string;
  minAmount?: string;
  maxAmount?: string;
  from?: string;
  to?: string;
}

function buildWhere(query: ListQuery, direction?: 'DEPOSIT' | 'WITHDRAWAL') {
  const where: Record<string, unknown> = {};
  if (direction) where.direction = direction;
  if (query.status) where.status = query.status;
  if (query.broker) where.broker = query.broker;
  if (query.minAmount || query.maxAmount) {
    where.amount = {
      ...(query.minAmount ? { gte: Number(query.minAmount) } : {}),
      ...(query.maxAmount ? { lte: Number(query.maxAmount) } : {}),
    };
  }
  if (query.from || query.to) {
    const createdAt: Record<string, Date> = {};
    if (query.from) createdAt.gte = new Date(query.from);
    if (query.to) {
      const end = new Date(query.to);
      if (/^\d{4}-\d{2}-\d{2}$/.test(query.to)) end.setHours(23, 59, 59, 999);
      createdAt.lte = end;
    }
    where.createdAt = createdAt;
  }
  if (query.q) {
    const q = query.q.trim();
    if (q) {
      where.OR = [
        { reference: { contains: q } },
        { paymentReference: { contains: q } },
        { broker: { equals: q.toUpperCase() } },
        { user: { is: { name: { contains: q } } } },
        { user: { is: { email: { contains: q } } } },
      ];
    }
  }
  return where;
}

function toCustomerView(tx: {
  id: string;
  direction: string;
  broker: string;
  amount: number;
  currency: string;
  method: string;
  feePct: number;
  feeAmount: number;
  status: string;
  reference: string;
  provider: string;
  providerRef: string | null;
  paymentReference: string | null;
  destination: string | null;
  destinationType: string | null;
  adminNote: string | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}) {
  return {
    id: tx.id,
    direction: tx.direction,
    broker: tx.broker,
    brokerLabel: brokerLabel(tx.broker),
    amount: tx.amount,
    currency: tx.currency,
    method: tx.method,
    methodLabel: METHOD_LABEL[tx.method] ?? tx.method,
    feePct: tx.feePct,
    feeAmount: tx.feeAmount,
    status: tx.status,
    reference: tx.reference,
    provider: tx.provider,
    processingMode: tx.provider === 'manual' ? 'manual' : 'automated',
    providerRef: tx.providerRef,
    paymentReference: tx.paymentReference,
    destination: tx.destination,
    destinationType: tx.destinationType,
    adminNote: tx.adminNote,
    failureReason: tx.failureReason,
    createdAt: tx.createdAt,
    updatedAt: tx.updatedAt,
    completedAt: tx.completedAt,
  };
}

function toAdminListView(tx: {
  id: string;
  direction: string;
  broker: string;
  amount: number;
  currency: string;
  method: string;
  feePct: number;
  feeAmount: number;
  status: string;
  reference: string;
  provider: string;
  providerRef: string | null;
  paymentReference: string | null;
  destination: string | null;
  destinationMasked: string | null;
  internalNote: string | null;
  adminNote: string | null;
  failureReason: string | null;
  createdAt: Date;
  completedAt: Date | null;
  user?: { id: string; name: string; email: string; membership: string };
}) {
  return {
    id: tx.id,
    direction: tx.direction,
    broker: tx.broker,
    amount: tx.amount,
    currency: tx.currency,
    method: tx.method,
    feePct: tx.feePct,
    feeAmount: tx.feeAmount,
    status: tx.status,
    reference: tx.reference,
    provider: tx.provider,
    processingMode: tx.provider === 'manual' ? 'manual' : 'automated',
    providerRef: tx.providerRef,
    paymentReference: tx.paymentReference,
    destinationMasked: tx.destinationMasked ?? maskDestination(tx.destination),
    hasDestination: Boolean(tx.destination),
    internalNote: tx.internalNote,
    adminNote: tx.adminNote,
    failureReason: tx.failureReason,
    createdAt: tx.createdAt,
    completedAt: tx.completedAt,
    user: tx.user,
  };
}


brokerRouter.get(
  '/config',
  asyncHandler(async (_req, res) => {
    const limits = await fundingLimits();
    const gateways = listFundingGateways();
    res.json({
      brokers: BROKERS.map((b) => ({ id: b, label: brokerLabel(b) })),
      methods: METHODS.map((m) => ({ id: m, label: METHOD_LABEL[m] ?? m, logo: METHOD_ID[m] ? `/payments/${METHOD_ID[m]}.${m === 'ONEMONEY' || m === 'CASHSMILE' ? 'jpg' : 'png'}` : null })),
      limits,
      gateways,
      manualProcessing: gateways.some((g) => !g.ready),
      notice:
        'Broker funding moves money between your broker account and your payment method. It is a separate balance from your ATG wallet — course and VIP payments are never mixed with broker funding.',
    });
  }),
);

brokerRouter.get(
  '/balances',
  asyncHandler(async (req, res) => {
    const rows = await prisma.brokerBalance.findMany({ where: { userId: req.user!.id } });
    const byBroker = new Map(rows.map((r) => [r.broker, r]));
    const balances = BROKERS.map((broker) => {
      const row = byBroker.get(broker);
      const verified = Boolean(row?.verifiedAt);
      return {
        broker,
        brokerLabel: brokerLabel(broker),
        available: verified,
        balance: verified && row ? row.balance : null,
        currency: row?.currency ?? env.brokerCurrency,
        source: verified ? row!.source : null,
        verifiedAt: verified ? row!.verifiedAt : null,
      };
    });
    res.json({ balances, notice: 'Balances are shown only once they have been verified against the broker or a reconciliation record.' });
  }),
);

const depositSchema = z.object({
  broker: z.enum(BROKERS),
  amount: z.coerce.number().positive(),
  method: z.enum(METHODS),
  paymentReference: z.string().trim().min(3).max(80),
  currency: z.string().trim().min(3).max(6).optional(),
  idempotencyKey: z.string().trim().min(8).max(64).optional(),
}).superRefine((data, ctx) => {
  if (data.method === 'USDT_TRC20' && !/^[a-fA-F0-9]{64}$/.test(data.paymentReference)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['paymentReference'],
      message: 'Enter the 64-character USDT TRC20 transaction hash',
    });
  }
});

brokerRouter.post(
  '/deposits',
  asyncHandler(async (req, res) => {
    const data = validate(depositSchema, req.body);
    const limits = await fundingLimits();
    const currency = (data.currency ?? limits.currency).toUpperCase();

    if (data.amount < limits.deposit.min || data.amount > limits.deposit.max) {
      throw new HttpError(
        400,
        `Amount must be between ${limits.deposit.min} and ${limits.deposit.max} ${currency}`,
        'AMOUNT_LIMIT',
      );
    }

    const idempotencyKey =
      (typeof req.headers['idempotency-key'] === 'string' && req.headers['idempotency-key'].trim()) ||
      data.idempotencyKey ||
      `auto-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    const existing = await prisma.brokerTransaction.findFirst({ where: { userId: req.user!.id, idempotencyKey } });
    if (existing) {
      return res.status(200).json({ transaction: existing, duplicate: true, mode: existing.provider === 'manual' ? 'manual' : 'automated' });
    }

    const open = await prisma.brokerTransaction.count({
      where: { userId: req.user!.id, direction: 'DEPOSIT', broker: data.broker, status: { notIn: ['COMPLETED', 'REJECTED', 'FAILED'] } },
    });
    if (open >= limits.pendingLimit) {
      throw new HttpError(409, `You already have ${open} open ${brokerLabel(data.broker)} deposit requests`, 'PENDING_LIMIT');
    }

    const reference = newFundingReference('DEPOSIT');
    const adapter = getFundingAdapter(data.broker);
    const result = await adapter.createFundingRequest({
      reference,
      broker: data.broker,
      direction: 'DEPOSIT',
      amount: data.amount,
      currency,
      method: data.method,
      paymentReference: data.paymentReference,
    });

    const status = result.status === 'PROCESSING' ? 'PROCESSING' : 'PENDING';
    const feeAmount = depositFee(data.amount, limits.feePct);
    const tx = await prisma.brokerTransaction.create({
      data: {
        userId: req.user!.id,
        direction: 'DEPOSIT',
        broker: data.broker,
        amount: data.amount,
        currency,
        method: data.method,
        feePct: limits.feePct,
        feeAmount,
        status,
        reference,
        idempotencyKey,
        paymentReference: data.paymentReference,
        provider: result.provider,
        providerRef: result.providerRef ?? null,
        adminNote: result.instructions ?? null,
      },
    });

    await recordAudit({
      transactionId: tx.id,
      action: 'CREATED',
      fromStatus: null,
      toStatus: status,
      source: 'CUSTOMER',
      actor: { id: req.user!.id, role: req.user!.role as 'USER' | 'ADMIN', name: req.user!.name },
      provider: result.provider,
      note: result.instructions ?? null,
      metadata: {
        broker: data.broker,
        amount: data.amount,
        currency,
        method: data.method,
        feePct: limits.feePct,
        feeAmount,
        mode: describeFundingMode(data.broker),
      },
    });

    await notifyFundingAdmins({
      title: 'Broker deposit awaiting review',
      body: `${req.user!.name} requested a ${brokerLabel(data.broker)} deposit of ${currency} ${data.amount.toFixed(2)} via ${METHOD_LABEL[data.method] ?? data.method} (ref ${reference}).`,
      link: '/admin',
    });
    await notify({
      userId: req.user!.id,
      title: 'Deposit request received',
      body: `Your ${brokerLabel(data.broker)} deposit of ${currency} ${data.amount.toFixed(2)} (ref ${reference}) is pending review.`,
      type: 'PAYMENT',
      link: '/broker-funds',
    });
    emitFundingUpdate(req.user!.id, { id: tx.id, status, direction: 'DEPOSIT', broker: data.broker, reference });

    res.status(201).json({
      transaction: tx,
      duplicate: false,
      mode: describeFundingMode(data.broker),
      provider: result.provider,
      instructions: result.instructions ?? null,
    });
  }),
);

const withdrawalSchema = z.object({
  broker: z.enum(BROKERS),
  amount: z.coerce.number().positive(),
  method: z.enum(METHODS),
  destination: z.string().trim().min(4).max(120),
  destinationType: z.enum(['MOBILE_WALLET', 'BANK_ACCOUNT', 'BROKER_ACCOUNT', 'CRYPTO_WALLET']),
  paymentReference: z.string().trim().min(3).max(80).optional(),
  currency: z.string().trim().min(3).max(6).optional(),
  idempotencyKey: z.string().trim().min(8).max(64).optional(),
}).superRefine((data, ctx) => {
  if (!data.paymentReference) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['paymentReference'],
      message: 'Your broker account or client ID is required to verify this withdrawal',
    });
  }
  if (data.method === 'USDT_TRC20') {
    if (data.destinationType !== 'CRYPTO_WALLET') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['destinationType'],
        message: 'USDT withdrawals must use a crypto wallet destination on TRC20',
      });
    }
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(data.destination)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['destination'],
        message: 'Enter a valid TRON wallet address for USDT (TRC20)',
      });
    }
  } else if (data.destinationType === 'CRYPTO_WALLET') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['destinationType'],
      message: 'Choose a supported destination type for this payout method',
    });
  }
});

brokerRouter.post(
  '/withdrawals',
  asyncHandler(async (req, res) => {
    const data = validate(withdrawalSchema, req.body);
    const limits = await fundingLimits();
    const currency = (data.currency ?? limits.currency).toUpperCase();

    if (data.amount < limits.withdrawal.min || data.amount > limits.withdrawal.max) {
      throw new HttpError(
        400,
        `Amount must be between ${limits.withdrawal.min} and ${limits.withdrawal.max} ${currency}`,
        'AMOUNT_LIMIT',
      );
    }

    const idempotencyKey =
      (typeof req.headers['idempotency-key'] === 'string' && req.headers['idempotency-key'].trim()) ||
      data.idempotencyKey ||
      `auto-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    const existing = await prisma.brokerTransaction.findFirst({ where: { userId: req.user!.id, idempotencyKey } });
    if (existing) {
      return res.status(200).json({ transaction: existing, duplicate: true, mode: existing.provider === 'manual' ? 'manual' : 'automated' });
    }

    const duplicate = await prisma.brokerTransaction.findFirst({
      where: {
        userId: req.user!.id,
        direction: 'WITHDRAWAL',
        broker: data.broker,
        amount: data.amount,
        destination: data.destination,
        status: { notIn: ['COMPLETED', 'REJECTED', 'FAILED'] },
      },
    });
    if (duplicate) {
      throw new HttpError(409, `An identical withdrawal is already open (ref ${duplicate.reference})`, 'DUPLICATE');
    }

    const open = await prisma.brokerTransaction.count({
      where: { userId: req.user!.id, direction: 'WITHDRAWAL', broker: data.broker, status: { notIn: ['COMPLETED', 'REJECTED', 'FAILED'] } },
    });
    if (open >= limits.pendingLimit) {
      throw new HttpError(409, `You already have ${open} open ${brokerLabel(data.broker)} withdrawal requests`, 'PENDING_LIMIT');
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const dayTotal = await prisma.brokerTransaction.aggregate({
      where: { userId: req.user!.id, direction: 'WITHDRAWAL', createdAt: { gte: since }, status: { not: 'REJECTED' } },
      _sum: { amount: true },
    });
    const alreadyToday = dayTotal._sum.amount ?? 0;
    if (alreadyToday + data.amount > limits.withdrawal.dailyMax) {
      throw new HttpError(
        400,
        `Daily withdrawal limit is ${limits.withdrawal.dailyMax} ${currency} — ${alreadyToday.toFixed(2)} already requested in the last 24h`,
        'DAILY_LIMIT',
      );
    }

    const reference = newFundingReference('WITHDRAWAL');
    const note =
      `Withdrawal request from ${brokerLabel(data.broker)} is pending administrator review. ` +
      'No payout is sent until an administrator approves and starts processing.';
    const created = await prisma.$transaction(async (db) => {
      const replay = await db.brokerTransaction.findFirst({ where: { userId: req.user!.id, idempotencyKey } });
      if (replay) return { transaction: replay, duplicate: true };

      const locked = await db.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM BrokerBalance
        WHERE userId = ${req.user!.id}
          AND broker = ${data.broker}
          AND currency = ${currency}
          AND verifiedAt IS NOT NULL
        ORDER BY updatedAt DESC
        LIMIT 1
        FOR UPDATE
      `;
      if (!locked.length) {
        throw new HttpError(409, `A verified ${brokerLabel(data.broker)} balance is required before requesting a withdrawal`, 'BALANCE_NOT_VERIFIED');
      }
      const balance = await db.brokerBalance.findUnique({ where: { id: locked[0].id } });
      if (!balance?.verifiedAt) {
        throw new HttpError(409, 'The broker balance is no longer verified; refresh it before requesting a withdrawal', 'BALANCE_NOT_VERIFIED');
      }

      const openDuplicate = await db.brokerTransaction.findFirst({
        where: {
          userId: req.user!.id,
          direction: 'WITHDRAWAL',
          broker: data.broker,
          amount: data.amount,
          destination: data.destination,
          status: { notIn: ['COMPLETED', 'REJECTED', 'FAILED'] },
        },
      });
      if (openDuplicate) {
        throw new HttpError(409, `An identical withdrawal is already open (ref ${openDuplicate.reference})`, 'DUPLICATE');
      }

      const openCount = await db.brokerTransaction.count({
        where: {
          userId: req.user!.id,
          direction: 'WITHDRAWAL',
          broker: data.broker,
          status: { notIn: ['COMPLETED', 'REJECTED', 'FAILED'] },
        },
      });
      if (openCount >= limits.pendingLimit) {
        throw new HttpError(409, `You already have ${openCount} open ${brokerLabel(data.broker)} withdrawal requests`, 'PENDING_LIMIT');
      }

      const sinceVerification = await db.brokerTransaction.aggregate({
        where: {
          userId: req.user!.id,
          broker: data.broker,
          direction: 'WITHDRAWAL',
          createdAt: { gt: balance.verifiedAt },
          status: { notIn: ['REJECTED', 'FAILED'] },
        },
        _sum: { amount: true },
      });
      const available = Math.max(0, balance.balance - (sinceVerification._sum.amount ?? 0));
      if (data.amount > available) {
        throw new HttpError(400, `Withdrawal exceeds the verified available balance of ${currency} ${available.toFixed(2)}`, 'INSUFFICIENT_BROKER_BALANCE');
      }

      const dayTotalInTransaction = await db.brokerTransaction.aggregate({
        where: {
          userId: req.user!.id,
          direction: 'WITHDRAWAL',
          createdAt: { gte: since },
          status: { not: 'REJECTED' },
        },
        _sum: { amount: true },
      });
      const alreadyTodayInTransaction = dayTotalInTransaction._sum.amount ?? 0;
      if (alreadyTodayInTransaction + data.amount > limits.withdrawal.dailyMax) {
        throw new HttpError(
          400,
          `Daily withdrawal limit is ${limits.withdrawal.dailyMax} ${currency} — ${alreadyTodayInTransaction.toFixed(2)} already requested in the last 24h`,
          'DAILY_LIMIT',
        );
      }

      const created = await db.brokerTransaction.create({
        data: {
          userId: req.user!.id,
          direction: 'WITHDRAWAL',
          broker: data.broker,
          amount: data.amount,
          currency,
          method: data.method,
          status: 'PENDING',
          reference,
          idempotencyKey,
          destination: data.destination,
          destinationMasked: maskDestination(data.destination),
          destinationType: data.destinationType,
          paymentReference: data.paymentReference ?? null,
          provider: 'manual',
          providerRef: null,
          adminNote: note,
        },
      });

      await db.brokerAuditLog.create({
        data: {
          transactionId: created.id,
          action: 'CREATED',
          fromStatus: null,
          toStatus: 'PENDING',
          source: 'CUSTOMER',
          actorId: req.user!.id,
          actorRole: req.user!.role,
          actorName: req.user!.name,
          provider: 'manual',
          note,
          metadata: JSON.stringify({
            broker: data.broker,
            amount: data.amount,
            currency,
            method: data.method,
            destinationMasked: maskDestination(data.destination),
            destinationType: data.destinationType,
            mode: 'manual',
          }),
        },
      });
      return { transaction: created, duplicate: false };
    });
    const tx = created.transaction;
    if (created.duplicate) {
      return res.status(200).json({
        transaction: tx,
        duplicate: true,
        mode: tx.provider === 'manual' ? 'manual' : 'automated',
      });
    }

    await notifyFundingAdmins({
      title: 'Broker withdrawal awaiting review',
      body: `${req.user!.name} requested a ${brokerLabel(data.broker)} withdrawal of ${currency} ${data.amount.toFixed(2)} (ref ${reference}). Review is required before processing.`,
      link: '/admin',
    });
    await notify({
      userId: req.user!.id,
      title: 'Withdrawal request received',
      body: `Your ${brokerLabel(data.broker)} withdrawal of ${currency} ${data.amount.toFixed(2)} (ref ${reference}) is pending review. Admin approval is required before processing.`,
      type: 'PAYMENT',
      link: '/broker-funds',
    });
    emitFundingUpdate(req.user!.id, { id: tx.id, status: 'PENDING', direction: 'WITHDRAWAL', broker: data.broker, reference });

    res.status(201).json({
      transaction: tx,
      duplicate: false,
      mode: 'manual',
      provider: 'manual',
      instructions: note,
    });
  }),
);

brokerRouter.get(
  '/transactions',
  asyncHandler(async (req, res) => {
    const query = validate(
      z.object({
        direction: z.enum(['DEPOSIT', 'WITHDRAWAL']).optional(),
        broker: z.enum(BROKERS).optional(),
        status: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      }),
      req.query,
    );
    const txs = await prisma.brokerTransaction.findMany({
      where: { userId: req.user!.id, ...(query.direction ? { direction: query.direction } : {}), ...(query.broker ? { broker: query.broker } : {}), ...(query.status ? { status: query.status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 100,
    });
    res.json(txs.map(toCustomerView));
  }),
);

brokerRouter.get(
  '/deposits',
  asyncHandler(async (req, res) => {
    const broker = req.query.broker as string | undefined;
    const txs = await prisma.brokerTransaction.findMany({
      where: { userId: req.user!.id, direction: 'DEPOSIT', ...(broker ? { broker } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(txs.map(toCustomerView));
  }),
);

brokerRouter.get(
  '/withdrawals',
  asyncHandler(async (req, res) => {
    const broker = req.query.broker as string | undefined;
    const txs = await prisma.brokerTransaction.findMany({
      where: { userId: req.user!.id, direction: 'WITHDRAWAL', ...(broker ? { broker } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(txs.map(toCustomerView));
  }),
);

brokerRouter.get(
  '/transactions/:id',
  asyncHandler(async (req, res) => {
    const tx = await prisma.brokerTransaction.findUnique({ where: { id: req.params.id }, include: { audit: { orderBy: { createdAt: 'asc' } } } });
    if (!tx || tx.userId !== req.user!.id) throw new HttpError(404, 'Funding request not found');

    const timeline = tx.audit
      .filter((a) => a.source !== 'ADMIN' || a.action !== 'NOTE')
      .map((a) => ({
        id: a.id,
        action: a.action,
        fromStatus: a.fromStatus,
        toStatus: a.toStatus,
        source: a.source,
        note: a.source === 'PROVIDER' || a.source === 'CUSTOMER' ? a.note : null,
        at: a.createdAt,
      }));

    res.json({ ...toCustomerView(tx), timeline });
  }),
);


async function listAdmin(query: ListQuery, direction: 'DEPOSIT' | 'WITHDRAWAL') {
  const rows = await prisma.brokerTransaction.findMany({
    where: buildWhere(query, direction),
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { user: { select: { id: true, name: true, email: true, membership: true } } },
  });
  return rows.map(toAdminListView);
}

brokerAdminRouter.get(
  '/deposits',
  asyncHandler(async (req, res) => {
    res.json(await listAdmin(req.query as ListQuery, 'DEPOSIT'));
  }),
);

brokerAdminRouter.get(
  '/withdrawals',
  asyncHandler(async (req, res) => {
    res.json(await listAdmin(req.query as ListQuery, 'WITHDRAWAL'));
  }),
);

brokerAdminRouter.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const [deposits, withdrawals] = await Promise.all([
      prisma.brokerTransaction.groupBy({ by: ['status'], where: { direction: 'DEPOSIT' }, _count: true }),
      prisma.brokerTransaction.groupBy({ by: ['status'], where: { direction: 'WITHDRAWAL' }, _count: true }),
    ]);
    const sum = (rows: { status: string; _count: number }[]) =>
      rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: r._count }), {});
    const totals = await prisma.brokerTransaction.aggregate({
      where: { status: 'COMPLETED' },
      _count: true,
      _sum: { amount: true },
    });
    res.json({
      deposits: sum(deposits),
      withdrawals: sum(withdrawals),
      completed: { count: totals._count, amount: totals._sum.amount ?? 0 },
      gateways: listFundingGateways(),
      currency: env.brokerCurrency,
    });
  }),
);


brokerAdminRouter.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    const settings = await getBrokerSettings();
    const limits = await fundingLimits();
    res.json({ settings, limits, currency: env.brokerCurrency });
  }),
);

brokerAdminRouter.put(
  '/settings',
  asyncHandler(async (req, res) => {
    const data = validate(brokerPatchSchema, req.body);
    const before = await getBrokerSettings();
    const settings = await updateBrokerSettings(data, req.user!.id);
    await recordAudit({
      transactionId: null,
      action: 'SETTINGS_UPDATED',
      source: 'ADMIN',
      actor: { id: req.user!.id, role: 'ADMIN', name: req.user!.name },
      note: 'Broker funding limits / fee updated',
      metadata: { before, after: settings, patch: data },
    });
    res.json({ settings, limits: await fundingLimits(), currency: env.brokerCurrency });
  }),
);

brokerAdminRouter.get(
  '/transactions/:id',
  asyncHandler(async (req, res) => {
    const tx = await prisma.brokerTransaction.findUnique({
      where: { id: req.params.id },
      include: { user: { select: { id: true, name: true, email: true, membership: true } }, audit: { orderBy: { createdAt: 'asc' } } },
    });
    if (!tx) throw new HttpError(404, 'Funding request not found');
    res.json({
      ...toAdminListView(tx),
      destination: tx.destination,
      destinationType: tx.destinationType,
      evidence: tx.evidence,
      evidenceType: tx.evidenceType,
      adminNote: tx.adminNote,
      processedAt: tx.processedAt,
      audit: tx.audit.map((a) => ({
        id: a.id,
        action: a.action,
        fromStatus: a.fromStatus,
        toStatus: a.toStatus,
        source: a.source,
        provider: a.provider,
        eventId: a.eventId,
        actorName: a.actorName,
        actorRole: a.actorRole,
        note: a.note,
        metadata: a.metadata,
        at: a.createdAt,
      })),
    });
  }),
);

const adminActionSchema = z.object({
  action: z.enum(['review', 'approve', 'start_processing', 'complete', 'reject', 'fail']),
  adminNote: z.string().trim().max(300).optional(),
  internalNote: z.string().trim().max(500).optional(),
  providerRef: z.string().trim().max(120).optional(),
  evidence: z.string().trim().max(300).optional(),
  failureReason: z.string().trim().max(300).optional(),
});

const ACTION_TARGET: Record<string, string> = {
  review: 'UNDER_REVIEW',
  approve: 'APPROVED',
  start_processing: 'PROCESSING',
  complete: 'COMPLETED',
  reject: 'REJECTED',
  fail: 'FAILED',
};

brokerAdminRouter.patch(
  '/transactions/:id',
  asyncHandler(async (req, res) => {
    const data = validate(adminActionSchema, req.body);
    const tx = await prisma.brokerTransaction.findUnique({ where: { id: req.params.id } });
    if (!tx) throw new HttpError(404, 'Funding request not found');
    if (isTerminal(tx.status)) throw new HttpError(400, `Request is already ${tx.status.toLowerCase()}`, 'ALREADY_FINAL');
    if (data.action === 'complete' && tx.method === 'USDT_TRC20' && !/^[a-fA-F0-9]{64}$/.test(data.providerRef ?? '')) {
      throw new HttpError(400, 'Enter the 64-character TRC20 transaction hash verified on-chain', 'EVIDENCE_REQUIRED');
    }

    const actor = { id: req.user!.id, role: 'ADMIN' as const, name: req.user!.name };

    let providerRef = data.providerRef ?? null;
    let mode = tx.provider;
    if (data.action === 'start_processing' && tx.direction === 'WITHDRAWAL') {
      const adapter = getFundingAdapter(tx.broker as Broker);
      const result = await adapter.createFundingRequest({
        reference: tx.reference,
        broker: tx.broker as Broker,
        direction: 'WITHDRAWAL',
        amount: tx.amount,
        currency: tx.currency,
        method: tx.method,
        destination: tx.destination,
        paymentReference: tx.paymentReference,
      });
      providerRef = result.providerRef ?? providerRef;
      mode = result.provider;
      if (result.status === 'PENDING') {
        await recordAudit({
          transactionId: tx.id,
          action: 'MANUAL_PROCESSING',
          fromStatus: tx.status,
          toStatus: tx.status,
          source: 'SYSTEM',
          actor,
          provider: result.provider,
          note: result.message ?? 'Gateway not configured — manual processing.',
        });
      }
    }

    const updated = await applyTransition({
      tx,
      to: ACTION_TARGET[data.action] as FundingStatus,
      action: data.action.toUpperCase(),
      actor,
      source: 'ADMIN',
      providerRef,
      evidence: data.action === 'complete' ? (data.evidence ?? data.providerRef ?? null) : undefined,
      evidenceType: data.action === 'complete' ? 'MANUAL_RECONCILIATION' : undefined,
      adminNote: data.adminNote ?? undefined,
      internalNote: data.internalNote ?? undefined,
      failureReason: data.failureReason ?? undefined,
      provider: mode !== tx.provider ? mode : undefined,
      note: data.internalNote ?? data.adminNote ?? null,
      metadata: { mode: mode === 'manual' ? 'manual' : 'automated' },
    });

    if (data.action === 'reject' || data.action === 'fail') {
      await notify({
        userId: tx.userId,
        title: data.action === 'reject' ? 'Broker request rejected' : 'Broker request failed',
        body: `Your ${brokerLabel(tx.broker)} ${tx.direction.toLowerCase()} of ${tx.currency} ${tx.amount.toFixed(2)} (ref ${tx.reference}) was ${data.action === 'reject' ? 'rejected' : 'marked failed'}.${data.failureReason ? ` ${data.failureReason}` : ''}`,
        type: 'PAYMENT',
        link: '/broker-funds',
      });
    }

    res.json(updated);
  }),
);

brokerAdminRouter.post(
  '/transactions/:id/notes',
  asyncHandler(async (req, res) => {
    const { note } = validate(z.object({ note: z.string().trim().min(2).max(500) }), req.body);
    const tx = await prisma.brokerTransaction.findUnique({ where: { id: req.params.id } });
    if (!tx) throw new HttpError(404, 'Funding request not found');

    const updated = await prisma.brokerTransaction.update({ where: { id: tx.id }, data: { internalNote: note } });
    await recordAudit({
      transactionId: tx.id,
      action: 'NOTE',
      fromStatus: tx.status,
      toStatus: tx.status,
      source: 'ADMIN',
      actor: { id: req.user!.id, role: 'ADMIN', name: req.user!.name },
      note,
    });
    res.json(updated);
  }),
);

brokerAdminRouter.get(
  '/audit',
  asyncHandler(async (req, res) => {
    const query = req.query as { action?: string; source?: string; transactionId?: string; broker?: string; from?: string; to?: string };
    const rows = await prisma.brokerAuditLog.findMany({
      where: {
        ...(query.action ? { action: query.action } : {}),
        ...(query.source ? { source: query.source } : {}),
        ...(query.transactionId ? { transactionId: query.transactionId } : {}),
        ...(query.broker ? { transaction: { is: { broker: query.broker } } } : {}),
        ...(query.from || query.to
          ? {
              createdAt: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {}),
              },
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        transaction: { select: { reference: true, broker: true, direction: true, amount: true, currency: true, status: true, userId: true } },
      },
    });
    res.json(
      rows.map((a) => ({
        id: a.id,
        action: a.action,
        fromStatus: a.fromStatus,
        toStatus: a.toStatus,
        source: a.source,
        provider: a.provider,
        eventId: a.eventId,
        actorName: a.actorName,
        actorRole: a.actorRole,
        note: a.note,
        metadata: a.metadata,
        at: a.createdAt,
        transaction: a.transaction,
      })),
    );
  }),
);

brokerAdminRouter.get(
  '/balances',
  asyncHandler(async (req, res) => {
    const broker = req.query.broker as string | undefined;
    const rows = await prisma.brokerBalance.findMany({
      where: broker ? { broker } : {},
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    res.json(rows);
  }),
);

const balanceSchema = z.object({
  userId: z.string().min(1),
  broker: z.enum(BROKERS),
  currency: z.string().trim().min(3).max(6).optional(),
  balance: z.coerce.number().min(0),
  source: z.enum(['PROVIDER_API', 'MANUAL_RECONCILIATION']).default('MANUAL_RECONCILIATION'),
  reference: z.string().trim().min(3).max(120),
});

brokerAdminRouter.post(
  '/balances',
  asyncHandler(async (req, res) => {
    const data = validate(balanceSchema, req.body);
    const user = await prisma.user.findUnique({ where: { id: data.userId } });
    if (!user) throw new HttpError(404, 'User not found');

    const currency = (data.currency ?? env.brokerCurrency).toUpperCase();
    const row = await prisma.brokerBalance.upsert({
      where: { userId_broker_currency: { userId: data.userId, broker: data.broker, currency } },
      update: {
        balance: data.balance,
        source: data.source,
        reference: data.reference,
        verifiedById: req.user!.id,
        verifiedAt: new Date(),
      },
      create: {
        userId: data.userId,
        broker: data.broker,
        currency,
        balance: data.balance,
        source: data.source,
        reference: data.reference,
        verifiedById: req.user!.id,
        verifiedAt: new Date(),
      },
    });

    await recordAudit({
      action: 'BALANCE_SYNC',
      source: 'ADMIN',
      actor: { id: req.user!.id, role: 'ADMIN', name: req.user!.name },
      note: `Verified ${brokerLabel(data.broker)} balance ${currency} ${data.balance.toFixed(2)}`,
      metadata: { userId: data.userId, broker: data.broker, currency, balance: data.balance, source: data.source, reference: data.reference },
    });

    await notify({
      userId: data.userId,
      title: `${brokerLabel(data.broker)} balance updated`,
      body: `Your verified ${brokerLabel(data.broker)} balance is ${currency} ${data.balance.toFixed(2)}.`,
      type: 'PAYMENT',
      link: '/broker-funds',
    });

    res.status(201).json(row);
  }),
);


export async function brokerWebhookHandler(req: Request, res: Response) {
  const broker = String(req.params.broker ?? '').toUpperCase() as Broker;
  if (!BROKERS.includes(broker)) return res.status(404).json({ error: 'Unknown broker' });

  const headerName = webhookSignatureHeader(broker).toLowerCase();
  const signature = req.headers[headerName] as string | undefined;

  let event;
  try {
    event = verifyBrokerWebhook(broker, req.body as Buffer, signature);
  } catch (err) {
    const message = err instanceof WebhookVerificationError ? err.message : 'Webhook verification failed';
    return res.status(400).json({ error: message });
  }

  const provider = broker.toLowerCase();
  const replayed = await prisma.brokerAuditLog.findFirst({ where: { provider, eventId: event.eventId } });
  if (replayed) return res.json({ received: true, duplicate: true });

  const tx = await prisma.brokerTransaction.findUnique({ where: { reference: event.reference } });
  if (!tx) return res.status(404).json({ error: `No funding request with reference ${event.reference}` });
  if (tx.broker !== broker) return res.status(400).json({ error: 'Reference does not belong to this broker' });

  const actor = { id: null, role: 'SYSTEM' as const, name: `${broker} webhook` };

  try {
    if (event.outcome === 'COMPLETED') {
      if (tx.direction === 'WITHDRAWAL' && tx.status !== 'PROCESSING') {
        await recordAudit({
          transactionId: tx.id,
          action: 'WEBHOOK_HELD_FOR_REVIEW',
          fromStatus: tx.status,
          toStatus: tx.status,
          source: 'PROVIDER',
          actor,
          provider,
          eventId: event.eventId,
          note: `${broker} reported settlement while the withdrawal is ${tx.status} — held for administrator review.`,
          metadata: { outcome: event.outcome, providerRef: event.providerRef },
        });
        await notifyFundingAdmins({
          title: 'Withdrawal settlement needs review',
          body: `${broker} reported settlement for ${tx.reference} while it is still ${tx.status}. Verify before completing.`,
          link: '/admin',
        });
        return res.json({ received: true, heldForReview: true, status: tx.status });
      }

      const advanced = await advanceTo(tx, 'COMPLETED', {
        actor,
        source: 'PROVIDER',
        provider,
        eventId: event.eventId,
        evidence: `provider webhook ${event.eventId}`,
        evidenceType: 'PROVIDER_WEBHOOK',
        providerRef: event.providerRef,
        note: `Confirmed by ${broker} webhook ${event.eventId}`,
        metadata: { outcome: event.outcome, reason: event.reason },
      });
      await notify({
        userId: tx.userId,
        title: `${brokerLabel(broker)} ${tx.direction.toLowerCase()} completed`,
        body: `Your ${brokerLabel(broker)} ${tx.direction.toLowerCase()} of ${tx.currency} ${tx.amount.toFixed(2)} (ref ${tx.reference}) was confirmed by the provider.`,
        type: 'PAYMENT',
        link: '/broker-funds',
      });
      return res.json({ received: true, id: advanced.id, status: advanced.status });
    }

    const updated = await applyTransition({
      tx,
      to: 'FAILED',
      action: 'WEBHOOK_FAILED',
      actor,
      source: 'PROVIDER',
      provider,
      eventId: event.eventId,
      failureReason: event.reason ?? `${broker} reported the funding request as failed`,
      providerRef: event.providerRef,
      note: `Failed per ${broker} webhook ${event.eventId}`,
      metadata: { outcome: event.outcome },
    });
    return res.json({ received: true, id: updated.id, status: updated.status });
  } catch (err) {
    if (err instanceof HttpError && (err.code === 'ALREADY_FINAL' || err.code === 'NOOP' || err.code === 'INVALID_TRANSITION')) {
      await recordAudit({
        transactionId: tx.id,
        action: 'WEBHOOK_IGNORED',
        fromStatus: tx.status,
        toStatus: tx.status,
        source: 'PROVIDER',
        actor,
        provider,
        eventId: event.eventId,
        note: err.message,
      });
      return res.json({ received: true, ignored: err.message });
    }
    throw err;
  }
}
