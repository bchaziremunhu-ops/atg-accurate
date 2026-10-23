import type { Server as HttpServer } from 'node:http';
import { Server as IOServer } from 'socket.io';
import { verifyAccessToken } from '../lib/jwt.js';
import { prisma } from '../lib/prisma.js';
import { corsOrigin, env } from '../config/env.js';
import { canAccess, effectiveMembership, isAdmin, type AccessLevel, type Membership, type Principal } from '../lib/permissions.js';

interface SocketPrincipal extends Principal {
  id: string;
  name: string;
  role: string;
  membership: Membership;
  extraAccessLevels: AccessLevel[];
}

async function resolveSocketPrincipal(userId: string): Promise<SocketPrincipal | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;

  const [subscription, activeRooms] = await Promise.all([
    prisma.subscription.findUnique({ where: { userId }, select: { provider: true } }),
    prisma.membershipRoomAccess.findMany({
      where: { userId, startsAt: { lte: new Date() }, expiresAt: { gt: new Date() } },
      select: { accessLevel: true },
      distinct: ['accessLevel'],
    }),
  ]);
  const grantedRooms = activeRooms
    .map((room) => room.accessLevel)
    .filter((level): level is Membership => level === 'VIP_DERIV' || level === 'VIP_WELTRADE');
  const legacyMembership = effectiveMembership({
    membership: user.membership,
    isVip: user.isVip,
    vipExpiresAt: user.vipExpiresAt,
  });
  const membership = grantedRooms[0] ?? (subscription?.provider === 'manual' ? 'FREE' : legacyMembership);

  return {
    id: user.id,
    name: user.name,
    role: user.role,
    membership,
    extraAccessLevels: grantedRooms.filter((level) => level !== membership),
  };
}

/** Initialises the Socket.IO realtime layer for community group chat. */
export function initRealtime(httpServer: HttpServer) {
  const io = new IOServer(httpServer, {
    cors: { origin: corsOrigin(), credentials: true },
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('Authentication required'));
    try {
      const payload = verifyAccessToken(token);
      // Resolve current membership from the database so expiry / grants apply live.
      const principal = await resolveSocketPrincipal(payload.sub);
      if (!principal) return next(new Error('Account not found'));
      socket.data.user = principal;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as SocketPrincipal;
    socket.join(`user:${user.id}`);

    socket.on('group:join', async (groupId: string, acknowledge?: (joined: boolean) => void) => {
      try {
        if (typeof groupId !== 'string' || !groupId) {
          acknowledge?.(false);
          return;
        }
        const [group, principal] = await Promise.all([
          prisma.group.findUnique({ where: { id: groupId } }),
          resolveSocketPrincipal(user.id),
        ]);
        if (!group || !principal || !canAccess(principal, group.accessTier as AccessLevel)) {
          socket.leave(`group:${groupId}`);
          acknowledge?.(false);
          return;
        }
        await socket.join(`group:${groupId}`);
        acknowledge?.(true);
      } catch (error) {
        console.error('[socket] group join failed:', error);
        acknowledge?.(false);
      }
    });

    socket.on('group:leave', (groupId: string) => {
      if (typeof groupId === 'string' && groupId) socket.leave(`group:${groupId}`);
    });

    socket.on('group:message', async (payload: { groupId: string; body: string }, acknowledge?: (sent: boolean) => void) => {
      try {
        if (typeof payload?.groupId !== 'string' || !payload.groupId || typeof payload.body !== 'string' || !payload.body.trim()) {
          acknowledge?.(false);
          return;
        }
        const [group, principal] = await Promise.all([
          prisma.group.findUnique({ where: { id: payload.groupId } }),
          resolveSocketPrincipal(user.id),
        ]);
        if (!group || !principal || !socket.rooms.has(`group:${payload.groupId}`)) {
          acknowledge?.(false);
          return;
        }
        if (!canAccess(principal, group.accessTier as AccessLevel) || (!group.isChatOpen && !isAdmin(principal))) {
          socket.leave(`group:${payload.groupId}`);
          acknowledge?.(false);
          return;
        }

        const message = await prisma.message.create({
          data: { groupId: payload.groupId, userId: user.id, body: payload.body.trim().slice(0, 2000) },
          include: { user: { select: { id: true, name: true, avatarUrl: true } } },
        });
        io.to(`group:${payload.groupId}`).emit('group:message', message);
        acknowledge?.(true);
      } catch (error) {
        console.error('[socket] group message failed:', error);
        acknowledge?.(false);
      }
    });

    socket.on('typing', async (payload: { groupId: string; typing: boolean }) => {
      try {
        if (typeof payload?.groupId !== 'string' || !payload.groupId || typeof payload.typing !== 'boolean' || !socket.rooms.has(`group:${payload.groupId}`)) return;
        const [group, principal] = await Promise.all([
          prisma.group.findUnique({ where: { id: payload.groupId } }),
          resolveSocketPrincipal(user.id),
        ]);
        if (!group || !principal || !canAccess(principal, group.accessTier as AccessLevel) || (!group.isChatOpen && !isAdmin(principal))) {
          socket.leave(`group:${payload.groupId}`);
          return;
        }
        socket.to(`group:${payload.groupId}`).emit('typing', { userId: user.id, typing: payload.typing });
      } catch (error) {
        console.error('[socket] typing update failed:', error);
      }
    });
  });

  return io;
}

let ioRef: IOServer | null = null;
export function setIo(io: IOServer) {
  ioRef = io;
}
export function getIo() {
  return ioRef;
}
