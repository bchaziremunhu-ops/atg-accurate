import cron from 'node-cron';
import { prisma } from '../lib/prisma.js';
import { notify } from '../services/notifications.service.js';

const DAY_MS = 86_400_000;

export async function runMembershipAccessExpiryNotifications(now = new Date()): Promise<void> {
  const accessRecords = await prisma.membershipRoomAccess.findMany({
    where: {
      OR: [
        { expiresAt: { gt: now, lte: new Date(now.getTime() + 3 * DAY_MS) } },
        { expiresAt: { lte: now }, expiryNotices: { none: { milestone: 'EXPIRED' } } },
      ],
    },
    include: {
      user: { select: { id: true } },
      request: { select: { itemTitleSnapshot: true } },
    },
  });

  for (const access of accessRecords) {
    const msLeft = access.expiresAt.getTime() - now.getTime();
    const milestones = msLeft <= 0
      ? ['EXPIRED']
      : [
          ...(msLeft <= 3 * DAY_MS ? ['THREE_DAYS'] : []),
          ...(msLeft <= DAY_MS ? ['ONE_DAY'] : []),
        ];
    const roomName = access.accessLevel === 'VIP_DERIV' ? 'Deriv VIP' : 'Weltrade VIP';

    for (const milestone of milestones) {
      const claim = await prisma.membershipRoomAccessExpiryNotice.createMany({
        data: [{ membershipRoomAccessId: access.id, milestone }],
        skipDuplicates: true,
      });
      if (claim.count === 0) continue;

      try {
        await notify({
          userId: access.user.id,
          title: milestone === 'EXPIRED'
            ? `${roomName} access expired`
            : `${roomName} access expires within ${milestone === 'ONE_DAY' ? '1 day' : '3 days'}`,
          body: milestone === 'EXPIRED'
            ? `Your ${roomName} access for ${access.request.itemTitleSnapshot} has expired. Submit a renewal request to regain access.`
            : `Your ${roomName} access for ${access.request.itemTitleSnapshot} expires on ${access.expiresAt.toDateString()}. Submit a renewal request to keep access.`,
          type: 'SUBSCRIPTION',
          link: '/profile/subscription',
        });
      } catch (error) {
        await prisma.membershipRoomAccessExpiryNotice.deleteMany({
          where: { membershipRoomAccessId: access.id, milestone },
        });
        console.error(`[jobs] membership access ${milestone.toLowerCase()} notification failed for ${access.id}:`, error);
      }
    }
  }
}

/**
 * Subscription lifecycle job.
 * - Warns users 3 days and 1 day before expiry.
 * - Expires memberships whose end date passed and flips isVip off.
 * Runs daily at 08:00 server time.
 */
export function startSubscriptionJobs() {
  cron.schedule('0 8 * * *', async () => {
    try {
      const now = new Date();
      const subs = await prisma.subscription.findMany({ where: { status: 'ACTIVE' } });
      for (const sub of subs) {
        if (sub.provider === 'manual') continue;
        const msLeft = sub.expiresAt.getTime() - now.getTime();
        const daysLeft = Math.ceil(msLeft / 86_400_000);

        if (msLeft <= 0) {
          await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'EXPIRED' } });
          await prisma.user.update({
            where: { id: sub.userId },
            data: { isVip: false, membership: 'FREE', vipExpiresAt: null },
          });
          await notify({
            userId: sub.userId,
            title: 'VIP membership expired',
            body: 'Your VIP subscription has ended. Renew to keep accessing VIP signals.',
            type: 'SUBSCRIPTION',
            link: '/profile/subscription',
          });
        } else if (daysLeft === 3 || daysLeft === 1) {
          await notify({
            userId: sub.userId,
            title: `VIP expires in ${daysLeft} day${daysLeft > 1 ? 's' : ''}`,
            body: `Renew now to avoid losing access to VIP signals on ${sub.expiresAt.toDateString()}.`,
            type: 'SUBSCRIPTION',
            link: '/profile/subscription',
          });
        }
      }
      await runMembershipAccessExpiryNotifications(now);
    } catch (err) {
      console.error('[jobs] subscription expiry failed:', err);
    }
  });
  console.log('[jobs] subscription expiry scheduler started');
}
