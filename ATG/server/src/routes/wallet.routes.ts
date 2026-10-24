import { Router } from 'express';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import type { Transaction } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, validate } from '../lib/http.js';
import { HttpError } from '../middleware/error.js';
import { getPaymentProvider } from '../services/payments/providers.js';
import { notify, notifyMany } from '../services/notifications.service.js';
import { env, integrations } from '../config/env.js';

export const walletRouter = Router();

walletRouter.use(requireAuth);

const METHODS = ['BANK_TRANSFER', 'ECOCASH', 'ONEMONEY', 'INNBUCKS', 'CASHSMILE'] as const;
const WITHDRAWAL_METHODS = [...METHODS, 'USDT_TRC20'] as const;

function withdrawalPolicy() {
  const policy = {
    min: env.walletWithdrawalMin,
    max: env.walletWithdrawalMax,
    feePct: env.walletWithdrawalFeePct,
  };
  if (
    !Number.isFinite(policy.min) ||
    !Number.isFinite(policy.max) ||
    !Number.isFinite(policy.feePct) ||
    policy.min <= 0 ||
    policy.max < policy.min ||
    policy.feePct < 0 ||
    policy.feePct > 100
  ) {
    throw new HttpError(500, 'Wallet withdrawal limits or fee configuration is invalid');
  }
  return policy;
}

async function notifyAdmins(input: { title: string; body: string; link?: string }) {
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
  await notifyMany(admins.map((a) => a.id), { ...input, type: 'PAYMENT' });
}

walletRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const wallet = await prisma.wallet.upsert({
      where: { userId: req.user!.id },
      update: {},
      create: { userId: req.user!.id },
    });
    res.json({ ...wallet, providerConfigured: integrations.payments, methods: METHODS });
  }),
);

walletRouter.get(
  '/withdrawal-config',
  asyncHandler(async (_req, res) => {
    res.json({ ...withdrawalPolicy(), manualReview: true });
  }),
);

walletRouter.get(
  '/transactions',
  asyncHandler(async (req, res) => {
    const txns = await prisma.transaction.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { statusHistory: { orderBy: { createdAt: 'asc' } } },
    });
    res.json(txns);
  }),
);

const depositSchema = z.object({
  amount: z.coerce.number().positive().max(1_000_000),
  method: z.enum(METHODS),
  currency: z.string().default('USD'),
});

walletRouter.post(
  '/deposit',
  asyncHandler(async (req, res) => {
    const data = validate(depositSchema, req.body);
    const reference = `ATG-DEP-${nanoid(8).toUpperCase()}`;
    const adapter = getPaymentProvider();
    const result = await adapter.createDeposit({
      userId: req.user!.id,
      amount: data.amount,
      currency: data.currency,
      method: data.method,
      reference,
    });

    const status = adapter.configured && result.status === 'COMPLETED' ? 'COMPLETED' : result.status;

    const txn = await prisma.transaction.create({
      data: {
        userId: req.user!.id,
        type: 'DEPOSIT',
        method: data.method,
        amount: data.amount,
        currency: data.currency,
        status,
        reference,
        note: result.instructions ?? null,
      },
    });

    if (status === 'COMPLETED') {
      await prisma.wallet.upsert({
        where: { userId: req.user!.id },
        update: { balance: { increment: data.amount } },
        create: { userId: req.user!.id, balance: data.amount },
      });
      await notify({
        userId: req.user!.id,
        title: 'Deposit confirmed',
        body: `${data.currency} ${data.amount.toFixed(2)} credited to your wallet.`,
        type: 'PAYMENT',
        link: '/wallet',
      });
    } else {
      await notifyAdmins({
        title: 'Deposit awaiting verification',
        body: `${req.user!.name} initiated a ${data.method} deposit of ${data.currency} ${data.amount.toFixed(2)} (ref ${reference}).`,
        link: '/admin',
      });
    }

    res.status(201).json({ transaction: txn, provider: result.provider, redirectUrl: result.redirectUrl });
  }),
);

