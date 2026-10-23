import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { nanoid } from 'nanoid';
import sharp from 'sharp';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../middleware/error.js';
import { notify, notifyMany } from './notifications.service.js';

export const VIP_ROOMS = ['VIP_DERIV', 'VIP_WELTRADE'] as const;
export type VipRoom = (typeof VIP_ROOMS)[number];
export type PurchaseRequestStatus = 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

const PAYMENT_METHODS = ['BANK_TRANSFER', 'ECOCASH', 'INNBUCKS', 'ONEMONEY', 'CASH', 'OTHER'] as const;
const allowedImages = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);
const MAX_PROOF_BYTES = 5 * 1024 * 1024;
const sensitiveText = /\b(password|passcode|pin|bank\s+login|online\s+banking\s+credentials)\b/i;

export interface UploadedProof {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

function detectImageMime(buffer: Buffer): string | undefined {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) return 'image/webp';
  return undefined;
}

async function persistProof(proof: UploadedProof): Promise<{ name: string; mime: string; size: number }> {
  if (!allowedImages.has(proof.mimetype) || detectImageMime(proof.buffer) !== proof.mimetype) {
    throw new HttpError(400, 'Payment proof must be a valid JPEG, PNG, or WebP image.');
  }
  if (!proof.size || proof.size !== proof.buffer.length || proof.size > MAX_PROOF_BYTES) {
    throw new HttpError(400, 'Payment proof must be 5 MB or smaller.');
  }
  const expectedFormat = proof.mimetype === 'image/jpeg' ? 'jpeg' : proof.mimetype === 'image/png' ? 'png' : 'webp';
  let sanitizedImage: Buffer;
  try {
    const image = sharp(proof.buffer, { failOn: 'error', limitInputPixels: 40_000_000 });
    const metadata = await image.metadata();
    if (metadata.format !== expectedFormat || !metadata.width || !metadata.height) {
      throw new Error('Unsupported image content.');
    }
    sanitizedImage = await image
      .rotate()
      .toFormat(expectedFormat, expectedFormat === 'jpeg' ? { quality: 90 } : undefined)
      .toBuffer();
  } catch {
    throw new HttpError(400, 'Payment proof must be a complete, readable JPEG, PNG, or WebP image.');
  }
  if (sanitizedImage.length > MAX_PROOF_BYTES) {
    throw new HttpError(400, 'Processed payment proof must be 5 MB or smaller.');
  }
  const name = `${randomUUID()}.${allowedImages.get(proof.mimetype)}`;
  await mkdir(env.purchaseProofDir, { recursive: true });
  await writeFile(path.join(env.purchaseProofDir, name), sanitizedImage, { flag: 'wx', mode: 0o600 });
  return { name, mime: proof.mimetype, size: sanitizedImage.length };
}

function normalizePaymentReference(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
}

function parseRooms(rooms: string): VipRoom[] {
  try {
    const parsed: unknown = JSON.parse(rooms);
    return Array.isArray(parsed) ? parsed.filter((value): value is VipRoom => VIP_ROOMS.includes(value)) : [];
  } catch {
    return [];
  }
}

