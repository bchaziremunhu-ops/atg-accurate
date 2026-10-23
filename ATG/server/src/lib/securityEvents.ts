import { prisma } from './prisma.js';

/**
 * Security-event audit trail.
 *
 * Registration, logins (success and failure), every account-recovery step and
 * every password reset are recorded with the actor (when known), the attempted
 * phone number, IP and user agent. Recording must never break the request —
 * an audit failure is logged, not thrown.
 *
 * Nothing private is stored here: no passwords, no security answers, no
 * tokens. `meta` holds only non-sensitive context.
 */

export type SecurityEventType =
  | 'REGISTER'
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'RECOVERY_STARTED'
  | 'RECOVERY_IDENTITY_FAILED'
  | 'RECOVERY_QUESTION_ISSUED'
  | 'RECOVERY_ANSWER_FAILED'
  | 'RECOVERY_LOCKED'
  | 'PASSWORD_RESET'
  | 'PASSWORD_CHANGED'
  | 'SESSIONS_REVOKED';

export interface SecurityEventInput {
  userId?: string | null;
  /** Attempted or owned phone number in E.164 form (may be null). */
  phoneE164?: string | null;
  type: SecurityEventType;
  ip?: string | null;
  userAgent?: string | null;
  meta?: Record<string, unknown>;
}

export async function recordSecurityEvent(input: SecurityEventInput): Promise<void> {
  try {
    await prisma.securityEvent.create({
      data: {
        userId: input.userId ?? null,
        phoneE164: input.phoneE164 ?? null,
        type: input.type,
        ip: input.ip ?? null,
        userAgent: input.userAgent ? input.userAgent.slice(0, 300) : null,
        meta: input.meta ? JSON.stringify(input.meta).slice(0, 1000) : null,
      },
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[security-events] failed to record', input.type, e);
  }
}

/** Client IP + user agent, for the audit trail. */
export function requestActor(req: { ip?: string; headers: Record<string, unknown> }): {
  ip: string | null;
  userAgent: string | null;
} {
  const ua = req.headers['user-agent'];
  return {
    ip: req.ip ?? null,
    userAgent: typeof ua === 'string' ? ua : null,
  };
}
