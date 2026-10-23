import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../lib/http.js';

export const notificationRouter = Router();

notificationRouter.use(requireAuth);

notificationRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const unread = notifications.filter((n) => !n.read).length;
    res.json({ notifications, unread });
  }),
);

notificationRouter.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    await prisma.notification.updateMany({
      where: { id: req.params.id, userId: req.user!.id },
      data: { read: true },
    });
    res.json({ ok: true });
  }),
);

notificationRouter.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    await prisma.notification.updateMany({ where: { userId: req.user!.id, read: false }, data: { read: true } });
    res.json({ ok: true });
  }),
);

// ---- Web Push registration ----
const subSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});

notificationRouter.post(
  '/push/subscribe',
  asyncHandler(async (req, res) => {
    const data = subSchema.parse(req.body);
    const sub = await prisma.pushSubscription.upsert({
      where: { endpoint: data.endpoint },
      update: { userId: req.user!.id, p256dh: data.keys.p256dh, auth: data.keys.auth },
      create: { userId: req.user!.id, endpoint: data.endpoint, p256dh: data.keys.p256dh, auth: data.keys.auth },
    });
    res.status(201).json({ ok: true, id: sub.id });
  }),
);

notificationRouter.get(
  '/push/public-key',
  asyncHandler(async (_req, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY ?? '' });
  }),
);