export async function createPurchaseRequest(
  userId: string,
  input: {
    itemType: 'COURSE' | 'MEMBERSHIP';
    itemId: string;
    amountPaid: number;
    paymentMethod: (typeof PAYMENT_METHODS)[number];
    paymentReference: string;
    paymentDate?: string;
    customerNote?: string;
  },
  proof: UploadedProof | undefined,
) {
  if (!proof) throw new HttpError(400, 'Upload an image of your payment proof.');
  if (!PAYMENT_METHODS.includes(input.paymentMethod)) throw new HttpError(400, 'Select a valid payment method.');
  const paymentReference = normalizePaymentReference(input.paymentReference);
  if (paymentReference.length < 2 || paymentReference.length > 120) {
    throw new HttpError(400, 'Enter a valid transaction or payment reference.');
  }
  if (sensitiveText.test(paymentReference) || sensitiveText.test(input.customerNote ?? '')) {
    throw new HttpError(400, 'Do not include passwords, PINs, or banking login details in purchase records.');
  }
  if (input.paymentDate && new Date(input.paymentDate).getTime() > Date.now()) {
    throw new HttpError(400, 'Payment date cannot be in the future.');
  }

  const [course, membershipPackage, priorPurchase] = await Promise.all([
    input.itemType === 'COURSE' ? prisma.course.findUnique({ where: { id: input.itemId } }) : null,
    input.itemType === 'MEMBERSHIP' ? prisma.membershipPackage.findUnique({ where: { id: input.itemId } }) : null,
    prisma.purchase.findFirst({ where: { providerRef: paymentReference }, select: { id: true } }),
  ]);
  const item = input.itemType === 'COURSE' ? course : membershipPackage;
  if (!item) throw new HttpError(404, 'Selected item was not found.');
  if (item.saleStatus !== 'AVAILABLE') throw new HttpError(409, 'This item is not currently available for purchase.');
  if (input.itemType === 'COURSE' && course!.price <= 0) {
    throw new HttpError(400, 'Free courses do not require a purchase request.');
  }

  const price = new Prisma.Decimal(item.price);
  const paid = new Prisma.Decimal(String(input.amountPaid));
  if (!price.equals(paid)) throw new HttpError(400, 'Amount paid must match the current listed price.');

  const itemTitle = item.title;
  const itemDescription = item.description ?? null;
  const currency = input.itemType === 'COURSE' ? course!.currency : membershipPackage!.currency;
  const durationDays = input.itemType === 'MEMBERSHIP' ? membershipPackage!.durationDays : null;
  const activationRule = input.itemType === 'MEMBERSHIP' ? membershipPackage!.activationRule : null;
  const includedRooms = input.itemType === 'MEMBERSHIP' ? membershipPackage!.includedRooms : null;
  if (input.itemType === 'MEMBERSHIP' && (!durationDays || parseRooms(includedRooms ?? '').length === 0)) {
    throw new HttpError(409, 'This membership package has no valid VIP room or duration configured.');
  }
  const storedProof = await persistProof(proof);

  let request: {
    id: string;
    reference: string;
    itemTitleSnapshot: string;
    status: string;
    createdAt: Date;
    duplicateReference: boolean;
  };
  try {
    request = await prisma.$transaction(async (tx) => {
      const created = await tx.purchaseRequest.create({
        data: {
          reference: `ATG-REQ-${nanoid(10).toUpperCase()}`,
          userId,
          itemType: input.itemType,
          ...(input.itemType === 'COURSE' ? { courseId: item.id } : { membershipPackageId: item.id }),
          itemTitleSnapshot: itemTitle,
          itemDescriptionSnapshot: itemDescription,
          amountSnapshot: price,
          currencySnapshot: currency,
          durationDaysSnapshot: durationDays,
          activationRuleSnapshot: activationRule,
          includedRoomsSnapshot: includedRooms,
          amountPaid: paid,
          paymentMethod: input.paymentMethod,
          paymentReference,
          paymentDate: input.paymentDate ? new Date(input.paymentDate) : null,
          proofStorageName: storedProof.name,
          proofMimeType: storedProof.mime,
          proofSizeBytes: storedProof.size,
          customerNote: input.customerNote?.trim() || null,
          events: {
            create: {
              actorId: userId,
              action: 'SUBMITTED',
              toStatus: 'SUBMITTED',
              details: JSON.stringify({ paymentReference }),
            },
          },
        },
      });
      const claim = await tx.paymentReferenceClaim.createMany({
        data: [{ reference: paymentReference, requestId: created.id }],
        skipDuplicates: true,
      });
      const duplicateReference = claim.count === 0 || Boolean(priorPurchase);
      if (duplicateReference) {
        await tx.purchaseRequest.update({ where: { id: created.id }, data: { duplicateReference: true } });
      }
      await tx.purchaseRequestEvent.updateMany({
        where: { requestId: created.id, action: 'SUBMITTED' },
        data: { details: JSON.stringify({ paymentReference, duplicateReference }) },
      });
      return tx.purchaseRequest.findUniqueOrThrow({
        where: { id: created.id },
        select: { id: true, reference: true, itemTitleSnapshot: true, status: true, createdAt: true, duplicateReference: true },
      });
    });
  } catch (error) {
    await rm(path.join(env.purchaseProofDir, storedProof.name), { force: true });
    throw error;
  }
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
  await notifyMany(admins.map((admin) => admin.id), {
    title: request.duplicateReference ? 'Purchase request needs reference review' : 'Purchase request submitted',
    body: `${request.reference}: ${request.itemTitleSnapshot}${request.duplicateReference ? ' — payment reference was used before.' : ''}`,
    type: 'PAYMENT',
    link: '/admin',
  });
  await notify({
    userId,
    title: 'Purchase request submitted',
    body: `Request ${request.reference} was submitted. Access is granted only after an administrator verifies payment.`,
    type: 'PAYMENT',
    link: '/profile/purchases',
  });
  return request;
}

