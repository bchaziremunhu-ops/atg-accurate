import type { BrokerTransaction } from '@prisma/client';
import { nanoid } from 'nanoid';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { getBrokerSettings } from '../../lib/settings.js';
import { HttpError } from '../../middleware/error.js';
import { notify, notifyMany } from '../notifications.service.js';
import { getIo } from '../../realtime/socket.js';
import type { Broker } from './adapters.js';

/**
 * Broker funding lifecycle.
 *
 *   PENDING → UNDER_REVIEW → APPROVED → PROCESSING → COMPLETED
 *                    ↘ REJECTED                ↘ FAILED
 *
 * Invariants enforced here (never only in the UI):
 *
 *  - A WITHDRAWAL must pass UNDER_REVIEW before it can be approved — admin
 *    review is mandatory, never optional.
 *  - PROCESSING → COMPLETED always requires *evidence*: a verified provider
 *    webhook or a recorded reconciliation note/provider reference. There is no
 *    code path that invents a successful transfer.
 *  - Broker money is never written to Wallet/Transaction. Broker ledgers and
 *    the ATG wallet are separate balances on purpose.
 *  - Every transition appends an immutable audit row.
 */

export const FUNDING_STATUSES = ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING', 'COMPLETED', 'REJECTED', 'FAILED'] as const;
export type FundingStatus = (typeof FUNDING_STATUSES)[number];

export const FUNDING_DIRECTIONS = ['DEPOSIT', 'WITHDRAWAL'] as const;
export type FundingDirection = (typeof FUNDING_DIRECTIONS)[number];

export type AuditSource = 'CUSTOMER' | 'ADMIN' | 'PROVIDER' | 'SYSTEM';

const ALLOWED: Record<FundingStatus, FundingStatus[]> = {
  PENDING: ['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'FAILED'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED', 'FAILED'],
  APPROVED: ['PROCESSING', 'REJECTED', 'FAILED'],
  PROCESSING: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  REJECTED: [],
  FAILED: [],
};

export const TERMINAL_STATUSES: FundingStatus[] = ['COMPLETED', 'REJECTED', 'FAILED'];

export function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.includes(status as FundingStatus);
}

export interface FundingLimits {
  currency: string;
  deposit: { min: number; max: number };
  withdrawal: { min: number; max: number; dailyMax: number };
  pendingLimit: number;
  feePct: number;
}

/**
 * Effective limits: env defaults overlaid with admin overrides stored at
 * runtime (Setting table). Admins change these without a redeploy.
 */
export async function fundingLimits(): Promise<FundingLimits> {
  const settings = await getBrokerSettings();
  return {
    currency: env.brokerCurrency,
    deposit: settings.deposit,
    withdrawal: settings.withdrawal,
    pendingLimit: settings.pendingLimit,
    feePct: settings.feePct,
  };
}

/** Fee taken on a deposit at the current rate (rounded to cents). */
export function depositFee(amount: number, feePct: number): number {
  return Math.round(amount * feePct) / 100;
}

export function newFundingReference(direction: FundingDirection): string {
  return `${direction === 'DEPOSIT' ? 'ATG-BD' : 'ATG-BW'}-${nanoid(8).toUpperCase()}`;
}

/** `0771234567` → `0771***567`. Destination details are never listed in full. */
export function maskDestination(value: string | null | undefined): string | null {
  if (!value) return null;
  const clean = value.trim();
  if (clean.length <= 6) return `${clean.slice(0, 1)}***`;
  return `${clean.slice(0, 4)}***${clean.slice(-3)}`;
}

export interface Actor {
  id?: string | null;
  role: 'USER' | 'ADMIN' | 'SYSTEM';
  name?: string | null;
}

export interface AuditInput {
  transactionId?: string | null;
  action: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  source: AuditSource;
  actor: Actor;
  provider?: string | null;
  eventId?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown>;
}

