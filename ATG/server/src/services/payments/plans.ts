import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../middleware/error.js';

export interface SubscriptionPlan {
  id: string;
  title: string;
  price: number;
  months: number;
  membership: 'PAID' | 'VIP_DERIV' | 'VIP_WELTRADE';
  description?: string;
}

export const DEFAULT_PLANS: SubscriptionPlan[] = [
  {
    id: 'VIP_MONTHLY',
    title: 'ATG VIP - Monthly',
    price: 29.99,
    months: 1,
    membership: 'VIP_WELTRADE',
    description: 'One month of ATG VIP access (Weltrade VIP room). An admin can re-assign your room after purchase.',
  },
  {
    id: 'VIP_DERIV_MONTHLY',
    title: 'ATG VIP Deriv - Monthly',
    price: 29.99,
    months: 1,
    membership: 'VIP_DERIV',
    description: 'One month of ATG VIP access (Deriv VIP room).',
  },
];

export const PLANS_SETTING_KEY = 'payments.plans';

export async function getSubscriptionPlans(): Promise<SubscriptionPlan[]> {
  const row = await prisma.setting.findUnique({ where: { key: PLANS_SETTING_KEY } });
  if (!row?.value) return DEFAULT_PLANS;
  try {
    const parsed = JSON.parse(row.value) as SubscriptionPlan[];
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((p) => p && p.id && p.price != null)) {
      return parsed;
    }
  } catch {
    // fall through to defaults
  }
  return DEFAULT_PLANS;
}

export async function resolvePlan(planId?: string | null): Promise<SubscriptionPlan> {
  const plans = await getSubscriptionPlans();
  if (!planId) return plans[0]!;
  const plan = plans.find((p) => p.id === planId);
  if (!plan) throw new HttpError(404, 'Unknown subscription plan');
  return plan;
}
