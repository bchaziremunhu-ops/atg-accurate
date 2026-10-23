import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../middleware/error.js';
import { notify, notifyMany } from '../notifications.service.js';
import { nanoid } from 'nanoid';

/**
 * Purchase fulfilment and refund workflows for courses, resources and
 * memberships. Paid checkouts remain unavailable until a payment provider is
 * configured; purchases are never marked PAID without verification.
 */

async function auditPaymentEvent(entry: {
  action: string;
  source: string;
  purchaseId?: string;
  paymentId?: string;
  refundId?: string;
  actorId?: string;
  actorRole?: string;
  note?: string;
}) {
  await prisma.paymentAuditLog.create({ data: entry });
}

/**
 * Grant entitlements after a verified payment or an admin verification action.
 *
 * Receipts are issued on the first PAID transition. For subscriptions the
 * existing expiry is EXTENDED (renewal) instead of being reset — there is
 * exactly one Subscription row per user, never duplicates.
 */
export async function fulfilPurchase(
  purchaseId: string,
  verifiedById?: string,
  opts?: { planId?: string; months?: number; membership?: 'PAID' | 'VIP_DERIV' | 'VIP_WELTRADE' },
) {
  const purchase = await prisma.purchase.findUnique({ where: { id: purchaseId } });
  if (!purchase || purchase.status === 'PAID') return purchase;

  const updated = await prisma.purchase.update({
    where: { id: purchase.id },
    data: { status: 'PAID', verifiedById: verifiedById ?? null, verifiedAt: new Date() },
  });

  if (purchase.itemType === 'COURSE') {
    await prisma.enrollment.upsert({
      where: { userId_courseId: { userId: purchase.userId, courseId: purchase.itemId } },
      update: {},
      create: { userId: purchase.userId, courseId: purchase.itemId },
    });
  }

  if (purchase.itemType === 'SUBSCRIPTION') {
    // A verified subscription payment either RENEWS the existing membership
    // (extend from the current expiry) or starts a new one. The tier defaults
    // to the Weltrade VIP track; an admin can re-assign the room afterwards.
    const months = Math.max(1, opts?.months ?? 1);
    const membership = opts?.membership ?? 'VIP_WELTRADE';
    const planId = opts?.planId ?? 'VIP_MONTHLY';
    const existing = await prisma.subscription.findUnique({ where: { userId: purchase.userId } });
    const now = new Date();
    let expiresAt: Date;
    if (existing && existing.status === 'ACTIVE' && existing.expiresAt.getTime() > now.getTime()) {
      expiresAt = new Date(existing.expiresAt);
      expiresAt.setMonth(expiresAt.getMonth() + months);
    } else {
      expiresAt = new Date(now);
      expiresAt.setMonth(expiresAt.getMonth() + months);
    }
    await prisma.subscription.upsert({
      where: { userId: purchase.userId },
      update: { status: 'ACTIVE', expiresAt, plan: planId, provider: purchase.provider },
      create: {
        userId: purchase.userId,
        plan: planId,
        status: 'ACTIVE',
        expiresAt,
        startedAt: now,
        provider: purchase.provider,
      },
    });
    await prisma.user.update({
      where: { id: purchase.userId },
      data: { isVip: true, membership, vipExpiresAt: expiresAt },
    });
  }

  // One receipt per purchase, issued once (unique purchaseId guards retries).
  await prisma.receipt.createMany({
    data: [
      {
        receiptNumber: `ATG-RCPT-${nanoid(8).toUpperCase()}`,
        purchaseId: purchase.id,
        userId: purchase.userId,
        itemTitle: purchase.itemTitle,
        itemType: purchase.itemType,
        amount: purchase.amount,
        currency: purchase.currency,
        method: purchase.method,
        paidAt: new Date(),
      },
    ],
    skipDuplicates: true,
  });

  await notify({
    userId: purchase.userId,
    title: 'Payment confirmed',
    body: `Your purchase "${purchase.itemTitle}" was verified successfully.`,
    type: 'PAYMENT',
    link: '/profile/purchases',
  });

  return updated;
}

/**
 * Revoke what a purchase granted when a refund is completed.
 */
export async function revokePurchaseAccess(purchaseId: string) {
  const purchase = await prisma.purchase.findUnique({ where: { id: purchaseId } });
  if (!purchase) return;

  if (purchase.itemType === 'COURSE') {
    await prisma.enrollment.deleteMany({ where: { userId: purchase.userId, courseId: purchase.itemId } });
  }

  if (purchase.itemType === 'SUBSCRIPTION') {
    const sub = await prisma.subscription.findUnique({ where: { userId: purchase.userId } });
    if (sub) {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { status: 'EXPIRED', autoRenew: false, expiresAt: new Date() },
      });
    }
    await prisma.user.update({
      where: { id: purchase.userId },
      data: { isVip: false, membership: 'FREE', vipExpiresAt: null },
    });
  }
}

