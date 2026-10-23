import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { optionalAuth, requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler, validate } from '../lib/http.js';
import { HttpError } from '../middleware/error.js';
import { broadcastToAll, notify } from '../services/notifications.service.js';
import { isAdmin } from '../lib/permissions.js';
import { env } from '../config/env.js';

export const courseRouter = Router();

interface Principal {
  id: string;
  role: string;
}

/**
 * A member is entitled to a course's paid content only when:
 *   - the course is free (price <= 0), OR
 *   - they have a VERIFIED purchase (status PAID), OR
 *   - an enrollment was granted (e.g. by an admin), OR
 *   - they are an admin.
 * VIP membership alone does NOT unlock paid courses.
 */
async function isEntitled(user: Principal | undefined, course: { id: string; price: number }): Promise<boolean> {
  if (!user) return course.price <= 0;
  if (isAdmin(user)) return true;
  if (course.price <= 0) return true;
  const [purchase, enrollment] = await Promise.all([
    prisma.purchase.findFirst({
      where: { userId: user.id, itemType: 'COURSE', itemId: course.id, status: 'PAID' },
      select: { id: true },
    }),
    prisma.enrollment.findUnique({
      where: { userId_courseId: { userId: user.id, courseId: course.id } },
      select: { id: true },
    }),
  ]);
  return Boolean(purchase || enrollment);
}

courseRouter.get(
  '/',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const level = req.query.level as string | undefined;
    // Admins may list unpublished/archived courses too (?all=true).
    const all = req.query.all === 'true' && isAdmin(req.user);
    const courses = await prisma.course.findMany({
      where: {
        ...(all ? {} : { published: true, saleStatus: { not: 'HIDDEN' } }),
        ...(level && level !== 'All Courses' ? { level } : {}),
      },
      orderBy: { order: 'asc' },
      include: { lessons: { orderBy: { order: 'asc' } } },
    });

    let progressMap: Record<string, number> = {};
    if (req.user) {
      const enrollments = await prisma.enrollment.findMany({ where: { userId: req.user.id } });
      progressMap = Object.fromEntries(enrollments.map((e) => [e.courseId, e.progress]));
    }

    res.json(
      courses.map((c) => ({
        id: c.id,
        slug: c.slug,
        title: c.title,
        description: c.description,
        level: c.level,
        price: c.price,
        currency: c.currency,
        saleStatus: c.saleStatus,
        isFree: c.price <= 0,
        isVip: c.isVip,
        published: c.published,
        coverUrl: c.coverUrl,
        lessonCount: c.lessons.length,
        durationMin: c.lessons.reduce((s, l) => s + l.durationMin, 0),
        lessons: c.lessons.map((l) => ({
          id: l.id,
          title: l.title,
          durationMin: l.durationMin,
          isFree: l.isFree,
          order: l.order,
        })),
        progress: progressMap[c.id] ?? 0,
      })),
    );
  }),
);

courseRouter.get(
  '/:slug',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const course = await prisma.course.findUnique({
      where: { slug: req.params.slug },
      include: {
        lessons: { orderBy: { order: 'asc' } },
        resources: true,
      },
    });
    if (!course) throw new HttpError(404, 'Course not found');
    if ((!course.published || course.saleStatus === 'HIDDEN') && !isAdmin(req.user)) {
      throw new HttpError(404, 'Course not found');
    }

    let enrollment = null;
    let lessonProgress: Record<string, boolean> = {};
    if (req.user) {
      enrollment = await prisma.enrollment.findUnique({
        where: { userId_courseId: { userId: req.user.id, courseId: course.id } },
      });
      const lp = await prisma.lessonProgress.findMany({
        where: { userId: req.user.id, lesson: { courseId: course.id } },
      });
      lessonProgress = Object.fromEntries(lp.map((p) => [p.lessonId, p.completed]));
    }

    const entitled = await isEntitled(req.user, course);
    res.json({
      ...course,
      isFree: course.price <= 0,
      entitled,
      progress: enrollment?.progress ?? 0,
      enrollmentId: enrollment?.id ?? null,
      // Non-entitled members can only preview lessons explicitly marked free.
      lessons: course.lessons.map((l) => ({
        ...l,
        locked: !entitled && !l.isFree,
        completed: lessonProgress[l.id] ?? false,
      })),
      resources: course.resources.map((r) => ({ ...r, locked: !entitled })),
    });
  }),
);