/** Appends an immutable audit row. Rows are never updated or deleted. */
export async function recordAudit(input: AuditInput): Promise<void> {
  await prisma.brokerAuditLog.create({
    data: {
      transactionId: input.transactionId ?? null,
      action: input.action,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
      source: input.source,
      provider: input.provider ?? null,
      eventId: input.eventId ?? null,
      actorId: input.actor.id ?? null,
      actorRole: input.actor.role,
      actorName: input.actor.name ?? null,
      note: input.note ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  });
}

export async function notifyFundingAdmins(input: { title: string; body: string; link?: string }) {
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
  await notifyMany(admins.map((a) => a.id), { ...input, type: 'PAYMENT' });
}

/** Push a realtime nudge to the customer and to every signed-in admin. */
export function emitFundingUpdate(userId: string, payload: Record<string, unknown>) {
  const io = getIo();
  if (!io) return;
  io.to(`user:${userId}`).emit('broker:funding', payload);
  void prisma.user
    .findMany({ where: { role: 'ADMIN' }, select: { id: true } })
    .then((admins) => admins.forEach((a) => io.to(`user:${a.id}`).emit('broker:funding', payload)))
    .catch(() => {});
}

const STATUS_TITLES: Record<FundingStatus, string> = {
  PENDING: 'Broker request submitted',
  UNDER_REVIEW: 'Broker request under review',
  APPROVED: 'Broker request approved',
  PROCESSING: 'Broker request processing',
  COMPLETED: 'Broker request completed',
  REJECTED: 'Broker request rejected',
  FAILED: 'Broker request failed',
};

export interface TransitionInput {
  tx: BrokerTransaction;
  to: FundingStatus;
  action: string;
  actor: Actor;
  source: AuditSource;
  providerRef?: string | null;
  evidence?: string | null;
  evidenceType?: string | null;
  adminNote?: string | null;
  internalNote?: string | null;
  failureReason?: string | null;
  provider?: string | null;
  eventId?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown>;
  /** Set false for silent bookkeeping (webhook retries already notified). */
  notifyCustomer?: boolean;
}

/**
 * The single write path for every broker-funding status change.
 * Validates the transition, updates the row, writes the audit entry and
 * notifies the customer.
 */
export async function applyTransition(input: TransitionInput): Promise<BrokerTransaction> {
  const { tx, to } = input;

  if (isTerminal(tx.status)) throw new HttpError(400, `This request is already ${tx.status.toLowerCase()}`, 'ALREADY_FINAL');
  if (tx.status === to) throw new HttpError(409, `Request is already in ${to}`, 'NOOP');

  const allowed = ALLOWED[tx.status as FundingStatus] ?? [];
  if (!allowed.includes(to)) {
    throw new HttpError(409, `Cannot move from ${tx.status} to ${to}`, 'INVALID_TRANSITION');
  }
  // Withdrawals always require an explicit review step before approval.
  if (tx.direction === 'WITHDRAWAL' && to === 'APPROVED' && tx.status !== 'UNDER_REVIEW') {
    throw new HttpError(409, 'Withdrawals must be reviewed before they can be approved', 'REVIEW_REQUIRED');
  }
  // Money may only be called Completed with evidence in hand.
  if (to === 'COMPLETED' && !input.evidence && !input.providerRef) {
    throw new HttpError(
      400,
      'Completion requires evidence — supply the provider reference or a reconciliation note',
      'EVIDENCE_REQUIRED',
    );
  }

  const now = new Date();
  const updated = await prisma.brokerTransaction.update({
    where: { id: tx.id },
    data: {
      status: to,
      providerRef: input.providerRef ?? tx.providerRef,
      evidence: input.evidence ?? tx.evidence,
      evidenceType: input.evidenceType ?? tx.evidenceType,
      adminNote: input.adminNote ?? tx.adminNote,
      internalNote: input.internalNote ?? tx.internalNote,
      failureReason: input.failureReason ?? tx.failureReason,
      provider: input.provider ?? tx.provider,
      processedById: input.actor.id ?? tx.processedById,
      processedAt: ['APPROVED', 'PROCESSING', 'COMPLETED', 'REJECTED', 'FAILED'].includes(to) ? now : tx.processedAt,
      completedAt: to === 'COMPLETED' ? now : tx.completedAt,
    },
  });

  await recordAudit({
    transactionId: tx.id,
    action: input.action,
    fromStatus: tx.status,
    toStatus: to,
    source: input.source,
    actor: input.actor,
    provider: input.provider ?? null,
    eventId: input.eventId ?? null,
    note: input.note ?? null,
    metadata: {
      ...(input.metadata ?? {}),
      ...(input.providerRef ? { providerRef: input.providerRef } : {}),
      ...(input.evidence ? { evidence: input.evidence } : {}),
      ...(input.failureReason ? { failureReason: input.failureReason } : {}),
      ...(input.adminNote ? { adminNote: input.adminNote } : {}),
    },
  });

  const brokerName = tx.broker === 'DERIV' ? 'Deriv' : 'Weltrade';
  const amount = `${tx.currency} ${tx.amount.toFixed(2)}`;
  const direction = tx.direction === 'DEPOSIT' ? 'deposit' : 'withdrawal';

  if (input.notifyCustomer !== false) {
    const suffix = input.adminNote ? ` — ${input.adminNote}` : input.failureReason ? ` — ${input.failureReason}` : '';
    await notify({
      userId: tx.userId,
      title: STATUS_TITLES[to],
      body: `Your ${brokerName} ${direction} of ${amount} (ref ${tx.reference}) is now ${to.replace('_', ' ').toLowerCase()}${suffix}.`,
      type: 'PAYMENT',
      link: '/broker-funds',
    });
  }

  emitFundingUpdate(tx.userId, { id: tx.id, status: to, direction: tx.direction, broker: tx.broker, reference: tx.reference });

  return updated;
}

/** The happy path, in order. Used when a provider confirmation may skip steps. */
const ORDER: FundingStatus[] = ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING', 'COMPLETED'];

export interface AdvanceOptions {
  actor: Actor;
  source: AuditSource;
  provider?: string | null;
  eventId?: string | null;
  evidence?: string | null;
  evidenceType?: string | null;
  providerRef?: string | null;
  note?: string | null;
  failureReason?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Moves a transaction forward to `target`, applying every intermediate step of
 * the required lifecycle and auditing each one (source PROVIDER / SYSTEM).
 *
 * Used only when there is real evidence to justify the move — a
 * signature-verified webhook. The `eventId` anchor is written on the FINAL
 * step only, so replayed callbacks stay idempotent.
 */
export async function advanceTo(tx: BrokerTransaction, target: 'COMPLETED' | 'FAILED', opts: AdvanceOptions): Promise<BrokerTransaction> {
  let current = tx;

  if (target === 'FAILED') {
    return applyTransition({
      tx: current,
      to: 'FAILED',
      action: 'WEBHOOK_FAILED',
      actor: opts.actor,
      source: opts.source,
      provider: opts.provider,
      eventId: opts.eventId,
      providerRef: opts.providerRef,
      failureReason: opts.failureReason ?? 'Reported as failed by the payment provider',
      note: opts.note,
      metadata: opts.metadata,
    });
  }

  const start = ORDER.indexOf(current.status as FundingStatus);
  if (start === -1) {
    throw new HttpError(409, `Cannot complete a request in ${current.status}`, 'INVALID_TRANSITION');
  }

  const steps = ORDER.slice(start + 1);
  for (const step of steps) {
    const isFinal = step === 'COMPLETED';
    current = await applyTransition({
      tx: current,
      to: step,
      action: isFinal ? 'WEBHOOK_COMPLETED' : `AUTO_${step}`,
      actor: opts.actor,
      source: opts.source,
      provider: opts.provider,
      // Anchor the idempotency key on the final step only.
      eventId: isFinal ? opts.eventId : null,
      evidence: isFinal ? opts.evidence : undefined,
      evidenceType: isFinal ? opts.evidenceType : undefined,
      providerRef: opts.providerRef,
      note: opts.note,
      metadata: opts.metadata,
      notifyCustomer: false,
    });
  }
  return current;
}
