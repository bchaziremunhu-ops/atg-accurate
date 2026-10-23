import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, validate } from '../lib/http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { HttpError } from '../middleware/error.js';
import { cancelPurchaseRequest, createPurchaseRequest, decidePurchaseRequest, VIP_ROOMS } from '../services/purchaseRequests.service.js';

export const purchaseRequestRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 10 },
  fileFilter: (_req, file, callback) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      callback(new HttpError(400, 'Proof must be a JPEG, PNG, or WebP image.'));
      return;
    }
    callback(null, true);
  },
});
const uploadProof: RequestHandler = (req, res, next) => {
  upload.single('proof')(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      next(new HttpError(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, 'Invalid payment proof upload.'));
      return;
    }
    next(error);
  });
};
const purchaseInput = z.object({
  itemType: z.enum(['COURSE', 'MEMBERSHIP']),
  itemId: z.string().min(1).max(100),
  amountPaid: z.coerce.number().finite().positive().max(1_000_000),
  paymentMethod: z.enum(['BANK_TRANSFER', 'ECOCASH', 'INNBUCKS', 'ONEMONEY', 'CASH', 'OTHER']),
  paymentReference: z.string().trim().min(2).max(120),
  paymentDate: z.string().optional().refine((value) => !value || Number.isFinite(Date.parse(value)), 'Invalid payment date'),
  customerNote: z.string().max(1000).optional(),
});
const saleStatus = z.enum(['AVAILABLE', 'UNAVAILABLE', 'HIDDEN', 'SOLD_OUT']);
const packageSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100),
  title: z.string().trim().min(2).max(120),
  description: z.string().max(3000).nullable().optional(),
  price: z.coerce.number().finite().positive().max(1_000_000),
  currency: z.string().trim().regex(/^[A-Z]{3}$/).default('USD'),
  durationDays: z.coerce.number().int().min(1).max(3650),
  activationRule: z.enum(['APPROVAL', 'AFTER_CURRENT_ACCESS']).default('APPROVAL'),
  includedRooms: z.array(z.enum(VIP_ROOMS)).min(1).max(2),
  saleStatus: saleStatus.default('AVAILABLE'),
});
const sensitiveText = /\b(password|passcode|pin|bank\s+login|online\s+banking\s+credentials)\b/i;
const instructionSchema = z.object({
  instructions: z.string().trim().min(10).max(5000).refine((value) => !sensitiveText.test(value), 'Do not store passwords, PINs, or banking login details.'),
}).strict();
const reviewSchema = z.object({
  action: z.enum(['UNDER_REVIEW', 'APPROVE', 'REJECT']),
  reason: z.string().max(1000).optional(),
  customerMessage: z.string().max(1000).optional(),
  internalNotes: z.string().max(3000).optional(),
  paymentChecked: z.boolean().optional(),
  duplicateReferenceResolved: z.boolean().optional(),
}).strict();

function publicRequest<T extends { proofStorageName: string; proofMimeType: string; internalNotes: string | null }>(request: T) {
  const {
    proofStorageName: _proofStorageName,
    proofMimeType: _proofMimeType,
    internalNotes: _internalNotes,
    ...data
  } = request;
  return data;
}

purchaseRequestRouter.get(
  '/packages',
  asyncHandler(async (_req, res) => {
    const packages = await prisma.membershipPackage.findMany({
      where: { saleStatus: 'AVAILABLE' },
      orderBy: { createdAt: 'asc' },
    });
    res.json(packages.map((item) => ({ ...item, includedRooms: JSON.parse(item.includedRooms) })));
  }),
);

purchaseRequestRouter.get(
  '/instructions',
  asyncHandler(async (_req, res) => {
    const setting = await prisma.setting.findUnique({ where: { key: 'manualPurchases.instructions' } });
    res.json({ instructions: setting?.value ?? 'Contact ATG support for current payment instructions.' });
  }),
);

purchaseRequestRouter.post(
  '/',
  requireAuth,
  uploadProof,
  asyncHandler(async (req, res) => {
    const data = validate(purchaseInput, req.body);
    const request = await createPurchaseRequest(req.user!.id, data, req.file
      ? { buffer: req.file.buffer, mimetype: req.file.mimetype, size: req.file.size }
      : undefined);
    res.status(201).json(request);
  }),
);

purchaseRequestRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const requests = await prisma.purchaseRequest.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      include: {
        reviewer: { select: { name: true } },
        events: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, action: true, fromStatus: true, toStatus: true, reason: true, customerMessage: true, createdAt: true },
        },
      },
    });
    res.json(requests.map((request) => ({
      ...publicRequest(request),
      decisionReason: request.status === 'REJECTED' ? request.decisionReason : null,
      events: request.events.map((event) => ({
        ...event,
        reason: event.toStatus === 'REJECTED' ? event.reason : null,
      })),
    })));
  }),
);

purchaseRequestRouter.get(
  '/:id/proof',
  requireAuth,
  asyncHandler(async (req, res) => {
    const request = await prisma.purchaseRequest.findUnique({
      where: { id: req.params.id },
      select: { userId: true, proofStorageName: true, proofMimeType: true },
    });
    if (!request || (request.userId !== req.user!.id && req.user!.role !== 'ADMIN')) {
      throw new HttpError(404, 'Payment proof not found.');
    }
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Content-Disposition', 'inline; filename="payment-proof"');
    res.type(request.proofMimeType);
    res.sendFile(request.proofStorageName, { root: env.purchaseProofDir, dotfiles: 'deny' });
  }),
);

purchaseRequestRouter.post(
  '/:id/cancel',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await cancelPurchaseRequest(req.user!.id, req.params.id));
  }),
);

purchaseRequestRouter.get(
  '/admin/packages',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (_req, res) => {
    const packages = await prisma.membershipPackage.findMany({ orderBy: { createdAt: 'asc' } });
    res.json(packages.map((item) => ({ ...item, includedRooms: JSON.parse(item.includedRooms) })));
  }),
);

purchaseRequestRouter.post(
  '/admin/packages',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const data = validate(packageSchema, req.body);
    const item = await prisma.membershipPackage.create({
      data: { ...data, includedRooms: JSON.stringify(data.includedRooms), price: new Prisma.Decimal(data.price) },
    });
    res.status(201).json({ ...item, includedRooms: data.includedRooms });
  }),
);

purchaseRequestRouter.patch(
  '/admin/packages/:id',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const data = validate(packageSchema.partial(), req.body);
    const { includedRooms, price, ...fields } = data;
    const item = await prisma.membershipPackage.update({
      where: { id: req.params.id },
      data: {
        ...fields,
        ...(includedRooms ? { includedRooms: JSON.stringify(includedRooms) } : {}),
        ...(price !== undefined ? { price: new Prisma.Decimal(price) } : {}),
      },
    });
    res.json({ ...item, includedRooms: JSON.parse(item.includedRooms) });
  }),
);

purchaseRequestRouter.get(
  '/admin/instructions',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (_req, res) => {
    const setting = await prisma.setting.findUnique({ where: { key: 'manualPurchases.instructions' } });
    res.json({ instructions: setting?.value ?? '' });
  }),
);

purchaseRequestRouter.put(
  '/admin/instructions',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { instructions } = validate(instructionSchema, req.body);
    await prisma.setting.upsert({
      where: { key: 'manualPurchases.instructions' },
      update: { value: instructions, updatedById: req.user!.id },
      create: { key: 'manualPurchases.instructions', value: instructions, updatedById: req.user!.id },
    });
    res.json({ instructions });
  }),
);

purchaseRequestRouter.get(
  '/admin',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const requests = await prisma.purchaseRequest.findMany({
      where: status ? { status } : {},
      orderBy: [{ duplicateReference: 'desc' }, { createdAt: 'asc' }],
      take: 300,
      include: {
        user: { select: { id: true, name: true, email: true } },
        reviewer: { select: { id: true, name: true } },
        events: { orderBy: { createdAt: 'asc' }, include: { actor: { select: { id: true, name: true, role: true } } } },
      },
    });
    res.json(requests.map((request) => ({
      ...publicRequest(request),
      proofUrl: `/api/purchase-requests/${request.id}/proof`,
    })));
  }),
);

purchaseRequestRouter.post(
  '/admin/:id/review',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const data = validate(reviewSchema, req.body);
    res.json(await decidePurchaseRequest(req.params.id, req.user!.id, data));
  }),
);