const progressSchema = z.object({
  lessonId: z.string(),
  completed: z.boolean().optional(),
  secondsSeen: z.number().int().min(0).optional(),
});

courseRouter.post(
  '/:slug/enroll',
  requireAuth,
  asyncHandler(async (req, res) => {
    const course = await prisma.course.findUnique({ where: { slug: req.params.slug } });
    if (!course) throw new HttpError(404, 'Course not found');
    const entitled = await isEntitled(req.user, course);
    if (!entitled) {
      throw new HttpError(402, 'This is a paid course. Complete payment to unlock it.', 'PAYMENT_REQUIRED');
    }
    if (course.price <= 0 && course.saleStatus !== 'AVAILABLE') {
      throw new HttpError(409, 'This free course is not currently available for enrollment.', 'COURSE_UNAVAILABLE');
    }
    const enrollment = await prisma.enrollment.upsert({
      where: { userId_courseId: { userId: req.user!.id, courseId: course.id } },
      update: {},
      create: { userId: req.user!.id, courseId: course.id },
    });
    res.status(201).json(enrollment);
  }),
);

/** Persist lesson progress and recompute course progress / certificates. */
courseRouter.post(
  '/:slug/progress',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = validate(progressSchema, req.body);
    const course = await prisma.course.findUnique({
      where: { slug: req.params.slug },
      include: { lessons: true },
    });
    if (!course) throw new HttpError(404, 'Course not found');

    const entitled = await isEntitled(req.user, course);
    if (!entitled) throw new HttpError(402, 'Purchase required to track this course', 'PAYMENT_REQUIRED');

    const lesson = course.lessons.find((l) => l.id === data.lessonId);
    if (!lesson) throw new HttpError(404, 'Lesson not found in this course');

    const enrollment = await prisma.enrollment.upsert({
      where: { userId_courseId: { userId: req.user!.id, courseId: course.id } },
      update: {},
      create: { userId: req.user!.id, courseId: course.id },
    });

    await prisma.lessonProgress.upsert({
      where: { userId_lessonId: { userId: req.user!.id, lessonId: data.lessonId } },
      update: { completed: data.completed ?? true, secondsSeen: data.secondsSeen ?? 0 },
      create: {
        userId: req.user!.id,
        lessonId: data.lessonId,
        completed: data.completed ?? true,
        secondsSeen: data.secondsSeen ?? 0,
      },
    });

    const done = await prisma.lessonProgress.count({
      where: { userId: req.user!.id, completed: true, lesson: { courseId: course.id } },
    });
    const total = course.lessons.length || 1;
    const progress = Math.round((done / total) * 100);

    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: { progress, completed: progress === 100 },
    });

    if (progress === 100) {
      const existingCert = await prisma.certificate.findFirst({
        where: { userId: req.user!.id, courseId: course.id },
      });
      if (!existingCert) {
        await prisma.certificate.create({
          data: { userId: req.user!.id, courseId: course.id, title: `${course.title} Certificate` },
        });
        await notify({
          userId: req.user!.id,
          title: 'Certificate earned 🏅',
          body: `You completed "${course.title}". Your certificate is ready.`,
          type: 'EDUCATION',
          link: '/profile/certificates',
        });
      }
    }

    res.json({ ok: true, progress, completed: progress === 100 });
  }),
);

courseRouter.get(
  '/:slug/resources',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const course = await prisma.course.findUnique({
      where: { slug: req.params.slug },
      include: { resources: true },
    });
    if (!course) throw new HttpError(404, 'Course not found');
    if ((!course.published || course.saleStatus === 'HIDDEN') && !isAdmin(req.user)) {
      throw new HttpError(404, 'Course not found');
    }
    const entitled = await isEntitled(req.user, course);
    res.json(course.resources.map((r) => ({ ...r, locked: !entitled })));
  }),
);

async function notifyPublishedCourse(course: { slug: string; title: string }, message: string) {
  await broadcastToAll({
    title: message,
    body: `${course.title} is ready to explore in Education.`,
    type: 'EDUCATION',
    link: `/education/${course.slug}`,
  });
}

/**
 * Free courses are capped (MAX_FREE_COURSES, default 5) so the paid catalogue
 * stays the main offer. Enforced on create, and whenever a course's price is
 * changed to free, so the limit cannot be bypassed via PATCH.
 */