export async function decidePurchaseRequest(
  requestId: string,
  adminId: string,
  input: {
    action: 'UNDER_REVIEW' | 'APPROVE' | 'REJECT';
    reason?: string;
    customerMessage?: string;
    internalNotes?: string;
    paymentChecked?: boolean;
    duplicateReferenceResolved?: boolean;
  },
) {
  if (input.action === 'REJECT' && !input.reason?.trim()) {
    throw new HttpError(400, 'A reason is required when rejecting a request.');
  }
  if ([input.reason, input.customerMessage, input.internalNotes].some((value) => value && sensitiveText.test(value))) {
    throw new HttpError(400, 'Do not include passwords, PINs, or banking login details in purchase records.');
  }

  const result = await prisma.$transaction(async (tx) => {
    const request = await tx.purchaseRequest.findUnique({
      where: { id: requestId },
      include: { user: true },
    });
    if (!request) throw new HttpError(404, 'Purchase request not found.');
    if (request.status !== 'SUBMITTED' && request.status !== 'UNDER_REVIEW') {
      throw new HttpError(409, 'This purchase request has already been decided or cancelled.');
    }

    if (input.action === 'APPROVE') {
      if (input.paymentChecked !== true) throw new HttpError(400, 'Confirm that payment was independently checked and received.');
      if (request.duplicateReference && input.duplicateReferenceResolved !== true) {
        throw new HttpError(409, 'This payment reference was used before. Investigate and explicitly resolve the duplicate before approval.');
      }
      if (request.duplicateReference && !input.internalNotes?.trim()) {
        throw new HttpError(400, 'Record the duplicate-reference investigation in internal notes before approval.');
      }
    }

    const nextStatus: PurchaseRequestStatus =
      input.action === 'UNDER_REVIEW' ? 'UNDER_REVIEW' : input.action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const updatedCount = await tx.purchaseRequest.updateMany({
      where: { id: requestId, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } },
      data: {
        status: nextStatus,
        reviewerId: adminId,
        decisionAt: new Date(),
        decisionReason: input.reason?.trim() || null,
        customerMessage: input.customerMessage?.trim() || null,
        internalNotes: input.internalNotes?.trim() || null,
        ...(input.action === 'APPROVE' ? { approvalReference: request.reference } : {}),
        ...(request.duplicateReference && input.duplicateReferenceResolved ? { duplicateReference: false } : {}),
      },
    });
    if (updatedCount.count !== 1) throw new HttpError(409, 'This purchase request has already been changed.');

    if (input.action === 'APPROVE') {
      const purchase = await tx.purchase.create({
        data: {
          userId: request.userId,
          itemType: request.itemType === 'COURSE' ? 'COURSE' : 'SUBSCRIPTION',
          itemId: request.courseId ?? request.membershipPackageId!,
          itemTitle: request.itemTitleSnapshot,
          amount: Number(request.amountSnapshot),
          currency: request.currencySnapshot,
          status: 'PAID',
          provider: 'manual',
          providerRef: request.reference,
          method: request.paymentMethod,
          proofNote: `Manual purchase request ${request.reference}`,
          verifiedById: adminId,
          verifiedAt: new Date(),
        },
      });
      await tx.purchaseRequest.update({ where: { id: requestId }, data: { purchaseId: purchase.id } });

      if (request.itemType === 'COURSE' && request.courseId) {
        await tx.enrollment.upsert({
          where: { userId_courseId: { userId: request.userId, courseId: request.courseId } },
          update: {},
          create: { userId: request.userId, courseId: request.courseId },
        });
      }

      if (request.itemType === 'MEMBERSHIP') {
        const rooms = parseRooms(request.includedRoomsSnapshot ?? '');
        const durationDays = request.durationDaysSnapshot ?? 0;
        if (rooms.length === 0 || durationDays < 1) throw new HttpError(409, 'Membership snapshot is missing its duration or VIP rooms.');
        const activationRule = request.activationRuleSnapshot ?? 'APPROVAL';
        const now = new Date();
        const currentSubscription = await tx.subscription.findUnique({ where: { userId: request.userId } });
        const legacyMembership = VIP_ROOMS.find((room) => room === request.user.membership);
        const hasActiveLegacyMembership =
          currentSubscription?.provider !== 'manual' &&
          legacyMembership !== undefined &&
          (!request.user.vipExpiresAt || request.user.vipExpiresAt > now);
        const legacyExpiry =
          request.user.vipExpiresAt ??
          (currentSubscription?.provider !== 'manual' &&
          currentSubscription?.status === 'ACTIVE' &&
          currentSubscription.expiresAt > now
            ? currentSubscription.expiresAt
            : null);

        for (const room of rooms) {
          const existing = await tx.membershipRoomAccess.findFirst({
            where: { userId: request.userId, accessLevel: room, expiresAt: { gt: new Date() } },
            orderBy: { expiresAt: 'desc' },
          });
          if (activationRule === 'AFTER_CURRENT_ACCESS' && room === legacyMembership && hasActiveLegacyMembership && !legacyExpiry) {
            throw new HttpError(409, 'Current VIP access has no expiry date, so this renewal cannot be scheduled safely.');
          }
          const currentExpiry = Math.max(
            existing?.expiresAt.getTime() ?? 0,
            room === legacyMembership && hasActiveLegacyMembership ? legacyExpiry?.getTime() ?? 0 : 0,
          );
          const startsAt =
            activationRule === 'AFTER_CURRENT_ACCESS' && currentExpiry > now.getTime()
              ? new Date(currentExpiry)
              : now;
          const expiresAt = new Date(startsAt.getTime() + durationDays * 86_400_000);
          await tx.membershipRoomAccess.create({
            data: {
              userId: request.userId,
              requestId,
              accessLevel: room,
              startsAt,
              expiresAt,
              approvalReference: request.reference,
            },
          });
        }
        const validAccess = await tx.membershipRoomAccess.findMany({
          where: { userId: request.userId, expiresAt: { gt: new Date() } },
          select: { startsAt: true, expiresAt: true },
        });
        const preferredRoom = rooms[0]!;
        const membership = preferredRoom;
        const latestExpiry = new Date(Math.max(...validAccess.map((row) => row.expiresAt.getTime())));
        const firstStart = new Date(Math.min(...validAccess.map((row) => row.startsAt.getTime())));
        if (!hasActiveLegacyMembership) {
          await tx.user.update({
            where: { id: request.userId },
            data: { membership, isVip: true, vipExpiresAt: latestExpiry },
          });
          await tx.subscription.upsert({
            where: { userId: request.userId },
            update: {
              status: 'ACTIVE',
              plan: request.itemTitleSnapshot,
              startedAt: firstStart,
              expiresAt: latestExpiry,
              autoRenew: false,
              provider: 'manual',
              providerRef: request.reference,
            },
            create: {
              userId: request.userId,
              status: 'ACTIVE',
              plan: request.itemTitleSnapshot,
              startedAt: firstStart,
              expiresAt: latestExpiry,
              autoRenew: false,
              provider: 'manual',
              providerRef: request.reference,
            },
          });
        }
      }

      await tx.receipt.create({
        data: {
          receiptNumber: `ATG-RCPT-${nanoid(8).toUpperCase()}`,
          purchaseId: purchase.id,
          userId: request.userId,
          itemTitle: request.itemTitleSnapshot,
          itemType: request.itemType,
          amount: request.amountSnapshot,
          currency: request.currencySnapshot,
          method: request.paymentMethod,
          paidAt: new Date(),
        },
      });
    }

    await tx.purchaseRequestEvent.create({
      data: {
        requestId,
        actorId: adminId,
        action: input.action,
        fromStatus: request.status,
        toStatus: nextStatus,
        reason: input.reason?.trim() || null,
        customerMessage: input.customerMessage?.trim() || null,
        internalNotes: input.internalNotes?.trim() || null,
        details: JSON.stringify({
          paymentChecked: input.paymentChecked === true,
          duplicateReferenceResolved: input.duplicateReferenceResolved === true,
          amountSnapshot: request.amountSnapshot.toString(),
        }),
      },
    });

    return tx.purchaseRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: { events: { orderBy: { createdAt: 'desc' } } },
    });
  });
  await notify({
    userId: result.userId,
    title: input.action === 'APPROVE'
      ? 'Purchase approved'
      : input.action === 'REJECT'
        ? 'Purchase request rejected'
        : 'Purchase request under review',
    body: input.customerMessage?.trim() || (
      input.action === 'APPROVE'
        ? `Payment verified. Access to "${result.itemTitleSnapshot}" is now active.`
        : input.action === 'REJECT'
          ? `Request ${result.reference} was rejected.${input.reason ? ` Reason: ${input.reason.trim()}` : ''}`
          : `An administrator is reviewing request ${result.reference}.`
    ),
    type: 'PAYMENT',
    link: '/profile/purchases',
  });
  return result;
}

export async function cancelPurchaseRequest(userId: string, requestId: string) {
  return prisma.$transaction(async (tx) => {
    const request = await tx.purchaseRequest.findFirst({
      where: { id: requestId, userId },
      select: { status: true },
    });
    if (!request || (request.status !== 'SUBMITTED' && request.status !== 'UNDER_REVIEW')) {
      throw new HttpError(409, 'Request cannot be cancelled; it may already be decided or not belong to you.');
    }
    const changed = await tx.purchaseRequest.updateMany({
      where: { id: requestId, userId, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } },
      data: { status: 'CANCELLED', decisionAt: new Date() },
    });
    if (changed.count !== 1) throw new HttpError(409, 'Request cannot be cancelled; it may already be decided or not belong to you.');
    await tx.purchaseRequestEvent.create({
      data: { requestId, actorId: userId, action: 'CANCELLED', fromStatus: request.status, toStatus: 'CANCELLED' },
    });
    return tx.purchaseRequest.findUniqueOrThrow({ where: { id: requestId } });
  });
}
