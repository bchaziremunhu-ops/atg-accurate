import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, validate } from '../lib/http.js';
import { HttpError } from '../middleware/error.js';
import { canAccess, isAdmin, type AccessLevel } from '../lib/permissions.js';
import { broadcastToAudience, notifyMany } from '../services/notifications.service.js';

export const communityRouter = Router();

communityRouter.use(requireAuth);

function groupWhere(user: { role: string; membership: string; isVip: boolean; extraAccessLevels?: string[] }) {
  if (isAdmin(user)) return {};
  const allowed: string[] = ['FREE'];
  if (['PAID', 'VIP_DERIV', 'VIP_WELTRADE'].includes(user.membership)) allowed.push('PAID');
  if (user.membership === 'VIP_DERIV') allowed.push('VIP_DERIV');
  if (user.membership === 'VIP_WELTRADE') allowed.push('VIP_WELTRADE');
  allowed.push(...(user.extraAccessLevels ?? []));
  return { accessTier: { in: allowed } };
}

async function accessiblePost(postId: string, user: NonNullable<Express.Request['user']>) {
  const post = await prisma.groupPost.findUnique({
    where: { id: postId },
    include: { group: { select: { id: true, name: true, accessTier: true } } },
  });
  if (!post) throw new HttpError(404, 'Post not found');
  if (!canAccess(user, post.group.accessTier as AccessLevel)) {
    throw new HttpError(404, 'Post not found');
  }
  return post;
}

communityRouter.get(
  '/groups',
  asyncHandler(async (req, res) => {
    const groups = await prisma.group.findMany({
      include: { _count: { select: { members: true, posts: true, messages: true } } },
      orderBy: [{ roomType: 'asc' }, { createdAt: 'asc' }],
    });
    const memberships = await prisma.groupMember.findMany({ where: { userId: req.user!.id } });
    const joined = new Set(memberships.map((m) => m.groupId));
    res.json(
      groups.map((g) => ({
        ...g,
        joined: joined.has(g.id),
        canAccess: canAccess(req.user, g.accessTier as AccessLevel),
        chatOpen: g.isChatOpen,
      })),
    );
  }),
);

communityRouter.get(
  '/groups/:id',
  asyncHandler(async (req, res) => {
    const group = await prisma.group.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { members: true, posts: true, messages: true } } },
    });
    if (!group) throw new HttpError(404, 'Room not found');
    if (!canAccess(req.user, group.accessTier as AccessLevel)) {
      throw new HttpError(402, `This room is for ${group.accessTier} members`, 'UPGRADE_REQUIRED');
    }
    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: group.id, userId: req.user!.id } },
    });
    res.json({ ...group, joined: Boolean(membership), chatOpen: group.isChatOpen });
  }),
);

communityRouter.post(
  '/groups/:id/join',
  asyncHandler(async (req, res) => {
    const group = await prisma.group.findUnique({ where: { id: req.params.id } });
    if (!group) throw new HttpError(404, 'Room not found');
    if (!canAccess(req.user, group.accessTier as AccessLevel)) {
      throw new HttpError(402, `This room is for ${group.accessTier} members`, 'UPGRADE_REQUIRED');
    }
    const member = await prisma.groupMember.upsert({
      where: { groupId_userId: { groupId: group.id, userId: req.user!.id } },
      update: {},
      create: { groupId: group.id, userId: req.user!.id },
    });
    res.status(201).json(member);
  }),
);

communityRouter.delete(
  '/groups/:id/join',
  asyncHandler(async (req, res) => {
    await prisma.groupMember
      .delete({ where: { groupId_userId: { groupId: req.params.id, userId: req.user!.id } } })
      .catch(() => {});
    res.json({ ok: true });
  }),
);

