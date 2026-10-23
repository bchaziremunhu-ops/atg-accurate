/**
 * Smoke test for the main user flows. Run with: npm test
 * Boots the API on an ephemeral port and exercises auth, roles, signals,
 * courses, rooms, wallet approval and admin flows end-to-end.
 */
process.env.NODE_ENV = 'test';

import http from 'node:http';
import assert from 'node:assert';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { assertIsolatedTestDatabase, registerPayload } from './helpers.js';

const results: { name: string; ok: boolean; info?: string }[] = [];
async function step(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (e) {
    results.push({ name, ok: false, info: (e as Error).message });
    console.log(`  ✗ ${name} — ${(e as Error).message}`);
  }
}

async function main() {
  assertIsolatedTestDatabase();
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  const base = `http://localhost:${port}/api`;

  const email = `smoke_${Date.now()}@test.com`;
  const phone = `+26377${Date.now().toString().slice(-7)}`;
  let token = '';
  let adminToken = '';
  let depositId = '';

  const req = (path: string, opts: RequestInit = {}, tok?: string) =>
    fetch(base + path, {
      ...opts,
      headers: {
        'content-type': 'application/json',
        ...((tok ?? token) ? { authorization: `Bearer ${tok ?? token}` } : {}),
        ...(opts.headers ?? {}),
      },
    });

  await step('health check', async () => {
    const r = await req('/health');
    assert.equal(r.status, 200);
  });

  await step('register new FREE user', async () => {
    const r = await req('/auth/register', {
      method: 'POST',
      body: JSON.stringify(registerPayload({ name: 'Smoke Tester', email, phone })),
    });
    const body = (await r.json()) as { accessToken?: string; user?: { membership?: string } };
    assert.equal(r.status, 201, JSON.stringify(body));
    assert.equal(body.user?.membership, 'FREE');
    token = body.accessToken!;
  });

  await step('login existing user', async () => {
    const r = await req('/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'Password123!' }) });
    assert.equal(r.status, 200);
  });

  await step('login with phone number (identifier)', async () => {
    const r = await req('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: phone, password: 'Password123!' }) });
    assert.equal(r.status, 200);
    const bad = await req('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: `${phone}9999`, password: 'Password123!' }) });
    assert.equal(bad.status, 401, 'an unknown phone number must be rejected');
  });

  await step('reject weak password', async () => {
    const r = await req('/auth/register', {
      method: 'POST',
      body: JSON.stringify(registerPayload({ name: 'X', password: 'short' })),
    });
    assert.equal(r.status, 422);
  });

  await step('reject duplicate email', async () => {
    const r = await req('/auth/register', {
      method: 'POST',
      body: JSON.stringify(registerPayload({ name: 'Dup', email })),
    });
    assert.equal(r.status, 409);
  });

  await step('free user sees only FREE-audience signals', async () => {
    const r = await req('/signals');
    assert.equal(r.status, 200);
    const signals = (await r.json()) as Array<{ audience: string }>;
    assert.ok(Array.isArray(signals));
    assert.ok(signals.every((s) => s.audience === 'FREE'), 'should not leak VIP signals');
  });

  await step('free user is blocked from a VIP signal (402)', async () => {
    const vip = await prisma.signal.findFirst({ where: { audience: 'VIP_DERIV' } });
    if (!vip) return;
    const r = await req(`/signals/${vip.id}`);
    assert.equal(r.status, 402);
  });

  await step('list courses with free/paid flags', async () => {
    const r = await req('/courses');
    assert.equal(r.status, 200);
    const courses = (await r.json()) as Array<{ slug: string; isFree: boolean }>;
    assert.ok(courses.length > 0);
    assert.ok(courses.some((c) => c.isFree) && courses.some((c) => !c.isFree));
  });

  await step('enroll + track progress on a free course', async () => {
    const courses = (await (await req('/courses')).json()) as Array<{ slug: string; isFree: boolean }>;
    const free = courses.find((c) => c.isFree)!;
    const detail = (await (await req(`/courses/${free.slug}`)).json()) as { lessons: Array<{ id: string }> };
    const r = await req(`/courses/${free.slug}/progress`, {
      method: 'POST',
      body: JSON.stringify({ lessonId: detail.lessons[0].id, completed: true }),
    });
    assert.equal(r.status, 200);
    const body = (await r.json()) as { progress: number };
    assert.ok(body.progress > 0);
  });

  await step('completing a course issues a certificate (list + fetch)', async () => {
    const courses = (await (await req('/courses')).json()) as Array<{ slug: string; isFree: boolean }>;
    const free = courses.find((c) => c.isFree)!;
    const detail = (await (await req(`/courses/${free.slug}`)).json()) as { lessons: Array<{ id: string }> };
    for (const l of detail.lessons) {
      await req(`/courses/${free.slug}/progress`, {
        method: 'POST',
        body: JSON.stringify({ lessonId: l.id, completed: true }),
      });
    }

    const list = (await (await req('/users/certificates')).json()) as Array<{ id: string; course: { slug: string } | null }>;
    const cert = list.find((c) => c.course?.slug === free.slug);
    assert.ok(cert, 'completing every lesson should issue a certificate');

    const one = (await (await req(`/users/certificates/${cert.id}`)).json()) as {
      recipient: string;
      course: { title: string } | null;
    };
    assert.equal(one.recipient, 'Smoke Tester');
    assert.ok(one.course?.title, 'certificate resolves its course');

    // Certificates are owner-scoped: an unknown id is 404.
    const missing = await req('/users/certificates/does-not-exist');
    assert.equal(missing.status, 404);
  });

  await step('paid course blocked without verified payment (402)', async () => {
    const courses = (await (await req('/courses')).json()) as Array<{ slug: string; isFree: boolean }>;
    const paid = courses.find((c) => !c.isFree)!;
    const r = await req(`/courses/${paid.slug}/enroll`, { method: 'POST' });
    assert.equal(r.status, 402);
  });

  await step('deposit is PENDING (no auto-credit)', async () => {
    const r = await req('/wallet/deposit', { method: 'POST', body: JSON.stringify({ amount: 50, method: 'ECOCASH' }) });
    assert.equal(r.status, 201);
    const body = (await r.json()) as { transaction: { id: string; status: string } };
    depositId = body.transaction.id;
    assert.ok(['PENDING', 'PROCESSING'].includes(body.transaction.status), `status was ${body.transaction.status}`);
    const wallet = (await (await req('/wallet')).json()) as { balance: number };
    assert.equal(wallet.balance, 0, 'wallet must NOT be credited before verification');
  });

  await step('withdraw with insufficient balance rejected', async () => {
    const r = await req('/wallet/withdraw', {
      method: 'POST',
      body: JSON.stringify({ amount: 9999, method: 'ECOCASH', destination: '0770000000' }),
    });
    assert.equal(r.status, 400);
  });

  await step('free user cannot join the Deriv VIP room (402)', async () => {
    const room = await prisma.group.findFirst({ where: { accessTier: 'VIP_DERIV' } });
    if (!room) return;
    const r = await req(`/community/groups/${room.id}/join`, { method: 'POST' });
    assert.equal(r.status, 402);
  });

  await step('community post + like', async () => {
    const r = await req('/community/posts', { method: 'POST', body: JSON.stringify({ body: 'Hello ATG community 👋' }) });
    assert.equal(r.status, 201);
    const post = (await r.json()) as { id: string };
    const like = await req(`/community/posts/${post.id}/like`, { method: 'POST' });
    assert.equal(like.status, 200);
  });

  await step('wrong current password returns 401 (not 500)', async () => {
    const r = await req('/users/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: 'definitely-wrong', newPassword: 'Password456!' }),
    });
    assert.equal(r.status, 401);
  });

  await step('liking / commenting a missing post returns 404 (not 500)', async () => {
    const like = await req('/community/posts/does-not-exist/like', { method: 'POST' });
    assert.equal(like.status, 404);
    const comment = await req('/community/posts/does-not-exist/comments', {
      method: 'POST',
      body: JSON.stringify({ body: 'hi' }),
    });
    assert.equal(comment.status, 404);
  });

  await step('chart never fabricates prices (market data disabled)', async () => {
    const signal = await prisma.signal.findFirst({ where: { audience: 'FREE' } });
    if (!signal) return;
    const r = await req(`/signals/${signal.id}/chart`);
    assert.equal(r.status, 200);
    const body = (await r.json()) as { configured: boolean; candles: unknown[] };
    assert.equal(body.configured, false, 'no provider should be configured in tests');
    assert.equal(body.candles.length, 0, 'no candles may be invented');
  });

  await step('trading/execution endpoints are gone', async () => {
    const r = await fetch(base + '/broker/order', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ pair: 'V75', direction: 'BUY', entry: 100 }),
    });
    assert.equal(r.status, 404, 'there must be no trade-execution endpoint');
  });

  await step('non-admin blocked from admin API', async () => {
    const r = await req('/admin/stats');
    assert.equal(r.status, 403);
  });

  await step('admin can log in', async () => {
    const r = await req('/auth/login', { method: 'POST', body: JSON.stringify({ email: 'blessed@atg.com', password: '1953' }) });
    const body = (await r.json()) as { accessToken?: string; user?: { role?: string } };
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.equal(body.user?.role, 'ADMIN');
    adminToken = body.accessToken!;
  });

  await step('notification read state is restricted to its owner', async () => {
    const owner = await prisma.user.findUniqueOrThrow({
      where: { email: 'blessed@atg.com' },
      select: { id: true },
    });
    const notification = await prisma.notification.create({
      data: { userId: owner.id, title: 'Smoke notification', body: 'Owner-only read test', type: 'SYSTEM' },
    });
    try {
      const foreignRead = await req(`/notifications/${notification.id}/read`, { method: 'POST' });
      assert.equal(foreignRead.status, 200);
      const untouched = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } });
      assert.equal(untouched.read, false, 'another user must not mark the owner notification as read');

      const ownerRead = await req(`/notifications/${notification.id}/read`, { method: 'POST' }, adminToken);
      assert.equal(ownerRead.status, 200);
      const read = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } });
      assert.equal(read.read, true, 'the owner can mark their notification as read');
    } finally {
      await prisma.notification.deleteMany({ where: { id: notification.id } });
    }
  });

  await step('admin approves deposit -> wallet credited', async () => {
    const r = await req(`/admin/transactions/${depositId}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'approve' }),
    }, adminToken);
    assert.equal(r.status, 200);
    const wallet = (await (await req('/wallet')).json()) as { balance: number };
    assert.equal(wallet.balance, 50);
  });

  await step('wallet withdrawal is idempotent, audited, and only paid after confirmation', async () => {
    const idempotencyKey = `smoke-wallet-${Date.now()}`;
    const w = await req('/wallet/withdraw', {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify({ amount: 20, method: 'ECOCASH', destination: '0771234567', idempotencyKey }),
    });
    assert.equal(w.status, 201);
    const txn = (await w.json()) as { transaction: { id: string; status: string; reference: string } };
    assert.equal(txn.transaction.status, 'PENDING');
    let wallet = (await (await req('/wallet')).json()) as { balance: number };
    assert.equal(wallet.balance, 30, 'funds should be held immediately');

    const duplicate = await req('/wallet/withdraw', {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify({ amount: 20, method: 'ECOCASH', destination: '0771234567', idempotencyKey }),
    });
    assert.equal(duplicate.status, 200);
    assert.equal(((await duplicate.json()) as { duplicate: boolean }).duplicate, true);
    wallet = (await (await req('/wallet')).json()) as { balance: number };
    assert.equal(wallet.balance, 30, 'retry must not hold funds twice');

    const processing = await req(`/admin/transactions/${txn.transaction.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'processing' }),
    }, adminToken);
    assert.equal(processing.status, 200);
    assert.equal(((await processing.json()) as { status: string }).status, 'PROCESSING');

    const missingPayoutRef = await req(`/admin/transactions/${txn.transaction.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'paid' }),
    }, adminToken);
    assert.equal(missingPayoutRef.status, 400, 'payout cannot be marked complete without payment evidence');

    const paid = await req(`/admin/transactions/${txn.transaction.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'paid', providerRef: 'PAY-TEST-123' }),
    }, adminToken);
    assert.equal(paid.status, 200);
    const paidTxn = (await paid.json()) as { status: string; providerRef: string };
    assert.equal(paidTxn.status, 'COMPLETED');
    assert.equal(paidTxn.providerRef, 'PAY-TEST-123');
    wallet = (await (await req('/wallet')).json()) as { balance: number };
    assert.equal(wallet.balance, 30, 'paid transition must not deduct the held amount twice');

    const history = (await (await req('/wallet/transactions')).json()) as Array<{
      id: string;
      statusHistory: Array<{ toStatus: string }>;
    }>;
    const recorded = history.find((t) => t.id === txn.transaction.id);
    assert.deepEqual(recorded?.statusHistory.map((event) => event.toStatus), ['PENDING', 'PROCESSING', 'COMPLETED']);
  });

  await step('rejecting a wallet withdrawal records a reason and refunds held funds', async () => {
    const w = await req('/wallet/withdraw', {
      method: 'POST',
      body: JSON.stringify({ amount: 5, method: 'ECOCASH', destination: '0771234567' }),
    });
    assert.equal(w.status, 201);
    const txn = (await w.json()) as { transaction: { id: string } };
    let wallet = (await (await req('/wallet')).json()) as { balance: number };
    assert.equal(wallet.balance, 25, 'request should hold funds');
    const r = await req(`/admin/transactions/${txn.transaction.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'reject', adminNote: 'Test reject' }),
    }, adminToken);
    assert.equal(r.status, 200);
    wallet = (await (await req('/wallet')).json()) as { balance: number };
    assert.equal(wallet.balance, 30, 'rejected withdrawal should refund once');
  });

  await step('invalid USDT TRC20 destinations are rejected before holding wallet funds', async () => {
    const r = await req('/wallet/withdraw', {
      method: 'POST',
      body: JSON.stringify({ amount: 5, method: 'USDT_TRC20', destination: 'not-a-tron-address' }),
    });
    assert.equal(r.status, 400);
    assert.equal(((await r.json()) as { code?: string }).code, 'INVALID_DESTINATION');
    const wallet = (await (await req('/wallet')).json()) as { balance: number };
    assert.equal(wallet.balance, 30);
  });

  await step('admin can publish a Deriv VIP signal invisible to free user', async () => {
    const r = await req('/signals', {
      method: 'POST',
      body: JSON.stringify({ pair: 'Test V50', direction: 'BUY', entry: 100, takeProfit: 110, stopLoss: 95, audience: 'VIP_DERIV' }),
    }, adminToken);
    assert.equal(r.status, 201);
    const sig = (await r.json()) as { id: string };
    const freeView = (await (await req('/signals')).json()) as Array<{ id: string }>;
    assert.ok(!freeView.some((s) => s.id === sig.id), 'free user must not see a Deriv VIP signal');

    // The signal is mirrored into the Deriv VIP room automatically.
    const room = await prisma.group.findFirst({ where: { accessTier: 'VIP_DERIV' } });
    const mirrored = room
      ? await prisma.groupPost.findFirst({ where: { groupId: room.id, body: { contains: 'Test V50' } } })
      : null;
    assert.ok(mirrored, 'signal should appear as a post in the correct room');

    // Admin can close the signal with a final result; the mirrored post updates.
    const closed = await req(`/signals/${sig.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'HIT_TP', resultPct: 1.25, resultPips: 120 }),
    }, adminToken);
    assert.equal(closed.status, 200);
    const closedBody = (await closed.json()) as { status: string; resultPct: number; closedAt: string | null };
    assert.equal(closedBody.status, 'HIT_TP');
    assert.equal(closedBody.resultPct, 1.25);
    assert.ok(closedBody.closedAt, 'closing a signal records closedAt');
    const refreshed = mirrored ? await prisma.groupPost.findUnique({ where: { id: mirrored.id } }) : null;
    assert.ok(refreshed?.body.includes('Result: +1.25%'), 'mirrored post shows the final result');

    // Deleting the signal removes the mirrored post too.
    const del = await req(`/signals/${sig.id}`, { method: 'DELETE' }, adminToken);
    assert.equal(del.status, 200);
    const stillThere = mirrored
      ? await prisma.groupPost.findUnique({ where: { id: mirrored.id } })
      : null;
    assert.equal(stillThere, null, 'mirrored post should be deleted with the signal');
  });

  await step('signal stores its market/instrument group', async () => {
    const r = await req(
      '/signals',
      { method: 'POST', body: JSON.stringify({ pair: 'EUR/USD', market: 'Forex', direction: 'BUY', entry: 1.1, takeProfit: 1.2, stopLoss: 1.05, audience: 'VIP_WELTRADE' }) },
      adminToken,
    );
    assert.equal(r.status, 201);
    const sig = (await r.json()) as { id: string; market: string };
    assert.equal(sig.market, 'Forex');

    // market defaults to "Derived" when omitted
    const d = await req(
      '/signals',
      { method: 'POST', body: JSON.stringify({ pair: 'Default Market', direction: 'SELL', entry: 1, takeProfit: 0.9, stopLoss: 1.1, audience: 'VIP_DERIV' }) },
      adminToken,
    );
    const dSig = (await d.json()) as { id: string; market: string };
    assert.equal(dSig.market, 'Derived', 'market defaults to Derived');

    await req(`/signals/${sig.id}`, { method: 'DELETE' }, adminToken);
    await req(`/signals/${dSig.id}`, { method: 'DELETE' }, adminToken);
  });

  await step('admin manages a course (create/lesson/resource/publish/delete)', async () => {
    const slug = `smoke-${Date.now()}`;
    const created = await req(
      '/courses',
      { method: 'POST', body: JSON.stringify({ slug, title: 'Smoke Course', level: 'Beginner', price: 0, published: false }) },
      adminToken,
    );
    assert.equal(created.status, 201);
    const course = (await created.json()) as { id: string; slug: string };

    // A draft is hidden from the public list but visible to admins via ?all=true.
    const pub = (await (await req('/courses')).json()) as Array<{ id: string }>;
    assert.ok(!pub.some((c) => c.id === course.id), 'draft course should not appear publicly');
    const all = (await (await req('/courses?all=true', {}, adminToken)).json()) as Array<{ id: string }>;
    assert.ok(all.some((c) => c.id === course.id), 'admin should see drafts with ?all=true');
    const sneaky = (await (await req('/courses?all=true')).json()) as Array<{ id: string }>;
    assert.ok(!sneaky.some((c) => c.id === course.id), 'non-admin must not see drafts');

    // Add a lesson, then edit it.
    const lessonRes = await req(
      `/courses/${slug}/lessons`,
      { method: 'POST', body: JSON.stringify({ title: 'Lesson 1', videoUrl: 'https://example.com/v.mp4', durationMin: 5, order: 1, isFree: true }) },
      adminToken,
    );
    assert.equal(lessonRes.status, 201);
    const lesson = (await lessonRes.json()) as { id: string };
    const patched = await req(
      `/courses/${slug}/lessons/${lesson.id}`,
      { method: 'PATCH', body: JSON.stringify({ title: 'Lesson 1 (edited)', order: 2 }) },
      adminToken,
    );
    assert.equal(patched.status, 200);
    assert.equal(((await patched.json()) as { title: string }).title, 'Lesson 1 (edited)');

    // Attach a resource, then remove it.
    const resRes = await req(
      '/admin/resources',
      { method: 'POST', body: JSON.stringify({ courseId: course.id, title: 'Cheat sheet', type: 'PDF', url: 'https://example.com/s.pdf', sizeKb: 120 }) },
      adminToken,
    );
    assert.equal(resRes.status, 201);
    const resource = (await resRes.json()) as { id: string };
    const resDel = await req(`/admin/resources/${resource.id}`, { method: 'DELETE' }, adminToken);
    assert.equal(resDel.status, 200);

    // Publish, then delete the course.
    const publish = await req(`/courses/${slug}`, { method: 'PATCH', body: JSON.stringify({ published: true }) }, adminToken);
    assert.equal(publish.status, 200);
    const pub2 = (await (await req('/courses')).json()) as Array<{ id: string }>;
    assert.ok(pub2.some((c) => c.id === course.id), 'published course should now appear publicly');

    const del = await req(`/courses/${slug}`, { method: 'DELETE' }, adminToken);
    assert.equal(del.status, 200);
  });

  await step('free-course cap is enforced (create + PATCH-to-free)', async () => {
    const stats = (await (await req('/admin/stats', {}, adminToken)).json()) as { freeCourseLimit: number; freeCourses: number };
    const limit = stats.freeCourseLimit;
    const all = (await (await req('/courses?all=true', {}, adminToken)).json()) as Array<{ slug: string; price: number }>;
    let free = all.filter((c) => c.price <= 0).length;
    assert.ok(limit >= 1, 'a free-course limit is configured');

    // Fill any remaining free slots.
    const created: string[] = [];
    while (free < limit) {
      const slug = `smoke-free-${Date.now()}-${free}`;
      const r = await req('/courses', { method: 'POST', body: JSON.stringify({ slug, title: 'Free Filler', price: 0 }) }, adminToken);
      assert.equal(r.status, 201, `filler free course #${free + 1} should be allowed`);
      created.push(slug);
      free += 1;
    }

    // One more free course is rejected at the cap.
    const over = await req('/courses', { method: 'POST', body: JSON.stringify({ slug: `smoke-over-${Date.now()}`, title: 'Over Limit', price: 0 }) }, adminToken);
    assert.equal(over.status, 409, 'creating beyond the free-course cap is rejected');

    // Turning an existing paid course into a free one is blocked at the cap too.
    const paid = all.find((c) => c.price > 0);
    if (paid) {
      const toFree = await req(`/courses/${paid.slug}`, { method: 'PATCH', body: JSON.stringify({ price: 0 }) }, adminToken);
      assert.equal(toFree.status, 409, 'PATCH to free is blocked at the cap');
    }

    // Cleanup so the seeded catalogue is untouched.
    for (const slug of created) await req(`/courses/${slug}`, { method: 'DELETE' }, adminToken);
  });

  await step('non-admin cannot create a course (403)', async () => {
    const r = await req('/courses', { method: 'POST', body: JSON.stringify({ slug: 'nope', title: 'Nope' }) });
    assert.equal(r.status, 403);
  });

  await step('unauthenticated request blocked', async () => {
    const r = await fetch(base + '/wallet');
    assert.equal(r.status, 401);
  });

  await step('validation error shape', async () => {
    const r = await req('/courses', { method: 'POST', body: JSON.stringify({}) });
    assert.ok([401, 403, 422].includes(r.status));
  });

  await step('unknown API path returns a JSON 404', async () => {
    const r = await fetch(base + '/definitely-not-a-route');
    assert.equal(r.status, 404);
    const body = (await r.json()) as { error?: string };
    assert.equal(body.error, 'Not found');
  });

  await step('refresh tokens rotate; reuse past the grace window is revoked', async () => {
    const refreshEmail = `refresh_${Date.now()}@test.com`;
    const reg = await req('/auth/register', {
      method: 'POST',
      body: JSON.stringify(registerPayload({ name: 'Refresh Tester', email: refreshEmail })),
    });
    assert.equal(reg.status, 201);
    const { refreshToken: first } = (await reg.json()) as { refreshToken: string };

    const refresh = (token: string) =>
      fetch(base + '/auth/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: token }),
      });

    const r1 = await refresh(first);
    assert.equal(r1.status, 200);
    const { refreshToken: second } = (await r1.json()) as { refreshToken: string };
    assert.ok(second && second !== first, 'a fresh refresh token is issued');

    // First replay of the rotated-out token is tolerated once (concurrent
    // tabs refresh at the same instant) — it must not mint a third token.
    const grace = await refresh(first);
    assert.equal(grace.status, 200);

    // Anything beyond that single grace window kills the whole session.
    const reuse = await refresh(first);
    assert.equal(reuse.status, 401, 'token reuse past the grace window is revoked');
    const afterReuse = await refresh(second);
    assert.equal(afterReuse.status, 401, 'revocation invalidates every token for the user');

    await prisma.user.deleteMany({ where: { email: refreshEmail } }).catch(() => {});
  });

  await step('logout revokes the refresh token server-side', async () => {
    const outEmail = `logout_${Date.now()}@test.com`;
    const reg = await req('/auth/register', {
      method: 'POST',
      body: JSON.stringify(registerPayload({ name: 'Logout Tester', email: outEmail })),
    });
    const { refreshToken } = (await reg.json()) as { refreshToken: string };
    const login = await req('/auth/login', { method: 'POST', body: JSON.stringify({ email: outEmail, password: 'Password123!' }) });
    const { accessToken } = (await login.json()) as { accessToken: string };
    const out = await fetch(base + '/auth/logout', { method: 'POST', headers: { authorization: `Bearer ${accessToken}` } });
    assert.equal(out.status, 200);
    const after = await fetch(base + '/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    assert.equal(after.status, 401, 'refresh is dead after logout');
    await prisma.user.deleteMany({ where: { email: outEmail } }).catch(() => {});
  });

  await step('malformed / tampered refresh tokens are 401, not 500', async () => {
    const bad = await fetch(base + '/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'not.a.valid.jwt' }),
    });
    assert.equal(bad.status, 401);
  });

  await prisma.user.deleteMany({ where: { email } }).catch(() => {});
  server.close();
  await prisma.$disconnect();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