export async function requestRefund(userId: string, purchaseId: string, reason: string) {
  const purchase = await prisma.purchase.findUnique({ where: { id: purchaseId } });
  if (!purchase || purchase.userId !== userId) throw new HttpError(404, 'Purchase not found');
  if (purchase.status !== 'PAID') throw new HttpError(400, 'Only paid purchases can be refunded');

  const open = await prisma.refund.findFirst({
    where: { purchaseId, status: { in: ['REQUESTED', 'APPROVED'] } },
  });
  if (open) throw new HttpError(409, 'A refund is already in progress for this purchase');

  const refund = await prisma.refund.create({
    data: {
      purchaseId,
      userId,
      amount: purchase.amount,
      currency: purchase.currency,
      reason,
      requestedById: userId,
    },
  });
  await auditPaymentEvent({
    action: 'REFUND_REQUESTED',
    source: 'USER',
    purchaseId,
    refundId: refund.id,
    actorId: userId,
    actorRole: 'USER',
    note: reason,
  });
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
  await notifyMany(
    admins.map((admin) => admin.id),
    {
      title: 'Refund requested',
      body: `A refund of ${purchase.currency} ${purchase.amount.toFixed(2)} was requested for "${purchase.itemTitle}".`,
      type: 'PAYMENT',
      link: '/admin',
    },
  );
  return refund;
}

export async function adminRefundAction(
  refundId: string,
  action: 'APPROVE' | 'REJECT' | 'COMPLETE' | 'FAIL',
  adminId: string,
  extra: { reason?: string; providerRef?: string },
) {
  const refund = await prisma.refund.findUnique({ where: { id: refundId }, include: { purchase: true } });
  if (!refund) throw new HttpError(404, 'Refund not found');

  if (action === 'APPROVE' || action === 'REJECT') {
    if (refund.status !== 'REQUESTED') {
      throw new HttpError(400, `Only requested refunds can be ${action === 'APPROVE' ? 'approved' : 'rejected'}`);
    }
    const approved = action === 'APPROVE';
    const updated = await prisma.refund.update({
      where: { id: refundId },
      data: {
        status: approved ? 'APPROVED' : 'REJECTED',
        processedById: adminId,
        processedAt: new Date(),
        adminNote: extra.reason ?? null,
      },
    });
    await auditPaymentEvent({
      action: approved ? 'REFUND_APPROVED' : 'REFUND_REJECTED',
      source: 'ADMIN',
      purchaseId: refund.purchaseId,
      refundId,
      actorId: adminId,
      actorRole: 'ADMIN',
      note: extra.reason,
    });
    await notify({
      userId: refund.userId,
      title: approved ? 'Refund approved' : 'Refund not approved',
      body: approved
        ? `Your refund for "${refund.purchase.itemTitle}" was approved and is being processed.`
        : `Your refund for "${refund.purchase.itemTitle}" was not approved.${extra.reason ? ` ${extra.reason}` : ''}`,
      type: 'PAYMENT',
      link: '/profile/purchases',
    });
    return updated;
  }

  if (action === 'COMPLETE') {
    if (refund.status !== 'APPROVED' && refund.status !== 'REQUESTED') {
      throw new HttpError(400, 'Only approved refunds can be completed');
    }
    const providerRef = extra.providerRef?.trim();
    if (!providerRef) throw new HttpError(400, 'Record the refund provider reference first');
    const updated = await prisma.refund.update({
      where: { id: refundId },
      data: {
        status: 'COMPLETED',
        processedById: adminId,
        processedAt: new Date(),
        providerRef,
        adminNote: extra.reason ?? refund.adminNote,
      },
    });
    await prisma.purchase.update({ where: { id: refund.purchaseId }, data: { status: 'REFUNDED' } });
    await revokePurchaseAccess(refund.purchaseId);
    await auditPaymentEvent({
      action: 'REFUND_COMPLETED',
      source: 'ADMIN',
      purchaseId: refund.purchaseId,
      refundId,
      actorId: adminId,
      actorRole: 'ADMIN',
      note: `providerRef=${providerRef}`,
    });
    await notify({
      userId: refund.userId,
      title: 'Refund completed',
      body: `Your refund for "${refund.purchase.itemTitle}" (${refund.currency} ${Number(refund.amount).toFixed(2)}) has been completed.`,
      type: 'PAYMENT',
      link: '/profile/purchases',
    });
    return updated;
  }

  if (refund.status !== 'APPROVED') throw new HttpError(400, 'Only approved refunds can be marked failed');
  const updated = await prisma.refund.update({
    where: { id: refundId },
    data: { status: 'FAILED', processedById: adminId, processedAt: new Date(), adminNote: extra.reason ?? null },
  });
  await auditPaymentEvent({
    action: 'REFUND_FAILED',
    source: 'ADMIN',
    purchaseId: refund.purchaseId,
    refundId,
    actorId: adminId,
    actorRole: 'ADMIN',
    note: extra.reason,
  });
  return updated;
}
