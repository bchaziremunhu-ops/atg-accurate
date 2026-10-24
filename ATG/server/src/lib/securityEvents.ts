import { prisma } from './prisma.js';


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
    console.warn('[security-events] failed to record', input.type, e);
  }
}

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
