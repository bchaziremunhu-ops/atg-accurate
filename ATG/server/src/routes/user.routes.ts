import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, validate } from '../lib/http.js';
import { HttpError } from '../middleware/error.js';
import { effectiveMembership } from '../lib/permissions.js';

export const userRouter = Router();

userRouter.use(requireAuth);

userRouter.get(
  '/profile',
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: { wallet: true, subscription: true },
    });
    if (!user) throw new HttpError(404, 'User not found');
    const [courses, signals, certificates] = await Promise.all([
      prisma.enrollment.count({ where: { userId: user.id } }),
      prisma.signal.count({ where: { authorId: user.id } }),
      prisma.certificate.count({ where: { userId: user.id } }),
    ]);
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      country: user.country,
      bio: user.bio,
      avatarUrl: user.avatarUrl,
      role: user.role,
      membership: effectiveMembership({
        membership: user.membership,
        isVip: user.isVip,
        vipExpiresAt: user.vipExpiresAt,
      }),
      isVip: user.isVip && (!user.vipExpiresAt || user.vipExpiresAt > new Date()),
      vipExpiresAt: user.vipExpiresAt,
      wallet: user.wallet,
      subscription: user.subscription,
      stats: { courses, signals, certificates },
    });
  }),
);

userRouter.get(
  '/certificates',
  asyncHandler(async (req, res) => {
    const certs = await prisma.certificate.findMany({
      where: { userId: req.user!.id },
      orderBy: { issuedAt: 'desc' },
    });
    const courseIds = [...new Set(certs.map((c) => c.courseId))];
    const courses = await prisma.course.findMany({
      where: { id: { in: courseIds } },
      select: { id: true, slug: true, title: true, level: true },
    });
    const byId = Object.fromEntries(courses.map((c) => [c.id, c]));
    res.json(
      certs.map((c) => ({
        id: c.id,
        title: c.title,
        issuedAt: c.issuedAt,
        course: byId[c.courseId] ?? null,
      })),
    );
  }),
);

userRouter.get(
  '/certificates/:id',
  asyncHandler(async (req, res) => {
    const cert = await prisma.certificate.findUnique({ where: { id: req.params.id } });
    if (!cert || cert.userId !== req.user!.id) throw new HttpError(404, 'Certificate not found');
    const [course, user] = await Promise.all([
      prisma.course.findUnique({
        where: { id: cert.courseId },
        select: { slug: true, title: true, level: true },
      }),
      prisma.user.findUnique({ where: { id: cert.userId }, select: { name: true } }),
    ]);
    res.json({
      id: cert.id,
      title: cert.title,
      issuedAt: cert.issuedAt,
      course,
      recipient: user?.name ?? 'ATG Trader',
    });
  }),
);

const updateSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  phone: z.string().max(20).optional().nullable(),
  country: z.string().max(60).optional().nullable(),
  bio: z.string().max(300).optional().nullable(),
  avatarUrl: z.string().url().optional().nullable(),
});

userRouter.patch(
  '/profile',
  asyncHandler(async (req, res) => {
    const data = validate(updateSchema, req.body);
    const user = await prisma.user.update({ where: { id: req.user!.id }, data });
    res.json({ ok: true, user: { id: user.id, name: user.name, avatarUrl: user.avatarUrl, bio: user.bio } });
  }),
);

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

userRouter.post(
  '/change-password',
  asyncHandler(async (req, res) => {
    const data = validate(passwordSchema, req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw new HttpError(404, 'User not found');
    const ok = await bcrypt.compare(data.currentPassword, user.passwordHash);
    if (!ok) throw new HttpError(401, 'Current password is incorrect');
    const passwordHash = await bcrypt.hash(data.newPassword, 12);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    res.json({ ok: true });
  }),
);

// ---- Watchlist (saved pairs) ----
userRouter.get(
  '/watchlist',
  asyncHandler(async (req, res) => {
    const items = await prisma.watchlistItem.findMany({ where: { userId: req.user!.id } });
    res.json(items);
  }),
);

userRouter.post(
  '/watchlist',
  asyncHandler(async (req, res) => {
    const { pair } = z.object({ pair: z.string().min(1) }).parse(req.body);
    const item = await prisma.watchlistItem.upsert({
      where: { userId_pair: { userId: req.user!.id, pair } },
      update: {},
      create: { userId: req.user!.id, pair },
    });
    res.status(201).json(item);
  }),
);

userRouter.delete(
  '/watchlist/:pair',
  asyncHandler(async (req, res) => {
    await prisma.watchlistItem
      .delete({ where: { userId_pair: { userId: req.user!.id, pair: req.params.pair } } })
      .catch(() => {});
    res.json({ ok: true });
  }),
);
