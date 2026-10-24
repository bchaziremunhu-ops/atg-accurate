import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { prisma } from './prisma.js';
import { signRefreshToken, type JwtPayload } from './jwt.js';


const GRACE_MS = 30_000;

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function ttlToExpiry(ttl: string): Date {
  const match = /^(\d+)\s*([smhd])$/i.exec(ttl.trim());
  const amount = match ? Number(match[1]) : 30;
  const unit = (match?.[2] ?? 'd').toLowerCase();
  const ms = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit as 's' | 'm' | 'h' | 'd'];
  return new Date(Date.now() + amount * ms);
}

export async function issueSession(payload: JwtPayload): Promise<string> {
  const token = signRefreshToken(payload);
  await prisma.user.update({
    where: { id: payload.sub },
    data: {
      refreshTokenHash: sha256(token),
      refreshTokenPrevHash: null,
      refreshTokenExpiresAt: ttlToExpiry(env.refreshTokenTtl),
      refreshTokenRotatedAt: new Date(),
      refreshTokenRevokedAt: null,
    },
  });
  return token;
}

export type RotateResult = { ok: true; token: string } | { ok: false; reason: 'invalid' | 'revoked' };

export async function rotateSession(token: string, payload: JwtPayload): Promise<RotateResult> {
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) return { ok: false, reason: 'invalid' };
  if (user.refreshTokenExpiresAt && user.refreshTokenExpiresAt.getTime() < Date.now()) {
    return { ok: false, reason: 'revoked' };
  }

  const presented = sha256(token);
  if (!user.refreshTokenHash) {
    if (user.refreshTokenRevokedAt) return { ok: false, reason: 'revoked' };
  } else if (user.refreshTokenHash !== presented) {
    const withinGrace =
      Boolean(user.refreshTokenPrevHash) &&
      user.refreshTokenPrevHash === presented &&
      Boolean(user.refreshTokenRotatedAt) &&
      Date.now() - user.refreshTokenRotatedAt!.getTime() < GRACE_MS;
    if (!withinGrace) {
      await revokeSession(payload.sub);
      return { ok: false, reason: 'revoked' };
    }
  }

  const next = signRefreshToken(payload);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      refreshTokenHash: sha256(next),
      refreshTokenPrevHash: user.refreshTokenHash ?? null,
      refreshTokenExpiresAt: ttlToExpiry(env.refreshTokenTtl),
      refreshTokenRotatedAt: new Date(),
    },
  });
  return { ok: true, token: next };
}

export async function revokeSession(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      refreshTokenHash: null,
      refreshTokenPrevHash: null,
      refreshTokenExpiresAt: null,
      refreshTokenRotatedAt: null,
      refreshTokenRevokedAt: new Date(),
    },
  });
}
