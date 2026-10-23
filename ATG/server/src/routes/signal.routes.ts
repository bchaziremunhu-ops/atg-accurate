import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { optionalAuth, requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler, validate } from '../lib/http.js';
import { HttpError } from '../middleware/error.js';
import { broadcastToAudience } from '../services/notifications.service.js';
import { canAccess, isAdmin, accessLabel, type AccessLevel } from '../lib/permissions.js';
import { getMarketDataProvider } from '../services/marketData/index.js';
import { removeSignalRoomPost, syncSignalRoomPost } from '../services/signalRooms.js';

export const signalRouter = Router();

const AUDIENCES = ['FREE', 'PAID', 'VIP_DERIV', 'VIP_WELTRADE'] as const;

const signalFieldsSchema = z.object({
  pair: z.string().trim().min(1).max(80),
  market: z.string().trim().min(1).max(40).default('Derived'),
  direction: z.enum(['BUY', 'SELL']),
  entry: z.coerce.number().finite().positive(),
  takeProfit: z.coerce.number().finite().positive(),
  stopLoss: z.coerce.number().finite().positive(),
  timeframe: z.string().trim().min(1).max(12).default('15m'),
  audience: z.enum(AUDIENCES).default('FREE'),
  status: z.enum(['OPEN', 'HIT_TP', 'HIT_SL', 'CANCELLED']).default('OPEN'),
  analysis: z.string().trim().max(2000).optional().nullable(),
  chartUrl: z.string().url().optional().nullable(),
  resultPips: z.coerce.number().finite().optional().nullable(),
  resultPct: z.coerce.number().finite().optional().nullable(),
});

const signalSchema = signalFieldsSchema.refine((signal) =>
  signal.direction === 'BUY'
    ? signal.stopLoss < signal.entry && signal.entry < signal.takeProfit
    : signal.takeProfit < signal.entry && signal.entry < signal.stopLoss,
  { message: 'Prices must match the trade direction: BUY requires SL < entry < TP; SELL requires TP < entry < SL.' },
);

/** Signals the principal is allowed to see. */
function audienceFilter(user: { role: string; membership: string; extraAccessLevels?: string[] } | undefined) {
  if (!user || isAdmin(user)) return {};
  const allowed: string[] = ['FREE'];
  if (['PAID', 'VIP_DERIV', 'VIP_WELTRADE'].includes(user.membership)) allowed.push('PAID');
  if (user.membership === 'VIP_DERIV') allowed.push('VIP_DERIV');
  if (user.membership === 'VIP_WELTRADE') allowed.push('VIP_WELTRADE');
  allowed.push(...(user.extraAccessLevels ?? []));
  return { audience: { in: allowed } };
}

// List signals visible to the current member: ?audience=&status=&pair=&q=
signalRouter.get(
  '/',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const audience = req.query.audience as string | undefined;
    const status = req.query.status as string | undefined;
    const pair = req.query.pair as string | undefined;
    const q = req.query.q as string | undefined;

    const visible = audienceFilter(req.user);
    const signals = await prisma.signal.findMany({
      where: {
        AND: [
          visible,
          ...(audience ? [{ audience }] : []),
          ...(status ? [{ status }] : []),
          ...(pair ? [{ pair }] : []),
          ...(q ? [{ pair: { contains: q } }] : []),
        ],
      },
      orderBy: { publishedAt: 'desc' },
      take: 100,
      include: { author: { select: { id: true, name: true, avatarUrl: true } } },
    });
    res.json(signals);
  }),
);

// Which rooms/pages the current member may open (used by the client nav).
signalRouter.get(
  '/rooms/access',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const u = req.user;
    res.json({
      FREE: true,
      PAID: canAccess(u, 'PAID'),
      VIP_DERIV: canAccess(u, 'VIP_DERIV'),
      VIP_WELTRADE: canAccess(u, 'VIP_WELTRADE'),
      membership: u?.membership ?? 'FREE',
      isAdmin: isAdmin(u),
    });
  }),
);

signalRouter.get(
  '/results',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const visible = audienceFilter(req.user);
    const [total, wins, losses, open] = await Promise.all([
      prisma.signal.count({ where: visible }),
      prisma.signal.count({ where: { AND: [visible, { status: 'HIT_TP' }] } }),
      prisma.signal.count({ where: { AND: [visible, { status: 'HIT_SL' }] } }),
      prisma.signal.count({ where: { AND: [visible, { status: 'OPEN' }] } }),
    ]);
    const closed = wins + losses;
    res.json({
      total,
      wins,
      losses,
      open,
      winRate: closed ? Math.round((wins / closed) * 1000) / 10 : 0,
    });
  }),
);

