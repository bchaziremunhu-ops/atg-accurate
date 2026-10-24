import { prisma } from '../lib/prisma.js';
import { env, integrations } from '../config/env.js';

let webpush: typeof import('web-push') | null = null;
if (integrations.webPush) {
  try {
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

export async function notify({ userId, title, body, type = 'SYSTEM', link }: NotifyInput) {
  const notification = await prisma.notification.create({
    data: { userId, title, body, type, link },
  });

  if (webpush) {
    const subs = await prisma.pushSubscription.findMany({
      where: { userId, NOT: { endpoint: { startsWith: 'https://exp.host/--/api/v2/push/send?' } } },
    });
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

  const expoSubs = await prisma.pushSubscription.findMany({
    where: { userId, endpoint: { startsWith: 'https://exp.host/--/api/v2/push/send?' } },
  });
  const expoDelivery = await Promise.allSettled(
    expoSubs.map(async (sub) => {
      const token = new URL(sub.endpoint).searchParams.get('expoPushToken');
      if (!token) return;
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: token, title, body, data: { link, type }, sound: 'default' }),
      });
      if (!response.ok) {
        console.warn(`[push] Expo delivery failed with HTTP ${response.status}`);
        return;
      }
      const result = (await response.json()) as { data?: { status?: string; details?: { error?: string } } | { status?: string; details?: { error?: string } }[] };
      const ticket = Array.isArray(result.data) ? result.data[0] : result.data;
      if (ticket?.details?.error === 'DeviceNotRegistered') {
        await prisma.pushSubscription.delete({ where: { id: sub.id } });
      } else if (ticket?.status === 'error') {
        console.warn(`[push] Expo ticket failed: ${ticket.details?.error ?? 'unknown error'}`);
      }
    }),
  );
  for (const result of expoDelivery) {
    if (result.status === 'rejected') {
      console.warn('[push] Expo request failed:', result.reason instanceof Error ? result.reason.message : String(result.reason));
    }
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