async function assertFreeCourseAllowed(price: number, excludeSlug?: string) {
  if (price > 0) return;
  const free = await prisma.course.count({
    where: { price: { lte: 0 }, ...(excludeSlug ? { slug: { not: excludeSlug } } : {}) },
  });
  if (free >= env.maxFreeCourses) {
    throw new HttpError(
      409,
      `Free-course limit reached (${env.maxFreeCourses}). Set a price above 0, or unpublish/remove a free course first.`,
      'FREE_COURSE_LIMIT',
    );
  }
}

// ---- Admin CRUD ----
const courseSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  level: z.enum(['Beginner', 'Intermediate', 'Advanced']).default('Beginner'),
  price: z.coerce.number().min(0).default(0),
  currency: z.string().regex(/^[A-Z]{3}$/).default('USD'),
  saleStatus: z.enum(['AVAILABLE', 'UNAVAILABLE', 'HIDDEN', 'SOLD_OUT']).default('AVAILABLE'),
  isVip: z.boolean().default(false),
  coverUrl: z.string().url().optional().nullable(),
  published: z.boolean().default(true),
  order: z.coerce.number().default(0),
});

courseRouter.post(
  '/',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const data = validate(courseSchema, req.body);
    await assertFreeCourseAllowed(data.price);
    const course = await prisma.course.create({ data });
    if (course.published && course.saleStatus !== 'HIDDEN') {
      await notifyPublishedCourse(course, `New course: ${course.title}`);
    }
    res.status(201).json(course);
  }),
);

courseRouter.patch(
  '/:slug',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const data = validate(courseSchema.partial(), req.body);
    if (data.price !== undefined) await assertFreeCourseAllowed(data.price, req.params.slug);
    const previous = await prisma.course.findUnique({ where: { slug: req.params.slug } });
    if (!previous) throw new HttpError(404, 'Course not found');
    const course = await prisma.course.update({ where: { slug: req.params.slug }, data });
    const becameVisible = !previous.published && course.published;
    const visibleDetailsChanged = previous.published && course.published && (
      previous.title !== course.title ||
      previous.description !== course.description ||
      previous.price !== course.price ||
      previous.currency !== course.currency
    );
    if (course.saleStatus !== 'HIDDEN' && (becameVisible || visibleDetailsChanged)) {
      await notifyPublishedCourse(course, becameVisible ? `New course: ${course.title}` : `Course updated: ${course.title}`);
    }
    res.json(course);
  }),
);

courseRouter.delete(
  '/:slug',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    await prisma.course.delete({ where: { slug: req.params.slug } }).catch(() => {});
    res.json({ ok: true });
  }),
);

const lessonSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  videoUrl: z.string().optional().nullable(),
  durationMin: z.coerce.number().default(0),
  order: z.coerce.number().default(0),
  isFree: z.boolean().default(false),
});

courseRouter.post(
  '/:slug/lessons',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const course = await prisma.course.findUnique({ where: { slug: req.params.slug } });
    if (!course) throw new HttpError(404, 'Course not found');
    const data = validate(lessonSchema, req.body);
    const lesson = await prisma.lesson.create({ data: { ...data, courseId: course.id } });
    if (course.published && course.saleStatus !== 'HIDDEN') {
      await notifyPublishedCourse(course, `New lesson: ${course.title}`);
    }
    res.status(201).json(lesson);
  }),
);

courseRouter.patch(
  '/:slug/lessons/:lessonId',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const data = validate(lessonSchema.partial(), req.body);
    const existing = await prisma.lesson.findFirst({
      where: { id: req.params.lessonId, course: { slug: req.params.slug } },
      include: { course: true },
    });
    if (!existing) throw new HttpError(404, 'Lesson not found');
    const lesson = await prisma.lesson.update({ where: { id: existing.id }, data });
    if (existing.course.published && existing.course.saleStatus !== 'HIDDEN') {
      await notifyPublishedCourse(existing.course, `Course lesson updated: ${existing.course.title}`);
    }
    res.json(lesson);
  }),
);

courseRouter.delete(
  '/:slug/lessons/:lessonId',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.lesson.findFirst({
      where: { id: req.params.lessonId, course: { slug: req.params.slug } },
      include: { course: true },
    });
    if (!existing) throw new HttpError(404, 'Lesson not found');
    await prisma.lesson.delete({ where: { id: existing.id } });
    if (existing.course.published && existing.course.saleStatus !== 'HIDDEN') {
      await notifyPublishedCourse(existing.course, `Course lesson updated: ${existing.course.title}`);
    }
    res.json({ ok: true });
  }),
);
