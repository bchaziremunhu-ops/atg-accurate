import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, validate } from '../lib/http.js';
import { HttpError } from '../middleware/error.js';
import { effectiveMembership } from '../lib/permissions.js';

export const userRouter = Router();

userRouter.use(requireAuth);

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 },
  fileFilter: (_req, file, callback) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      callback(new HttpError(400, 'Profile picture must be a JPEG, PNG, or WebP image.'));
      return;
    }
    callback(null, true);
  },
});

const uploadAvatar: RequestHandler = (req, res, next) => {
  avatarUpload.single('avatar')(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      next(new HttpError(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, 'Profile picture must be 5 MB or smaller.'));
      return;
    }
    next(error);
  });
};

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
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data,
      select: { id: true, name: true, phone: true, country: true, bio: true, avatarUrl: true },
    });
    res.json({ ok: true, user });
  }),
);

userRouter.post(
  '/profile/avatar',
  uploadAvatar,
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) throw new HttpError(400, 'Choose a profile picture to upload.');
    const expectedFormat = file.mimetype === 'image/jpeg' ? 'jpeg' : file.mimetype === 'image/png' ? 'png' : 'webp';
    let image: Buffer;
    try {
      const source = sharp(file.buffer, { failOn: 'error', limitInputPixels: 40_000_000 });
      const metadata = await source.metadata();
      if (metadata.format !== expectedFormat || !metadata.width || !metadata.height) {
        throw new Error('Unsupported image content.');
      }
      image = await source
        .rotate()
        .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer();
    } catch {
      throw new HttpError(400, 'Profile picture must be a complete, readable JPEG, PNG, or WebP image.');
    }

    const filename = `${randomUUID()}.webp`;
    await mkdir(env.avatarDir, { recursive: true });
    const filepath = path.join(env.avatarDir, filename);
    await writeFile(filepath, image, { flag: 'wx', mode: 0o644 });
    const avatarUrl = new URL(`/uploads/avatars/${filename}`, env.publicUrl).toString();
    let user;
    try {
      user = await prisma.user.update({
        where: { id: req.user!.id },
        data: { avatarUrl },
        select: { id: true, name: true, phone: true, country: true, avatarUrl: true, bio: true },
      });
    } catch (error) {
      await rm(filepath, { force: true });
      throw error;
    }
    res.json({ ok: true, user });
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
