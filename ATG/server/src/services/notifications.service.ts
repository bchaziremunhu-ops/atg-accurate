import { prisma } from '../lib/prisma.js';
import { env, integrations } from '../config/env.js';

let webpush: typeof import('web-push') | null = null;
if (integrations.webPush) {
  try {
    // dynamic import so the app still runs without VAPID keys configured
    webpush = await import('web-push');
    webpush.setVapidDetails(env.vapidSubject, env.vapidPublicKey, env.vapidPrivateKey);
  } catch (e) {
    console.warn('[push] web-push unavailable:', (e as Error).message);
  }
}

export interface NotifyInput {
  userId: string;
  title: string;
  body: string;
  type?: string;
  link?: string;
}

/**
 * Creates an in-app notification and (when configured) fans it out to
 * registered Web Push subscriptions. Mobile push (FCM) is delivered by the
 * device layer and requires FCM_SERVER_KEY.
 */
export async function notify({ userId, title, body, type = 'SYSTEM', link }: NotifyInput) {
  const notification = await prisma.notification.create({
    data: { userId, title, body, type, link },
  });

  if (webpush) {
    const subs = await prisma.pushSubscription.findMany({ where: { userId } });
    await Promise.allSettled(
      subs.map((s) =>
        webpush!
          .sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify({ title, body, link, type }),
          )
          .catch(async (err: unknown) => {
            const status = (err as { statusCode?: number }).statusCode;
            if (status === 404 || status === 410) {
              await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
            }
          }),
      ),
    );
  }

  return notification;
}

export async function notifyMany(userIds: string[], input: Omit<NotifyInput, 'userId'>) {
  return Promise.allSettled(userIds.map((userId) => notify({ userId, ...input })));
}

export async function broadcastToVips(input: Omit<NotifyInput, 'userId'>) {
  const vips = await prisma.user.findMany({
    where: { OR: [{ isVip: true }, { role: 'ADMIN' }] },
    select: { id: true },
  });
  return notifyMany(vips.map((v) => v.id), input);
}

export async function broadcastToAll(input: Omit<NotifyInput, 'userId'>) {
  const users = await prisma.user.findMany({ select: { id: true } });
  return notifyMany(users.map((u) => u.id), input);
}

/**
 * Notify exactly the members who can access a given content level.
 * FREE -> everyone; PAID -> PAID + both VIP tiers + admins;
 * VIP_DERIV -> Deriv VIP + admins; VIP_WELTRADE -> Weltrade VIP + admins.
 */
export async function broadcastToAudience(
  level: 'FREE' | 'PAID' | 'VIP_DERIV' | 'VIP_WELTRADE',
  input: Omit<NotifyInput, 'userId'>,
  excludeUserId?: string,
) {
  const now = new Date();
  const activeRoomAccess = {
    startsAt: { lte: now },
    expiresAt: { gt: now },
  };
  const validLegacyMembership = (membership: 'VIP_DERIV' | 'VIP_WELTRADE') => ({
    membership,
    OR: [{ vipExpiresAt: null }, { vipExpiresAt: { gt: now } }],
  });
  const where =
    level === 'FREE'
      ? {}
      : level === 'PAID'
        ? {
            OR: [
              { membership: 'PAID' },
              validLegacyMembership('VIP_DERIV'),
              validLegacyMembership('VIP_WELTRADE'),
              { membershipRoomAccess: { some: { ...activeRoomAccess, accessLevel: { in: ['VIP_DERIV', 'VIP_WELTRADE'] } } } },
              { role: 'ADMIN' },
            ],
          }
        : {
            OR: [
              validLegacyMembership(level),
              { membershipRoomAccess: { some: { ...activeRoomAccess, accessLevel: level } } },
              { role: 'ADMIN' },
            ],
          };

  const users = await prisma.user.findMany({
    where: { AND: [where, ...(excludeUserId ? [{ id: { not: excludeUserId } }] : [])] },
    select: { id: true },
  });
  return notifyMany(users.map((u) => u.id), input);
}
