/**
 * Central role / membership model.
 *
 * Roles:       USER | ADMIN
 * Memberships: FREE | PAID | VIP_DERIV | VIP_WELTRADE
 *
 * Content access levels (used by signals, rooms and courses):
 *   FREE          -> any authenticated member
 *   PAID          -> PAID, VIP_DERIV, VIP_WELTRADE (or a verified paid-course purchase)
 *   VIP_DERIV     -> VIP_DERIV only
 *   VIP_WELTRADE  -> VIP_WELTRADE only
 *
 * VIP memberships expire (vipExpiresAt); an expired VIP falls back to FREE.
 */

export type Membership = 'FREE' | 'PAID' | 'VIP_DERIV' | 'VIP_WELTRADE';
export const MEMBERSHIPS: Membership[] = ['FREE', 'PAID', 'VIP_DERIV', 'VIP_WELTRADE'];

export type AccessLevel = 'FREE' | 'PAID' | 'VIP_DERIV' | 'VIP_WELTRADE';

export interface Principal {
  id: string;
  role: string;
  membership: Membership;
  isAdmin?: boolean;
  extraAccessLevels?: AccessLevel[];
}

export function isAdmin(principal: Pick<Principal, 'role'> | undefined | null): boolean {
  return principal?.role === 'ADMIN';
}

/** Resolve the effective membership, applying VIP expiry downgrade. */
export function effectiveMembership(input: {
  membership?: string | null;
  isVip?: boolean;
  vipExpiresAt?: Date | null;
}): Membership {
  const membership = (input.membership as Membership) ?? 'FREE';
  const isVip = membership === 'VIP_DERIV' || membership === 'VIP_WELTRADE';
  if (!isVip) return MEMBERSHIPS.includes(membership) ? membership : 'FREE';
  const expired = input.vipExpiresAt ? input.vipExpiresAt.getTime() < Date.now() : false;
  if (expired) return 'FREE';
  return membership;
}

/** True when the principal may access content at the given level. */
export function canAccess(principal: Principal | undefined | null, level: AccessLevel): boolean {
  if (!principal) return level === 'FREE';
  if (isAdmin(principal)) return true;

  switch (level) {
    case 'FREE':
      return true;
    case 'PAID':
      return principal.membership === 'PAID' || principal.membership === 'VIP_DERIV' || principal.membership === 'VIP_WELTRADE' ||
        Boolean(principal.extraAccessLevels?.some((access) => access === 'VIP_DERIV' || access === 'VIP_WELTRADE'));
    case 'VIP_DERIV':
      return principal.membership === 'VIP_DERIV' || Boolean(principal.extraAccessLevels?.includes('VIP_DERIV'));
    case 'VIP_WELTRADE':
      return principal.membership === 'VIP_WELTRADE' || Boolean(principal.extraAccessLevels?.includes('VIP_WELTRADE'));
    default:
      return false;
  }
}

export function isVipMembership(membership: Membership): boolean {
  return membership === 'VIP_DERIV' || membership === 'VIP_WELTRADE';
}

export const ALL_LEVELS: AccessLevel[] = ['FREE', 'PAID', 'VIP_DERIV', 'VIP_WELTRADE'];

/** Every access level the principal may open (used to filter rooms/signals/posts). */
export function allowedLevels(principal: Principal | undefined | null): AccessLevel[] {
  return ALL_LEVELS.filter((level) => canAccess(principal, level));
}

/**
 * Entitlement for a specific paid course: a verified purchase (status PAID) or
 * an admin grant. VIP membership alone does NOT unlock paid courses.
 */
export async function hasVerifiedPurchase(
  db: { purchase: { findFirst: (args: unknown) => Promise<unknown> } },
  userId: string,
  itemType: 'COURSE' | 'RESOURCE',
  itemId: string,
): Promise<boolean> {
  const found = await db.purchase.findFirst({
    where: { userId, itemType, itemId, status: 'PAID' },
    select: { id: true },
  });
  return Boolean(found);
}

export function accessLabel(level: AccessLevel): string {
  return {
    FREE: 'Free members',
    PAID: 'Paid members',
    VIP_DERIV: 'Deriv VIP',
    VIP_WELTRADE: 'Weltrade VIP',
  }[level];
}
