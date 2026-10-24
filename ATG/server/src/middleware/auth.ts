import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../lib/jwt.js';
import { prisma } from '../lib/prisma.js';
import {
  canAccess,
  effectiveMembership,
  isAdmin,
  type AccessLevel,
  type Membership,
} from '../lib/permissions.js';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  membership: Membership;
  extraAccessLevels: Membership[];
  isVip: boolean;
  vipExpiresAt: Date | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const payload = verifyAccessToken(header.slice(7));
      const user = await prisma.user.findUnique({ where: { id: payload.sub } });
      if (user) {
        const [subscription, roomAccess] = await Promise.all([
          prisma.subscription.findUnique({ where: { userId: user.id }, select: { provider: true } }),
          prisma.membershipRoomAccess.findMany({
            where: { userId: user.id, startsAt: { lte: new Date() }, expiresAt: { gt: new Date() } },
            select: { accessLevel: true },
            distinct: ['accessLevel'],
          }),
        ]);
        const legacyMembership = effectiveMembership({
          membership: user.membership,
          isVip: user.isVip,
          vipExpiresAt: user.vipExpiresAt,
        });
        const activeRoomLevels = roomAccess
          .map((access) => access.accessLevel)
          .filter((level): level is Membership => ['VIP_DERIV', 'VIP_WELTRADE'].includes(level));
        const accessibleLegacyMembership = subscription?.provider === 'manual' ? 'FREE' : legacyMembership;
        const membership = activeRoomLevels[0] ?? accessibleLegacyMembership;
        const extraAccessLevels = [...new Set([
          ...activeRoomLevels,
          ...(accessibleLegacyMembership === 'FREE' ? [] : [accessibleLegacyMembership]),
        ])].filter((level) => level !== membership);
        req.user = {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          membership,
          extraAccessLevels,
          isVip:
            activeRoomLevels.length > 0 ||
            membership === 'VIP_DERIV' ||
            membership === 'VIP_WELTRADE' ||
            extraAccessLevels.some((level) => level === 'VIP_DERIV' || level === 'VIP_WELTRADE'),
          vipExpiresAt: subscription?.provider === 'manual' && activeRoomLevels.length === 0 ? null : user.vipExpiresAt,
        };
      }
    } catch {
      /* ignore invalid token for optional auth */
    }
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

export function requireAccess(level: AccessLevel) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!canAccess(req.user, level)) {
      return res.status(402).json({ error: `Access denied — ${level} access required`, code: 'UPGRADE_REQUIRED', level });
    }
    next();
  };
}

export function requireVip(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (isAdmin(req.user)) return next();
  if (!req.user.isVip) {
    return res.status(402).json({ error: 'VIP subscription required', code: 'VIP_REQUIRED' });
  }
  next();
}