signalRouter.get(
  '/:id',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const signal = await prisma.signal.findUnique({
      where: { id: req.params.id },
      include: { author: { select: { id: true, name: true, avatarUrl: true } } },
    });
    if (!signal) throw new HttpError(404, 'Signal not found');
    if (!canAccess(req.user, signal.audience as AccessLevel)) {
      throw new HttpError(402, `This signal is for ${accessLabel(signal.audience as AccessLevel)}`, 'UPGRADE_REQUIRED');
    }
    res.json(signal);
  }),
);

// Live chart series for a pair — only when a real market-data feed is
// configured. We never fabricate candles: if no feed is connected the client
// shows an explicit "not connected" state.
signalRouter.get(
  '/:id/chart',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const signal = await prisma.signal.findUnique({ where: { id: req.params.id } });
    if (!signal) throw new HttpError(404, 'Signal not found');
    if (!canAccess(req.user, signal.audience as AccessLevel)) {
      throw new HttpError(402, 'Upgrade required', 'UPGRADE_REQUIRED');
    }

    const timeframe = (req.query.timeframe as string) || signal.timeframe;
    const provider = getMarketDataProvider();
    if (!provider.configured) {
      return res.status(200).json({
        configured: false,
        provider: provider.name,
        pair: signal.pair,
        timeframe,
        entry: signal.entry,
        takeProfit: signal.takeProfit,
        stopLoss: signal.stopLoss,
        candles: [],
      });
    }

    const candles = await provider.getCandles(signal.pair, timeframe, 200);
    if (!candles) {
      return res.status(200).json({
        configured: true,
        provider: provider.name,
        stale: true,
        pair: signal.pair,
        timeframe,
        entry: signal.entry,
        takeProfit: signal.takeProfit,
        stopLoss: signal.stopLoss,
        candles: [],
      });
    }

    res.json({
      configured: true,
      provider: provider.name,
      pair: signal.pair,
      timeframe,
      entry: signal.entry,
      takeProfit: signal.takeProfit,
      stopLoss: signal.stopLoss,
      candles,
    });
  }),
);

// ---- Admin CRUD (publish / edit / update / close) ----
signalRouter.post(
  '/',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const data = validate(signalSchema, req.body);
    const signal = await prisma.signal.create({
      data: { ...data, tier: data.audience === 'FREE' ? 'FREE' : 'VIP', authorId: req.user!.id },
    });
    // Mirror into the matching room so members see it where their access lives.
    await syncSignalRoomPost(signal.id).catch(() => {});
    await broadcastToAudience(signal.audience as AccessLevel, {
      title: `New signal: ${signal.pair}`,
      body: `${signal.direction} @ ${signal.entry} · TP ${signal.takeProfit} · SL ${signal.stopLoss}`,
      type: 'SIGNAL',
      link: `/signals/${signal.id}`,
    });
    res.status(201).json(signal);
  }),
);

signalRouter.patch(
  '/:id',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const patch = validate(signalFieldsSchema.partial(), req.body);
    const prev = await prisma.signal.findUnique({ where: { id: req.params.id } });
    if (!prev) throw new HttpError(404, 'Signal not found');
    const data = validate(signalSchema, { ...prev, ...patch });

    const signal = await prisma.signal.update({
      where: { id: req.params.id },
      data: {
        ...data,
        tier: data.audience ? (data.audience === 'FREE' ? 'FREE' : 'VIP') : undefined,
        closedAt: patch.status ? (patch.status === 'OPEN' ? null : new Date()) : prev.closedAt,
      },
    });

    // Refresh the mirrored room post (moves rooms if the audience changed).
    await syncSignalRoomPost(signal.id).catch(() => {});

    if (data.status && data.status !== 'OPEN' && prev.status === 'OPEN') {
      await broadcastToAudience(signal.audience as AccessLevel, {
        title: `Signal closed: ${signal.pair}`,
        body: signal.status === 'HIT_TP' ? 'Target hit ✅' : signal.status === 'HIT_SL' ? 'Stop loss hit' : 'Signal cancelled',
        type: 'SIGNAL',
        link: `/signals/${signal.id}`,
      });
    } else if (prev.status === 'OPEN' && signal.status === 'OPEN') {
      await broadcastToAudience(signal.audience as AccessLevel, {
        title: `Signal updated: ${signal.pair}`,
        body: `${signal.direction} @ ${signal.entry} · TP ${signal.takeProfit} · SL ${signal.stopLoss}`,
        type: 'SIGNAL',
        link: `/signals/${signal.id}`,
      });
    }
    res.json(signal);
  }),
);

signalRouter.delete(
  '/:id',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const signal = await prisma.signal.findUnique({ where: { id: req.params.id } });
    if (signal) {
      await removeSignalRoomPost(signal.roomPostId);
      await prisma.signal.delete({ where: { id: signal.id } }).catch(() => {});
    }
    res.json({ ok: true });
  }),
);
