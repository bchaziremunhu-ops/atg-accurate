import { z } from 'zod';
import { prisma } from './prisma.js';
import { env } from '../config/env.js';
import { HttpError } from '../middleware/error.js';


const KEY = 'brokerFunding';

export const brokerPatchSchema = z
  .object({
    deposit: z.object({ min: z.number().positive(), max: z.number().positive() }).partial().optional(),
    withdrawal: z
      .object({ min: z.number().positive(), max: z.number().positive(), dailyMax: z.number().positive() })
      .partial()
      .optional(),
    pendingLimit: z.number().int().min(1).max(50).optional(),
    feePct: z.number().min(0).max(100).optional(),
  })
  .strict();

export type BrokerPatch = z.infer<typeof brokerPatchSchema>;

export interface BrokerSettings {
  deposit: { min: number; max: number };
  withdrawal: { min: number; max: number; dailyMax: number };
  pendingLimit: number;
  feePct: number;
}

function envDefaults(): BrokerSettings {
  return {
    deposit: { min: env.brokerDepositMin, max: env.brokerDepositMax },
    withdrawal: { min: env.brokerWithdrawalMin, max: env.brokerWithdrawalMax, dailyMax: env.brokerWithdrawalDailyMax },
    pendingLimit: env.brokerPendingLimit,
    feePct: env.brokerDepositFeePct,
  };
}

function merge(base: BrokerSettings, patch: BrokerPatch): BrokerSettings {
  return {
    deposit: { ...base.deposit, ...(patch.deposit ?? {}) },
    withdrawal: { ...base.withdrawal, ...(patch.withdrawal ?? {}) },
    pendingLimit: patch.pendingLimit ?? base.pendingLimit,
    feePct: patch.feePct ?? base.feePct,
  };
}

function validateEffective(s: BrokerSettings): void {
  if (s.deposit.min >= s.deposit.max) {
    throw new HttpError(400, 'Deposit minimum must be lower than the deposit maximum', 'INVALID_SETTINGS');
  }
  if (s.withdrawal.min >= s.withdrawal.max) {
    throw new HttpError(400, 'Withdrawal minimum must be lower than the withdrawal maximum', 'INVALID_SETTINGS');
  }
}

let patchCache: BrokerPatch | null = null;

async function loadPatch(): Promise<BrokerPatch> {
  if (patchCache) return patchCache;
  try {
    const row = await prisma.setting.findUnique({ where: { key: KEY } });
    if (!row) {
      patchCache = {};
      return patchCache;
    }
    const parsed = brokerPatchSchema.safeParse(JSON.parse(row.value));
    patchCache = parsed.success ? parsed.data : {};
  } catch {
    patchCache = {};
  }
  return patchCache;
}

export async function getBrokerSettings(): Promise<BrokerSettings> {
  return merge(envDefaults(), await loadPatch());
}

export async function updateBrokerSettings(input: BrokerPatch, actorId?: string | null): Promise<BrokerSettings> {
  const parsed = brokerPatchSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, 'Invalid broker settings', 'INVALID_SETTINGS');

  const existing = await loadPatch();
  const d = parsed.data;
  const toStore: BrokerPatch = {
    deposit:
      d.deposit || existing.deposit
        ? { ...(existing.deposit ?? {}), ...(d.deposit ?? {}) }
        : undefined,
    withdrawal:
      d.withdrawal || existing.withdrawal
        ? { ...(existing.withdrawal ?? {}), ...(d.withdrawal ?? {}) }
        : undefined,
    pendingLimit: d.pendingLimit ?? existing.pendingLimit,
    feePct: d.feePct ?? existing.feePct,
  };
  if (!toStore.deposit) delete toStore.deposit;
  if (!toStore.withdrawal) delete toStore.withdrawal;
  if (toStore.pendingLimit === undefined) delete toStore.pendingLimit;
  if (toStore.feePct === undefined) delete toStore.feePct;

  const effective = merge(envDefaults(), toStore);
  validateEffective(effective);

  await prisma.setting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: JSON.stringify(toStore), updatedById: actorId ?? null },
    update: { value: JSON.stringify(toStore), updatedById: actorId ?? null },
  });
  patchCache = toStore;
  return effective;
}

export function resetSettingsCache(): void {
  patchCache = null;
}