const withdrawSchema = z.object({
  amount: z.coerce.number().positive().finite().refine((value) => Number.isInteger(value * 100), 'Use at most two decimal places'),
  method: z.enum(WITHDRAWAL_METHODS),
  destination: z.string().min(3).max(120),
  idempotencyKey: z.string().trim().min(8).max(64).optional(),
});

walletRouter.post(
  '/withdraw',
  asyncHandler(async (req, res) => {
    const data = validate(withdrawSchema, req.body);
    if (data.method === 'USDT_TRC20' && !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(data.destination)) {
      throw new HttpError(400, 'Enter a valid TRON wallet address for USDT (TRC20)', 'INVALID_DESTINATION');
    }
    const policy = withdrawalPolicy();
    if (data.amount < policy.min || data.amount > policy.max) {
      throw new HttpError(
        400,
        `Withdrawal amount must be between ${policy.min} and ${policy.max} USD`,
        'AMOUNT_LIMIT',
      );
    }

    const idempotencyKey =
      (typeof req.headers['idempotency-key'] === 'string' && req.headers['idempotency-key'].trim()) ||
      data.idempotencyKey ||
      `auto-${nanoid(24)}`;

    const existing = await prisma.transaction.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.userId !== req.user!.id) throw new HttpError(409, 'This request key has already been used', 'DUPLICATE');
      if (
        existing.amount !== data.amount ||
        existing.method !== data.method ||
        existing.destination !== data.destination
      ) {
        throw new HttpError(409, 'This request key was already used for a different withdrawal', 'IDEMPOTENCY_MISMATCH');
      }
      return res.status(200).json({ transaction: existing, provider: 'manual', duplicate: true });
    }

    const fee = Math.round(data.amount * policy.feePct) / 100;
    const netAmount = Math.round((data.amount - fee) * 100) / 100;
    const reference = `ATG-WDR-${nanoid(8).toUpperCase()}`;
    let txn: Transaction;
    try {
      txn = await prisma.$transaction(async (db) => {
        const wallet = await db.wallet.upsert({
          where: { userId: req.user!.id },
          update: {},
          create: { userId: req.user!.id },
        });
        const held = await db.wallet.updateMany({
          where: { userId: req.user!.id, balance: { gte: data.amount } },
          data: { balance: { decrement: data.amount } },
        });
        if (held.count !== 1) throw new HttpError(400, 'Insufficient wallet balance', 'INSUFFICIENT_BALANCE');

        return db.transaction.create({
          data: {
            userId: req.user!.id,
            type: 'WITHDRAWAL',
            method: data.method,
            amount: data.amount,
            fee,
            netAmount,
            currency: wallet.currency,
            status: 'PENDING',
            reference,
            idempotencyKey,
            destination: data.destination,
            note: 'Manual payout review required; request is not yet paid.',
            statusHistory: {
              create: {
                fromStatus: null,
                toStatus: 'PENDING',
                actorId: req.user!.id,
                actorRole: req.user!.role,
                note: 'Withdrawal submitted; funds held pending payout review.',
              },
            },
          },
        });
      });
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      const duplicate = await prisma.transaction.findUnique({ where: { idempotencyKey } });
      if (!duplicate) throw error;
      if (
        duplicate.userId !== req.user!.id ||
        duplicate.amount !== data.amount ||
        duplicate.method !== data.method ||
        duplicate.destination !== data.destination
      ) {
        throw new HttpError(409, 'This request key was already used for a different withdrawal', 'IDEMPOTENCY_MISMATCH');
      }
      return res.status(200).json({ transaction: duplicate, provider: 'manual', duplicate: true });
    }

    await notifyAdmins({
      title: 'Withdrawal request',
      body: `${req.user!.name} requested ${txn.currency} ${data.amount.toFixed(2)} via ${data.method} (ref ${reference}).`,
      link: '/admin',
    });
    await notify({
      userId: req.user!.id,
      title: 'Withdrawal requested',
      body: `${txn.currency} ${data.amount.toFixed(2)} is on hold pending administrator review.`,
      type: 'PAYMENT',
      link: '/wallet',
    });

    res.status(201).json({ transaction: txn, provider: 'manual', duplicate: false });
  }),
);
