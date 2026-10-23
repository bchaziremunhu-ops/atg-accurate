import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export interface JwtPayload {
  sub: string;
  role: string;
  isVip: boolean;
}

/**
 * Re-signing a *verified* token must not carry over its timing claims —
 * `jwt.sign` rejects a payload that already has `exp`/`iat`.
 */
function claims(payload: JwtPayload): JwtPayload {
  return { sub: payload.sub, role: payload.role, isVip: payload.isVip };
}

export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(claims(payload), env.jwtSecret, { expiresIn: env.accessTokenTtl } as jwt.SignOptions);
}

export function signRefreshToken(payload: JwtPayload): string {
  // `jti` makes every refresh token unique even for the same user/payload in
  // the same second — without it rotation can mint a byte-identical token.
  return jwt.sign({ ...claims(payload), jti: crypto.randomUUID() }, env.jwtRefreshSecret, {
    expiresIn: env.refreshTokenTtl,
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, env.jwtSecret) as JwtPayload;
}

export function verifyRefreshToken(token: string): JwtPayload {
  return jwt.verify(token, env.jwtRefreshSecret) as JwtPayload;
}
