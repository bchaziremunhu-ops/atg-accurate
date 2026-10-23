import { prisma } from '../lib/prisma.js';
import type { AccessLevel } from '../lib/permissions.js';

/**
 * When an administrator publishes or updates a signal, a matching post is
 * automatically mirrored into the correct room (Free / Paid / Deriv VIP /
 * Weltrade VIP). The room's own access tier then governs who can see it, so a
 * member only ever sees a signal that their role + subscription allows.
 *
 * Nothing here invents data — the post is a formatted copy of the real signal.
 */

type SignalLike = {
  id: string;
  pair: string;
  direction: string;
  entry: number;
  takeProfit: number;
  stopLoss: number;
  timeframe: string;
  status: string;
  analysis: string | null;
  resultPips: number | null;
  resultPct: number | null;
};

const STATUS_ARROW: Record<string, string> = {
  OPEN: '🟡 OPEN',
  HIT_TP: '✅ Target hit (TP)',
  HIT_SL: '❌ Stop loss hit (SL)',
  CANCELLED: '⚪ Cancelled',
};

export function signalSummary(s: SignalLike): string {
  const lines = [
    `📈 ${s.pair}`,
    `${s.direction} · ${s.timeframe} · Entry ${s.entry} · TP ${s.takeProfit} · SL ${s.stopLoss}`,
    `Status: ${STATUS_ARROW[s.status] ?? s.status}`,
  ];
  if (s.status !== 'OPEN' && (s.resultPct !== null || s.resultPips !== null)) {
    const parts: string[] = [];
    if (s.resultPct !== null) parts.push(`${s.resultPct > 0 ? '+' : ''}${s.resultPct}%`);
    if (s.resultPips !== null) parts.push(`${s.resultPips > 0 ? '+' : ''}${s.resultPips} pips`);
    if (parts.length) lines.push(`Result: ${parts.join(' · ')}`);
  }
  if (s.analysis) lines.push('', s.analysis);
  return lines.join('\n');
}

/** The room that a given audience belongs to (or null when none exists). */
async function findRoomForAudience(audience: AccessLevel) {
  return prisma.group.findFirst({
    where: { accessTier: audience },
    orderBy: [{ roomType: 'asc' }, { createdAt: 'asc' }],
  });
}

async function fallbackAuthorId(): Promise<string | null> {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
  return admin?.id ?? null;
}

/** Creates or refreshes the mirrored room post for a signal. */
export async function syncSignalRoomPost(signalId: string): Promise<void> {
  const signal = await prisma.signal.findUnique({ where: { id: signalId } });
  if (!signal) return;

  const room = await findRoomForAudience(signal.audience as AccessLevel);
  if (!room) return; // no room for this audience yet — nothing to mirror

  const body = signalSummary(signal);

  if (signal.roomPostId) {
    const existing = await prisma.groupPost.findUnique({ where: { id: signal.roomPostId } });
    if (existing) {
      await prisma.groupPost.update({
        where: { id: existing.id },
        data: { groupId: room.id, body },
      });
      return;
    }
  }

  const authorId = signal.authorId ?? (await fallbackAuthorId());
  if (!authorId) return;

  const post = await prisma.groupPost.create({
    data: { groupId: room.id, authorId, kind: 'ANALYSIS', body },
  });
  await prisma.signal.update({ where: { id: signal.id }, data: { roomPostId: post.id } });
}

/** Removes the mirrored post when a signal is deleted. */
export async function removeSignalRoomPost(roomPostId: string | null): Promise<void> {
  if (!roomPostId) return;
  await prisma.groupPost.delete({ where: { id: roomPostId } }).catch(() => {});
}
