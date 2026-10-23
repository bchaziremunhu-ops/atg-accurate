import { prisma } from './prisma.js';

/**
 * Failed-attempt throttling for account recovery.
 *
 * Each failed recovery check against a real account increments a counter on
 * that user row; too many failures temporarily locks recovery for the account
 * (independent of any per-IP rate limit, so a botnet or a shared NAT cannot
 * grind through it either). A successful reset clears the counter.
 */

const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60_000;

export function isRecoveryLocked(user: { recoveryLockedUntil: Date | null }): boolean {
  return Boolean(user.recoveryLockedUntil && user.recoveryLockedUntil.getTime() > Date.now());
}

export function recoveryLockRemainingMs(user: { recoveryLockedUntil: Date | null }): number {
  if (!user.recoveryLockedUntil) return 0;
  return Math.max(0, user.recoveryLockedUntil.getTime() - Date.now());
}

/** Records a failed recovery check; locks the account once the cap is hit. */
export async function recordRecoveryFailure(userId: string): Promise<{ locked: boolean }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { recoveryAttempts: true },
  });
  if (!user) return { locked: false };
  const attempts = user.recoveryAttempts + 1;
  const locked = attempts >= MAX_ATTEMPTS;
  await prisma.user.update({
    where: { id: userId },
    data: {
      recoveryAttempts: locked ? 0 : attempts,
      recoveryLockedUntil: locked ? new Date(Date.now() + LOCK_MS) : null,
    },
  });
  return { locked };
}

/** Clears the throttle after a successful recovery (or password change). */
export async function clearRecoveryFailures(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { recoveryAttempts: 0, recoveryLockedUntil: null },
  });
}
