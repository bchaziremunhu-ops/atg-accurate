import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { syncSignalRoomPost } from '../src/services/signalRooms.js';

const prisma = new PrismaClient();

const GOLD = 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=800&q=80';

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The demo seed is disabled in production. Use the one-time admin bootstrap instead.');
  }

  console.log('Seeding ATG Traders…');

  const seedPassword = process.env.ADMIN_SEED_PASSWORD;
  if (!seedPassword || seedPassword.length < 16) {
    throw new Error('Set ADMIN_SEED_PASSWORD to a unique password of at least 16 characters before seeding.');
  }
  const adminHash = await bcrypt.hash(seedPassword, 12);

  const admin = await prisma.user.upsert({
    where: { email: 'blessed@atg.com' },
    update: { role: 'ADMIN', passwordHash: adminHash, membership: 'VIP_DERIV', isVip: true },
    create: {
      name: 'Blessed',
      email: 'blessed@atg.com',
      passwordHash: adminHash,
      role: 'ADMIN',
      membership: 'VIP_DERIV',
      isVip: true,
      bio: 'Official ATG Traders administrator.',
      wallet: { create: { balance: 100000 } },
    },
  });

  await prisma.signal.deleteMany({});
  await prisma.signal.createMany({
    data: [
      {
        pair: 'Volatility 75 (V75)',
        direction: 'BUY',
        entry: 385620,
        takeProfit: 386200,
        stopLoss: 384900,
        timeframe: '15m',
        audience: 'VIP_DERIV',
        tier: 'VIP',
        status: 'OPEN',
        analysis: 'Holding above the 385,600 support with bullish momentum on the 15m. Watching for a breakout continuation.',
        authorId: admin.id,
      },
      {
        pair: 'Volatility 100 (V100)',
        direction: 'BUY',
        entry: 1532.4,
        takeProfit: 1544.1,
        stopLoss: 1524.9,
        timeframe: '1H',
        audience: 'VIP_DERIV',
        tier: 'VIP',
        status: 'OPEN',
        analysis: 'Trend continuation on the 1H.',
        authorId: admin.id,
      },
      {
        pair: 'EUR/USD',
        direction: 'SELL',
        entry: 1.0872,
        takeProfit: 1.0822,
        stopLoss: 1.0905,
        timeframe: '1H',
        audience: 'VIP_WELTRADE',
        tier: 'VIP',
        status: 'OPEN',
        analysis: 'Rejection from the 1.0900 supply zone. Targeting the 1.0820 demand.',
        authorId: admin.id,
      },
      {
        pair: 'XAU/USD (Gold)',
        direction: 'BUY',
        entry: 2384.5,
        takeProfit: 2402.0,
        stopLoss: 2372.0,
        timeframe: '4H',
        audience: 'VIP_WELTRADE',
        tier: 'VIP',
        status: 'HIT_TP',
        resultPips: 175,
        resultPct: 0.73,
        analysis: 'Gold reclaimed the 4H trend line; momentum favoured the bulls.',
        authorId: admin.id,
      },
      {
        pair: 'Boom 500',
        direction: 'SELL',
        entry: 12458.2,
        takeProfit: 12438.2,
        stopLoss: 12478.5,
        timeframe: '5m',
        audience: 'FREE',
        tier: 'FREE',
        status: 'OPEN',
        analysis: 'Overbought on the 5m after a sharp spike. Bearish reversal setup.',
        authorId: admin.id,
      },
      {
        pair: 'Crash 500',
        direction: 'BUY',
        entry: 9452.3,
        takeProfit: 9502.3,
        stopLoss: 9420.1,
        timeframe: '15m',
        audience: 'FREE',
        tier: 'FREE',
        status: 'HIT_TP',
        resultPips: 50,
        resultPct: 0.53,
        analysis: 'Support bounce with rising volume.',
        authorId: admin.id,
      },
      {
        pair: 'PainX 400',
        direction: 'BUY',
        entry: 4512.8,
        takeProfit: 4560.0,
        stopLoss: 4480.0,
        timeframe: '15m',
        audience: 'FREE',
        tier: 'FREE',
        status: 'OPEN',
        analysis: 'Free setup for the community.',
        authorId: admin.id,
      },
      {
        pair: 'Step Index',
        direction: 'SELL',
        entry: 8921.5,
        takeProfit: 8870.0,
        stopLoss: 8960.0,
        timeframe: '30m',
        audience: 'VIP_DERIV',
        tier: 'VIP',
        status: 'HIT_SL',
        resultPips: -38,
        resultPct: -0.43,
        analysis: 'Failed breakdown, stopped out.',
        authorId: admin.id,
      },
    ],
  });

  await prisma.course.deleteMany({});
  const courseDefs = [
    {
      slug: 'introduction-to-trading',
      title: 'Introduction to Trading',
      level: 'Beginner',
      price: 0,
      duration: 12,
      lessons: ['What is trading?', 'Market participants', 'Reading a chart'],
    },
    {
      slug: 'understanding-synthetic-indices',
      title: 'Understanding Synthetic Indices',
      level: 'Beginner',
      price: 0,
      duration: 15,
      lessons: ['What are synthetic indices?', 'Volatility & Crash/Boom', 'Risk on synthetics'],
    },
    {
      slug: 'risk-management',
      title: 'Risk Management Basics',
      level: 'Beginner',
      price: 0,
      duration: 14,
      lessons: ['Position sizing', 'Stop-loss discipline', 'Drawdown control'],
    },
    {
      slug: 'trading-strategies',
      title: 'Trading Strategies',
      level: 'Intermediate',
      price: 19.99,
      duration: 18,
      lessons: ['Trend following', 'Breakout strategies', 'Entry & exit timing'],
    },
    {
      slug: 'live-trading-examples',
      title: 'Live Trading Examples',
      level: 'Advanced',
      price: 29.99,
      duration: 20,
      lessons: ['Live V75 trade', 'Live Boom 500 trade'],
    },
    {
      slug: 'advanced-price-action',
      title: 'Advanced Price Action',
      level: 'Advanced',
      price: 39.99,
      duration: 24,
      lessons: ['Market structure', 'Liquidity & sweeps', 'Multi-timeframe entries'],
    },
  ];

  for (let i = 0; i < courseDefs.length; i++) {
    const c = courseDefs[i];
    const course = await prisma.course.create({
      data: {
        slug: c.slug,
        title: c.title,
        level: c.level,
        order: i,
        price: c.price,
        isVip: false,
        coverUrl: `${GOLD}&sig=${i}`,
        description: `${c.title} — practical, repeatable skills.${c.price > 0 ? ' Paid course — unlock after verified payment.' : ' Free short course.'}`,
        lessons: {
          create: c.lessons.map((title, idx) => ({
            title,
            order: idx,
            durationMin: Math.round(c.duration / c.lessons.length),
            isFree: idx === 0,
            videoUrl: null,
          })),
        },
      },
    });
  }

  await prisma.groupPost.deleteMany({});
  const general = await prisma.group.upsert({
    where: { name: 'General' },
    update: { accessTier: 'FREE', roomType: 'GENERAL', isChatOpen: true },
    create: { name: 'General', description: 'Connect. Learn. Share.', category: 'General', accessTier: 'FREE', roomType: 'GENERAL', ownerId: admin.id },
  });
  const analysis = await prisma.group.upsert({
    where: { name: 'Market Analysis' },
    update: { accessTier: 'FREE', roomType: 'GENERAL', isChatOpen: true },
    create: { name: 'Market Analysis', description: 'Share your charts and setups.', category: 'Analysis', accessTier: 'FREE', roomType: 'GENERAL', ownerId: admin.id },
  });
  const derivRoom = await prisma.group.upsert({
    where: { name: 'Deriv VIP' },
    update: { accessTier: 'VIP_DERIV', roomType: 'DERIV', visibility: 'VIP', isChatOpen: true },
    create: {
      name: 'Deriv VIP',
      description: 'Deriv synthetic indices signals & chat.',
      category: 'General',
      accessTier: 'VIP_DERIV',
      roomType: 'DERIV',
      visibility: 'VIP',
      ownerId: admin.id,
    },
  });
  const weltradeRoom = await prisma.group.upsert({
    where: { name: 'Weltrade VIP' },
    update: { accessTier: 'VIP_WELTRADE', roomType: 'WELTRADE', visibility: 'VIP', isChatOpen: true },
    create: {
      name: 'Weltrade VIP',
      description: 'Weltrade FX & metals signals room.',
      category: 'General',
      accessTier: 'VIP_WELTRADE',
      roomType: 'WELTRADE',
      visibility: 'VIP',
      ownerId: admin.id,
    },
  });

  await prisma.groupPost.createMany({
    data: [
      {
        groupId: general.id,
        authorId: admin.id,
        kind: 'POST',
        body: "Let's stay focused this week. Discipline always wins 💪",
        createdAt: new Date(Date.now() - 10 * 60_000),
      },
      {
        groupId: analysis.id,
        authorId: admin.id,
        kind: 'WIN',
        body: 'Nice reaction on V75 after the signal 🔥\nWhat a session!',
        imageUrl: `${GOLD}&sig=post1`,
        createdAt: new Date(Date.now() - 25 * 60_000),
      },
      {
        groupId: derivRoom.id,
        authorId: admin.id,
        kind: 'ANALYSIS',
        body: 'V75 broke the 385,600 resistance. Watching for a retest to add. 🎯',
        createdAt: new Date(Date.now() - 15 * 60_000),
      },
      {
        groupId: weltradeRoom.id,
        authorId: admin.id,
        kind: 'ANALYSIS',
        body: 'Gold TP hit at 2402.0 ✅ Beautiful 4H setup.',
        createdAt: new Date(Date.now() - 35 * 60_000),
      },
    ],
  });

  const posts = await prisma.groupPost.findMany();
  for (const p of posts) {
    await prisma.postLike.createMany({ data: [{ postId: p.id, userId: admin.id }] });
  }

  const seededSignals = await prisma.signal.findMany();
  for (const s of seededSignals) {
    await syncSignalRoomPost(s.id);
  }

  console.log('Seed complete.');
  console.log(`  Admin: ${admin.email} (sign in with ADMIN_SEED_PASSWORD).`);
  console.log('  Traders sign up / sign in with their phone number + password.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