communityRouter.get(
  '/posts',
  asyncHandler(async (req, res) => {
    const category = req.query.category as string | undefined;
    const q = req.query.q as string | undefined;
    const groupId = req.query.groupId as string | undefined;

    let accessibleGroupIds: string[] | null = null;
    if (!isAdmin(req.user!)) {
      const groups = await prisma.group.findMany({ where: groupWhere(req.user!), select: { id: true } });
      accessibleGroupIds = groups.map((g) => g.id);
    }

    const posts = await prisma.groupPost.findMany({
      where: {
        ...(accessibleGroupIds ? { groupId: { in: accessibleGroupIds } } : {}),
        ...(groupId ? { groupId } : {}),
        ...(category && category !== 'All' ? { kind: category.toUpperCase() } : {}),
        ...(q ? { body: { contains: q } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        author: { select: { id: true, name: true, avatarUrl: true, role: true, isVip: true } },
        _count: { select: { likes: true, comments: true } },
        likes: { where: { userId: req.user!.id }, select: { id: true } },
        group: { select: { id: true, name: true, category: true, roomType: true } },
      },
    });
    res.json(
      posts.map((p) => ({
        ...p,
        likedByMe: p.likes.length > 0,
        likeCount: p._count.likes,
        commentCount: p._count.comments,
        likes: undefined,
        _count: undefined,
      })),
    );
  }),
);

const postSchema = z.object({
  groupId: z.string().optional(),
  kind: z.enum(['POST', 'ANALYSIS', 'WIN', 'QUESTION']).default('POST'),
  body: z.string().trim().min(1).max(2000),
  imageUrl: z.string().url().optional().nullable(),
});

communityRouter.post(
  '/posts',
  asyncHandler(async (req, res) => {
    const data = validate(postSchema, req.body);
    let groupId = data.groupId;
    if (groupId) {
      const group = await prisma.group.findUnique({ where: { id: groupId } });
      if (!group) throw new HttpError(404, 'Room not found');
      if (!canAccess(req.user, group.accessTier as AccessLevel)) {
        throw new HttpError(402, 'You do not have access to this room', 'UPGRADE_REQUIRED');
      }
    } else {
      const general = await prisma.group.findFirst({ where: { accessTier: 'FREE' }, orderBy: { createdAt: 'asc' } });
      groupId = general?.id;
    }
    if (!groupId) throw new HttpError(400, 'No group available');
    const post = await prisma.groupPost.create({
      data: { groupId, authorId: req.user!.id, kind: data.kind, body: data.body, imageUrl: data.imageUrl || null },
      include: { author: { select: { id: true, name: true, avatarUrl: true, role: true } } },
    });
    const group = await prisma.group.findUniqueOrThrow({ where: { id: groupId } });
    if (isAdmin(req.user!)) {
      await broadcastToAudience(group.accessTier as AccessLevel, {
        title: 'New post from ATG Admin',
        body: `${post.author.name} shared an update in ${group.name}.`,
        type: 'COMMUNITY',
        link: '/community',
      }, req.user!.id);
    } else {
      const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
      await notifyMany(admins.map((admin) => admin.id), {
        title: 'New community post',
        body: `${post.author.name} posted in ${group.name}: ${post.body.slice(0, 140)}`,
        type: 'COMMUNITY',
        link: '/community',
      });
    }
    res.status(201).json(post);
  }),
);

communityRouter.delete(
  '/posts/:id',
  asyncHandler(async (req, res) => {
    const post = await accessiblePost(req.params.id, req.user!);
    if (post.authorId !== req.user!.id && !isAdmin(req.user!)) {
      throw new HttpError(403, 'You can only remove your own posts');
    }
    await prisma.groupPost.delete({ where: { id: post.id } });
    res.json({ ok: true });
  }),
);

communityRouter.post(
  '/posts/:id/like',
  asyncHandler(async (req, res) => {
    const post = await accessiblePost(req.params.id, req.user!);
    const existing = await prisma.postLike.findUnique({
      where: { postId_userId: { postId: req.params.id, userId: req.user!.id } },
    });
    if (existing) {
      await prisma.postLike.delete({ where: { id: existing.id } });
      return res.json({ liked: false });
    }
    await prisma.postLike.create({ data: { postId: req.params.id, userId: req.user!.id } });
    res.json({ liked: true });
  }),
);

communityRouter.get(
  '/posts/:id/comments',
  asyncHandler(async (req, res) => {
    await accessiblePost(req.params.id, req.user!);
    const comments = await prisma.comment.findMany({
      where: { postId: req.params.id },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, name: true, avatarUrl: true, role: true } } },
    });
    res.json(comments);
  }),
);

communityRouter.post(
  '/posts/:id/comments',
  asyncHandler(async (req, res) => {
    const { body } = validate(z.object({ body: z.string().trim().min(1).max(1000) }), req.body);
    const post = await accessiblePost(req.params.id, req.user!);
    const comment = await prisma.comment.create({
      data: { postId: req.params.id, userId: req.user!.id, body },
      include: { user: { select: { id: true, name: true, avatarUrl: true, role: true } } },
    });
    if (post.authorId !== req.user!.id) {
      await notifyMany([post.authorId], {
        title: isAdmin(req.user!) ? 'ATG Admin replied to your post' : 'New reply to your post',
        body: `${comment.user.name}: ${comment.body.slice(0, 140)}`,
        type: 'COMMUNITY',
        link: '/community',
      });
    }
    res.status(201).json(comment);
  }),
);

communityRouter.get(
  '/groups/:id/messages',
  asyncHandler(async (req, res) => {
    const group = await prisma.group.findUnique({ where: { id: req.params.id } });
    if (!group) throw new HttpError(404, 'Room not found');
    if (!canAccess(req.user, group.accessTier as AccessLevel)) {
      throw new HttpError(402, 'You do not have access to this room', 'UPGRADE_REQUIRED');
    }
    const messages = await prisma.message.findMany({
      where: { groupId: group.id },
      orderBy: { createdAt: 'asc' },
      take: 200,
      include: { user: { select: { id: true, name: true, avatarUrl: true } } },
    });
    res.json({ chatOpen: group.isChatOpen, messages });
  }),
);

communityRouter.post(
  '/groups/:id/messages',
  asyncHandler(async (req, res) => {
    const { body } = z.object({ body: z.string().min(1).max(2000) }).parse(req.body);
    const group = await prisma.group.findUnique({ where: { id: req.params.id } });
    if (!group) throw new HttpError(404, 'Room not found');
    if (!canAccess(req.user, group.accessTier as AccessLevel)) {
      throw new HttpError(402, 'You do not have access to this room', 'UPGRADE_REQUIRED');
    }
    if (!group.isChatOpen && !isAdmin(req.user!)) {
      throw new HttpError(403, 'Chat is currently closed in this room', 'CHAT_CLOSED');
    }
    const message = await prisma.message.create({
      data: { groupId: group.id, userId: req.user!.id, body },
      include: { user: { select: { id: true, name: true, avatarUrl: true } } },
    });
    res.status(201).json(message);
  }),
);
