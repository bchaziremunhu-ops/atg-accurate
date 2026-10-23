import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { io as createSocketClient, type Socket } from 'socket.io-client';
import { createApp } from '../app.js';
import { env } from '../config/env.js';
import { runMembershipAccessExpiryNotifications } from '../jobs/subscriptionExpiry.js';
import { signAccessToken } from '../lib/jwt.js';
import { prisma } from '../lib/prisma.js';
import { initRealtime } from '../realtime/socket.js';
import { broadcastToAudience } from '../services/notifications.service.js';
import { assertIsolatedTestDatabase } from './helpers.js';

if (process.env.RUN_MANUAL_PURCHASE_TESTS !== '1' || env.nodeEnv === 'production') {
  throw new Error('Set RUN_MANUAL_PURCHASE_TESTS=1 and use a non-production database to run this integration suite.');
}
assertIsolatedTestDatabase();

const runId = `manual-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let pngProof: Buffer<ArrayBufferLike> = Buffer.alloc(0);
const proofFile = () => new Blob([new Uint8Array(pngProof)], { type: 'image/png' });
const results: string[] = [];
const requestReferences: string[] = [];
let server: ReturnType<typeof createServer> | undefined;
let realtime: ReturnType<typeof initRealtime> | undefined;
const sockets: Socket[] = [];
let userId: string | undefined;
let otherUserId: string | undefined;
let adminId: string | undefined;
let courseId: string | undefined;
let otherCourseId: string | undefined;
let createdCourseId: string | undefined;
let createdCourseSlug: string | undefined;
let packageId: string | undefined;
let groupId: string | undefined;
let otherGroupId: string | undefined;
let signalId: string | undefined;

async function step(name: string, callback: () => Promise<void>) {
  await callback();
  results.push(name);
  console.log(`  ✓ ${name}`);
}

async function main() {
  pngProof = await sharp({
    create: { width: 2, height: 2, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  }).png().toBuffer();
  const user = await prisma.user.create({
    data: { email: `${runId}-user@example.test`, name: 'Manual purchase test user', passwordHash: 'unused-test-hash' },
    select: { id: true },
  });
  userId = user.id;
  const otherUser = await prisma.user.create({
    data: { email: `${runId}-other@example.test`, name: 'Other purchase test user', passwordHash: 'unused-test-hash' },
    select: { id: true },
  });
  otherUserId = otherUser.id;
  const admin = await prisma.user.create({
    data: { email: `${runId}-admin@example.test`, name: 'Manual purchase test admin', passwordHash: 'unused-test-hash', role: 'ADMIN' },
    select: { id: true },
  });
  adminId = admin.id;
  const course = await prisma.course.create({
    data: { slug: runId, title: `Manual test ${runId}`, description: 'Temporary integration fixture', price: 12.5, currency: 'USD' },
    select: { id: true, slug: true },
  });
  courseId = course.id;
  const otherCourse = await prisma.course.create({
    data: { slug: `${runId}-other`, title: `Other paid course ${runId}`, price: 35, currency: 'USD' },
    select: { id: true, slug: true },
  });
  otherCourseId = otherCourse.id;
  const group = await prisma.group.create({
    data: { name: `Manual test ${runId}`, accessTier: 'VIP_DERIV', roomType: 'DERIV' },
    select: { id: true },
  });
  groupId = group.id;
  const otherGroup = await prisma.group.create({
    data: { name: `Manual test other ${runId}`, accessTier: 'VIP_WELTRADE', roomType: 'WELTRADE' },
    select: { id: true },
  });
  otherGroupId = otherGroup.id;

  const app = createApp();
  server = createServer(app);
  realtime = initRealtime(server);
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  const baseUrl = `http://127.0.0.1:${port}/api`;
  const userToken = signAccessToken({ sub: user.id, role: 'USER', isVip: false });
  const otherUserToken = signAccessToken({ sub: otherUser.id, role: 'USER', isVip: false });
  const adminToken = signAccessToken({ sub: admin.id, role: 'ADMIN', isVip: false });
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  async function json(pathname: string, token: string, method = 'GET', body?: unknown) {
    return fetch(`${baseUrl}${pathname}`, {
      method,
      headers: { ...auth(token), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  async function submit(token: string, itemType: 'COURSE' | 'MEMBERSHIP', itemId: string, amount: string, reference: string, file = proofFile()) {
    const form = new FormData();
    form.set('itemType', itemType);
    form.set('itemId', itemId);
    form.set('amountPaid', amount);
    form.set('paymentMethod', 'BANK_TRANSFER');
    form.set('paymentReference', reference);
    form.set('proof', file, 'payment.png');
    const response = await fetch(`${baseUrl}/purchase-requests`, { method: 'POST', headers: auth(token), body: form });
    const data = await response.json() as { id?: string; reference?: string; status?: string; duplicateReference?: boolean; error?: string };
    if (response.ok && data.reference) requestReferences.push(data.reference);
    return { response, data };
  }

  async function openSocket(token: string): Promise<Socket> {
    const socket = createSocketClient(`http://127.0.0.1:${port}`, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
      setTimeout(() => reject(new Error('Timed out connecting to community chat.')), 5000).unref();
    });
    return socket;
  }

  async function joinSocketRoom(socket: Socket, id: string): Promise<boolean> {
    return new Promise((resolve) => socket.emit('group:join', id, resolve));
  }

  async function sendSocketMessage(socket: Socket, id: string, body: string): Promise<boolean> {
    return new Promise((resolve) => socket.emit('group:message', { groupId: id, body }, resolve));
  }

  try {
    await step('reject incorrect and unavailable purchase amounts/items', async () => {
      const wrong = await submit(userToken, 'COURSE', course.id, '1.00', `${runId}-wrong`);
      assert.equal(wrong.response.status, 400);
      await prisma.course.update({ where: { id: course.id }, data: { saleStatus: 'UNAVAILABLE' } });
      const unavailable = await submit(userToken, 'COURSE', course.id, '12.50', `${runId}-unavailable`);
      assert.equal(unavailable.response.status, 409);
      await prisma.course.update({ where: { id: course.id }, data: { saleStatus: 'AVAILABLE' } });
    });

    await step('reject unsupported and oversized payment proof images', async () => {
      const wrongType = new Blob(['not an image'], { type: 'text/plain' });
      const invalid = await submit(userToken, 'COURSE', course.id, '12.50', `${runId}-invalid-image`, wrongType);
      assert.equal(invalid.response.status, 400);
      const signatureOnly = new Blob([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' });
      const malformed = await submit(userToken, 'COURSE', course.id, '12.50', `${runId}-malformed-image`, signatureOnly);
      assert.equal(malformed.response.status, 400);
      const oversized = new Blob([Buffer.alloc(5 * 1024 * 1024 + 1)], { type: 'image/png' });
      const tooLarge = await submit(userToken, 'COURSE', course.id, '12.50', `${runId}-large-image`, oversized);
      assert.equal(tooLarge.response.status, 413);
    });

    let firstRequestId = '';
    const firstReference = `${runId}-shared-payment`;
    await step('create a price-snapshotted request and preserve it after price edits', async () => {
      const created = await submit(userToken, 'COURSE', course.id, '12.50', firstReference);
      assert.equal(created.response.status, 201, JSON.stringify(created.data));
      firstRequestId = created.data.id!;
      await prisma.course.update({ where: { id: course.id }, data: { price: 20 } });
      const stored = await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: firstRequestId } });
      assert.ok(stored.amountSnapshot.equals('12.50'));
      const stalePrice = await submit(userToken, 'COURSE', course.id, '12.50', `${runId}-stale-price`);
      assert.equal(stalePrice.response.status, 400);
    });

    let duplicateRequestId = '';
    await step('flag reused transaction references for investigation', async () => {
      const duplicate = await submit(userToken, 'COURSE', course.id, '20.00', firstReference);
      assert.equal(duplicate.response.status, 201, JSON.stringify(duplicate.data));
      assert.equal(duplicate.data.duplicateReference, true);
      duplicateRequestId = duplicate.data.id!;
      const concurrentReference = `${runId}-concurrent`;
      const concurrent = await Promise.all([
        submit(userToken, 'COURSE', course.id, '20.00', concurrentReference),
        submit(userToken, 'COURSE', course.id, '20.00', concurrentReference),
      ]);
      assert.ok(concurrent.every((request) => request.response.status === 201));
      assert.deepEqual(concurrent.map((request) => request.data.duplicateReference).sort(), [false, true]);
    });

    await step('enforce request ownership and admin role checks', async () => {
      const customerList = await json('/purchase-requests', userToken);
      assert.equal(customerList.status, 200);
      const requests = await customerList.json() as Array<{ id: string; internalNotes?: string | null }>;
      assert.ok(requests.some((request) => request.id === firstRequestId));
      assert.ok(requests.every((request) => !('internalNotes' in request)));
      const foreignList = await json('/purchase-requests', otherUserToken);
      assert.equal(foreignList.status, 200);
      assert.deepEqual(await foreignList.json(), []);
      const forbiddenQueue = await json('/purchase-requests/admin', userToken);
      assert.equal(forbiddenQueue.status, 403);
      const forbiddenPackageManagement = await json('/purchase-requests/admin/packages', userToken);
      assert.equal(forbiddenPackageManagement.status, 403);
      const forbiddenProof = await json(`/purchase-requests/${firstRequestId}/proof`, otherUserToken);
      assert.equal(forbiddenProof.status, 404);
      const ownerProof = await json(`/purchase-requests/${firstRequestId}/proof`, userToken);
      assert.equal(ownerProof.status, 200);
      assert.equal(ownerProof.headers.get('cache-control'), 'private, no-store');
      const queue = await json('/purchase-requests/admin', adminToken);
      assert.equal(queue.status, 200);
    });

    await step('publish course updates clearly and protect lesson/course ownership', async () => {
      const forbiddenCreate = await json('/courses', userToken, 'POST', {
        slug: `${runId}-user-course`,
        title: 'Unauthorized course',
        price: 15,
      });
      assert.equal(forbiddenCreate.status, 403);

      const created = await json('/courses', adminToken, 'POST', {
        slug: `${runId}-education`,
        title: `Education ${runId}`,
        description: 'Temporary course publication test',
        level: 'Beginner',
        price: 19,
        currency: 'USD',
        published: false,
        saleStatus: 'AVAILABLE',
      });
      assert.equal(created.status, 201);
      const courseData = await created.json() as { id: string; slug: string };
      createdCourseId = courseData.id;
      createdCourseSlug = courseData.slug;
      assert.equal(await prisma.notification.count({
        where: { userId: user.id, title: { contains: runId } },
      }), 0, 'draft courses do not notify customers');

      const published = await json(`/courses/${courseData.slug}`, adminToken, 'PATCH', { published: true });
      assert.equal(published.status, 200);
      const customerCatalog = await json('/courses', userToken);
      const catalog = await customerCatalog.json() as Array<{ slug: string; currency: string }>;
      assert.equal(catalog.find((item) => item.slug === courseData.slug)?.currency, 'USD');
      assert.equal(await prisma.notification.count({
        where: { userId: user.id, title: `New course: Education ${runId}` },
      }), 1, 'customers receive a notice when the course becomes available');

      const customerDetail = await json(`/courses/${courseData.slug}`, userToken);
      const detail = await customerDetail.json() as { lessons: Array<{ id: string; locked: boolean }> };
      assert.equal(customerDetail.status, 200);
      assert.equal(detail.lessons.length, 0);

      const lessonResponse = await json(`/courses/${courseData.slug}/lessons`, adminToken, 'POST', {
        title: 'Locked integration lesson',
        durationMin: 5,
        order: 0,
      });
      assert.equal(lessonResponse.status, 201);
      const lesson = await lessonResponse.json() as { id: string };
      const lockedDetail = await json(`/courses/${courseData.slug}`, userToken);
      const lockedData = await lockedDetail.json() as { lessons: Array<{ id: string; locked: boolean }> };
      assert.equal(lockedData.lessons.find((item) => item.id === lesson.id)?.locked, true);
      assert.equal(await prisma.notification.count({
        where: { userId: user.id, title: `New lesson: Education ${runId}` },
      }), 1, 'published lesson updates notify customers');

      const wrongCoursePatch = await json(`/courses/${otherCourse.slug}/lessons/${lesson.id}`, adminToken, 'PATCH', {
        title: 'Wrong parent course',
      });
      const wrongCourseDelete = await json(`/courses/${otherCourse.slug}/lessons/${lesson.id}`, adminToken, 'DELETE');
      assert.equal(wrongCoursePatch.status, 404);
      assert.equal(wrongCourseDelete.status, 404);
      assert.ok(await prisma.lesson.findUnique({ where: { id: lesson.id } }), 'cross-course requests must not alter the lesson');

      await json(`/courses/${courseData.slug}`, adminToken, 'PATCH', { saleStatus: 'HIDDEN' });
      const hiddenDetail = await json(`/courses/${courseData.slug}`, userToken);
      const hiddenResources = await json(`/courses/${courseData.slug}/resources`, userToken);
      assert.equal(hiddenDetail.status, 404);
      assert.equal(hiddenResources.status, 404);
    });

    await step('protect live VIP chat rooms before and after entitlement changes', async () => {
      const socket = await openSocket(userToken);
      assert.equal(await joinSocketRoom(socket, group.id), false);
      const unauthorizedBody = `${runId}-unauthorized-live`;
      assert.equal(await sendSocketMessage(socket, group.id, unauthorizedBody), false);
      assert.equal(await prisma.message.count({ where: { body: unauthorizedBody } }), 0);

      const testGrant = await prisma.membershipRoomAccess.create({
        data: {
          userId: user.id,
          requestId: firstRequestId,
          accessLevel: 'VIP_DERIV',
          startsAt: new Date(Date.now() - 60_000),
          expiresAt: new Date(Date.now() + 60_000),
          approvalReference: `${runId}-live-test`,
        },
      });
      assert.equal(await joinSocketRoom(socket, group.id), true);
      const authorizedBody = `${runId}-authorized-live`;
      assert.equal(await sendSocketMessage(socket, group.id, authorizedBody), true);
      assert.equal(await prisma.message.count({ where: { body: authorizedBody } }), 1);

      assert.equal(await joinSocketRoom(socket, otherGroup.id), false);
      const wrongRoomBody = `${runId}-wrong-room-live`;
      assert.equal(await sendSocketMessage(socket, otherGroup.id, wrongRoomBody), false);
      assert.equal(await prisma.message.count({ where: { body: wrongRoomBody } }), 0);

      await prisma.membershipRoomAccess.updateMany({
        where: { userId: user.id, accessLevel: 'VIP_DERIV' },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      assert.equal(await joinSocketRoom(socket, group.id), false);
      const expiredBody = `${runId}-expired-live`;
      assert.equal(await sendSocketMessage(socket, group.id, expiredBody), false);
      assert.equal(await prisma.message.count({ where: { body: expiredBody } }), 0);
      await prisma.membershipRoomAccess.delete({ where: { id: testGrant.id } });
    });

    await step('review, approve, unlock only the purchased course, and prevent duplicate approval', async () => {
      const review = await json(`/purchase-requests/admin/${firstRequestId}/review`, adminToken, 'POST', {
        action: 'UNDER_REVIEW',
        internalNotes: 'Internal test review',
      });
      assert.equal(review.status, 200);
      const customerList = await json('/purchase-requests', userToken);
      const customerRequests = await customerList.json() as Array<{ id: string; status: string; internalNotes?: string | null }>;
      const reviewed = customerRequests.find((request) => request.id === firstRequestId);
      assert.equal(reviewed?.status, 'UNDER_REVIEW');
      assert.ok(!('internalNotes' in reviewed!));

      const approved = await json(`/purchase-requests/admin/${firstRequestId}/review`, adminToken, 'POST', {
        action: 'APPROVE',
        paymentChecked: true,
      });
      assert.equal(approved.status, 200);
      const paidCourse = await prisma.purchase.findFirst({ where: { userId: user.id, itemId: course.id, status: 'PAID' } });
      assert.ok(paidCourse);
      assert.equal(paidCourse.amount, 12.5);
      assert.ok(await prisma.enrollment.findUnique({ where: { userId_courseId: { userId: user.id, courseId: course.id } } }));
      const otherCourseDetail = await json(`/courses/${otherCourse.slug}`, userToken);
      const otherCourseData = await otherCourseDetail.json() as { entitled: boolean };
      assert.equal(otherCourseData.entitled, false);
      const repeat = await json(`/purchase-requests/admin/${firstRequestId}/review`, adminToken, 'POST', {
        action: 'APPROVE',
        paymentChecked: true,
      });
      assert.equal(repeat.status, 409);
    });

    await step('require explicit investigation before approving a duplicate reference', async () => {
      const blocked = await json(`/purchase-requests/admin/${duplicateRequestId}/review`, adminToken, 'POST', {
        action: 'APPROVE',
        paymentChecked: true,
      });
      assert.equal(blocked.status, 409);
      const approved = await json(`/purchase-requests/admin/${duplicateRequestId}/review`, adminToken, 'POST', {
        action: 'APPROVE',
        paymentChecked: true,
        duplicateReferenceResolved: true,
        internalNotes: 'Investigated reuse in isolated integration test.',
      });
      assert.equal(approved.status, 200);
    });

    await step('reject with a mandatory reason and show it to the customer', async () => {
      const rejected = await submit(userToken, 'COURSE', course.id, '20.00', `${runId}-reject`);
      assert.equal(rejected.response.status, 201);
      const missingReason = await json(`/purchase-requests/admin/${rejected.data.id}/review`, adminToken, 'POST', { action: 'REJECT' });
      assert.equal(missingReason.status, 400);
      const decision = await json(`/purchase-requests/admin/${rejected.data.id}/review`, adminToken, 'POST', {
        action: 'REJECT',
        reason: 'Payment could not be matched.',
      });
      assert.equal(decision.status, 200);
      const customerList = await json('/purchase-requests', userToken);
      const records = await customerList.json() as Array<{ id: string; decisionReason?: string | null }>;
      assert.equal(records.find((request) => request.id === rejected.data.id)?.decisionReason, 'Payment could not be matched.');
    });

    await step('cancel an under-review request and retain its actual prior status in audit history', async () => {
      const pending = await submit(userToken, 'COURSE', course.id, '20.00', `${runId}-cancel`);
      assert.equal(pending.response.status, 201);
      const underReview = await json(`/purchase-requests/admin/${pending.data.id}/review`, adminToken, 'POST', {
        action: 'UNDER_REVIEW',
      });
      assert.equal(underReview.status, 200);
      const cancelled = await json(`/purchase-requests/${pending.data.id}/cancel`, userToken, 'POST');
      assert.equal(cancelled.status, 200);
      const event = await prisma.purchaseRequestEvent.findFirstOrThrow({
        where: { requestId: pending.data.id, action: 'CANCELLED' },
      });
      assert.equal(event.fromStatus, 'UNDER_REVIEW');
    });

    await step('create membership package, grant only its room, and schedule renewal after current access', async () => {
      const createdPackage = await json('/purchase-requests/admin/packages', adminToken, 'POST', {
        slug: runId,
        title: `Manual test package ${runId}`,
        description: 'Temporary integration fixture',
        price: 25,
        currency: 'USD',
        durationDays: 30,
        activationRule: 'AFTER_CURRENT_ACCESS',
        includedRooms: ['VIP_DERIV'],
        saleStatus: 'AVAILABLE',
      });
      assert.equal(createdPackage.status, 201);
      const packageData = await createdPackage.json() as { id: string };
      packageId = packageData.id;
      const unavailablePackage = await json(`/purchase-requests/admin/packages/${packageData.id}`, adminToken, 'PATCH', {
        saleStatus: 'UNAVAILABLE',
      });
      assert.equal(unavailablePackage.status, 200);
      const refusedPackageRequest = await submit(userToken, 'MEMBERSHIP', packageData.id, '25.00', `${runId}-unavailable-package`);
      assert.equal(refusedPackageRequest.response.status, 409);
      const availablePackage = await json(`/purchase-requests/admin/packages/${packageData.id}`, adminToken, 'PATCH', {
        saleStatus: 'AVAILABLE',
      });
      assert.equal(availablePackage.status, 200);
      const initial = await submit(userToken, 'MEMBERSHIP', packageData.id, '25.00', `${runId}-membership-1`);
      assert.equal(initial.response.status, 201);
      const approveInitial = await json(`/purchase-requests/admin/${initial.data.id}/review`, adminToken, 'POST', {
        action: 'APPROVE',
        paymentChecked: true,
      });
      assert.equal(approveInitial.status, 200);
      const firstGrant = await prisma.membershipRoomAccess.findFirstOrThrow({ where: { requestId: initial.data.id } });
      assert.equal(firstGrant.accessLevel, 'VIP_DERIV');
      const accessGroups = await json('/community/groups', userToken);
      const groups = await accessGroups.json() as Array<{ id: string; canAccess: boolean }>;
      assert.equal(groups.find((item) => item.id === group.id)?.canAccess, true);
      const wrongRoom = await json(`/community/groups/${otherGroup.id}`, userToken);
      assert.equal(wrongRoom.status, 402);
      const visibleSignals = await json('/signals', userToken);
      assert.equal(visibleSignals.status, 200);
      const visibleSignalRows = await visibleSignals.json() as Array<{ audience: string }>;
      assert.ok(visibleSignalRows.some((signal) => signal.audience === 'VIP_DERIV'));

      const invalidSignal = await json('/signals', adminToken, 'POST', {
        pair: `Invalid ${runId}`,
        direction: 'BUY',
        entry: 100,
        takeProfit: 90,
        stopLoss: 110,
        audience: 'VIP_DERIV',
      });
      assert.equal(invalidSignal.status, 422, 'reject signal prices that contradict the trade direction');
      const published = await json('/signals', adminToken, 'POST', {
        pair: `Signal ${runId}`,
        direction: 'BUY',
        entry: 100,
        takeProfit: 110,
        stopLoss: 90,
        audience: 'VIP_DERIV',
        timeframe: '15m',
        analysis: 'Integration-test signal',
      });
      assert.equal(published.status, 201);
      const signal = await published.json() as { id: string };
      signalId = signal.id;
      const userSignal = await json(`/signals/${signal.id}`, userToken);
      assert.equal(userSignal.status, 200, 'manual room members can open signals for their room');
      const otherUserSignal = await json(`/signals/${signal.id}`, otherUserToken);
      assert.equal(otherUserSignal.status, 402, 'users without the matching room cannot open VIP signals');
      assert.equal(await prisma.notification.count({
        where: { userId: user.id, title: `New signal: Signal ${runId}` },
      }), 1, 'signal publication notifies manually entitled members');

      const closedSignal = await json(`/signals/${signal.id}`, adminToken, 'PATCH', {
        status: 'HIT_TP',
        resultPct: 2,
        resultPips: 120,
      });
      assert.equal(closedSignal.status, 200);
      const customerUpdate = await json(`/signals/${signal.id}`, userToken);
      const customerSignal = await customerUpdate.json() as { status: string; resultPct: number };
      assert.equal(customerSignal.status, 'HIT_TP');
      assert.equal(customerSignal.resultPct, 2);
      assert.equal(await prisma.notification.count({
        where: { userId: user.id, title: `Signal closed: Signal ${runId}` },
      }), 1, 'signal result updates notify the entitled audience');

      const communityPostResponse = await json('/community/posts', userToken, 'POST', {
        groupId: group.id,
        kind: 'QUESTION',
        body: `Question for ATG ${runId}`,
      });
      assert.equal(communityPostResponse.status, 201);
      const communityPost = await communityPostResponse.json() as { id: string };
      assert.equal(await prisma.notification.count({
        where: { userId: admin.id, title: 'New community post', body: { contains: runId } },
      }), 1, 'Admins are notified when a member posts in a room');

      const privateComments = await json(`/community/posts/${communityPost.id}/comments`, otherUserToken);
      const privateLike = await json(`/community/posts/${communityPost.id}/like`, otherUserToken, 'POST');
      assert.equal(privateComments.status, 404, 'private room comments are hidden from users without access');
      assert.equal(privateLike.status, 404, 'private room likes are hidden from users without access');

      const adminReply = await json(`/community/posts/${communityPost.id}/comments`, adminToken, 'POST', {
        body: `Admin reply ${runId}`,
      });
      assert.equal(adminReply.status, 201);
      assert.equal(await prisma.notification.count({
        where: { userId: user.id, title: 'ATG Admin replied to your post', body: { contains: runId } },
      }), 1, 'members are notified when an Admin replies to their post');

      const adminAnnouncement = await json('/community/posts', adminToken, 'POST', {
        groupId: group.id,
        kind: 'POST',
        body: `Admin community update ${runId}`,
      });
      assert.equal(adminAnnouncement.status, 201);
      const announcementPost = await adminAnnouncement.json() as { id: string };
      assert.equal(await prisma.notification.count({
        where: { userId: user.id, title: 'New post from ATG Admin', body: { contains: runId } },
      }), 1, 'active room members are notified about Admin community updates');
      assert.equal(await prisma.notification.count({
        where: { userId: otherUser.id, title: 'New post from ATG Admin', body: { contains: runId } },
      }), 0, 'Admin community updates do not notify users without access');

      const removed = await json(`/community/posts/${communityPost.id}`, adminToken, 'DELETE');
      assert.equal(removed.status, 200, 'Admins can moderate community posts');
      const stillAvailable = await prisma.groupPost.findUnique({ where: { id: communityPost.id } });
      assert.equal(stillAvailable, null);
      const ownerRemove = await json(`/community/posts/${announcementPost.id}`, userToken, 'DELETE');
      assert.equal(ownerRemove.status, 403, 'members cannot remove an Admin post');

      const deletedSignal = await json(`/signals/${signal.id}`, adminToken, 'DELETE');
      assert.equal(deletedSignal.status, 200);
      signalId = undefined;

      await broadcastToAudience('VIP_DERIV', {
        title: `${runId} Deriv VIP signal`,
        body: 'A new Deriv VIP signal is ready.',
        type: 'SIGNAL',
      });
      await broadcastToAudience('PAID', {
        title: `${runId} paid signal`,
        body: 'A new paid-audience signal is ready.',
        type: 'SIGNAL',
      });
      const vipDelivery = await prisma.notification.count({
        where: { userId: user.id, title: `${runId} Deriv VIP signal` },
      });
      const unrelatedVipDelivery = await prisma.notification.count({
        where: { userId: otherUser.id, title: `${runId} Deriv VIP signal` },
      });
      const adminVipDelivery = await prisma.notification.count({
        where: { userId: admin.id, title: `${runId} Deriv VIP signal` },
      });
      const paidDelivery = await prisma.notification.count({
        where: { userId: user.id, title: `${runId} paid signal` },
      });
      assert.equal(vipDelivery, 1, 'manual Deriv room members receive Deriv VIP signal notices');
      assert.equal(unrelatedVipDelivery, 0, 'other users do not receive Deriv VIP signal notices');
      assert.equal(adminVipDelivery, 1, 'admins receive signal notices');
      assert.equal(paidDelivery, 1, 'manual VIP members also receive paid-audience notices');

      const renewal = await submit(userToken, 'MEMBERSHIP', packageData.id, '25.00', `${runId}-membership-2`);
      assert.equal(renewal.response.status, 201);
      const approveRenewal = await json(`/purchase-requests/admin/${renewal.data.id}/review`, adminToken, 'POST', {
        action: 'APPROVE',
        paymentChecked: true,
      });
      assert.equal(approveRenewal.status, 200);
      const renewalGrant = await prisma.membershipRoomAccess.findFirstOrThrow({ where: { requestId: renewal.data.id } });
      assert.equal(renewalGrant.startsAt.getTime(), firstGrant.expiresAt.getTime());

      const expandedPackage = await json(`/purchase-requests/admin/packages/${packageData.id}`, adminToken, 'PATCH', {
        includedRooms: ['VIP_DERIV', 'VIP_WELTRADE'],
      });
      assert.equal(expandedPackage.status, 200);
      await prisma.user.update({
        where: { id: otherUser.id },
        data: { membership: 'VIP_DERIV', isVip: true, vipExpiresAt: null },
      });
      const indefiniteRenewal = await submit(otherUserToken, 'MEMBERSHIP', packageData.id, '25.00', `${runId}-indefinite-membership`);
      assert.equal(indefiniteRenewal.response.status, 201);
      const blockedIndefiniteRenewal = await json(`/purchase-requests/admin/${indefiniteRenewal.data.id}/review`, adminToken, 'POST', {
        action: 'APPROVE',
        paymentChecked: true,
      });
      assert.equal(blockedIndefiniteRenewal.status, 409, 'an unbounded legacy membership cannot be safely scheduled');
      assert.equal(await prisma.purchase.count({ where: { userId: otherUser.id } }), 0);

      const legacyExpiry = new Date(Date.now() + 2 * 86_400_000);
      await prisma.user.update({
        where: { id: otherUser.id },
        data: { membership: 'VIP_DERIV', isVip: true, vipExpiresAt: legacyExpiry },
      });
      await prisma.subscription.create({
        data: {
          userId: otherUser.id,
          plan: 'Existing VIP membership',
          status: 'ACTIVE',
          startedAt: new Date(Date.now() - 30 * 86_400_000),
          expiresAt: legacyExpiry,
          provider: 'stripe',
          autoRenew: false,
        },
      });
      const legacyRenewal = await submit(otherUserToken, 'MEMBERSHIP', packageData.id, '25.00', `${runId}-legacy-membership`);
      assert.equal(legacyRenewal.response.status, 201);
      const approveLegacyRenewal = await json(`/purchase-requests/admin/${legacyRenewal.data.id}/review`, adminToken, 'POST', {
        action: 'APPROVE',
        paymentChecked: true,
      });
      assert.equal(approveLegacyRenewal.status, 200);
      const scheduledDerivGrant = await prisma.membershipRoomAccess.findFirstOrThrow({
        where: { requestId: legacyRenewal.data.id, accessLevel: 'VIP_DERIV' },
      });
      const scheduledWeltradeGrant = await prisma.membershipRoomAccess.findFirstOrThrow({
        where: { requestId: legacyRenewal.data.id, accessLevel: 'VIP_WELTRADE' },
      });
      assert.equal(scheduledDerivGrant.startsAt.getTime(), legacyExpiry.getTime());
      assert.ok(scheduledWeltradeGrant.startsAt.getTime() <= Date.now());
      const preservedSubscription = await prisma.subscription.findUniqueOrThrow({ where: { userId: otherUser.id } });
      assert.equal(preservedSubscription.provider, 'stripe');
      assert.equal(preservedSubscription.expiresAt.getTime(), legacyExpiry.getTime());
      const legacyRoomAccess = await json(`/community/groups/${group.id}`, otherUserToken);
      assert.equal(legacyRoomAccess.status, 200, 'the existing VIP entitlement remains active while renewal is scheduled');
      const addedRoomAccess = await json(`/community/groups/${otherGroup.id}`, otherUserToken);
      assert.equal(addedRoomAccess.status, 200, 'a new room grant does not hide the existing legacy room entitlement');

      const handoffNow = new Date();
      await prisma.user.update({
        where: { id: otherUser.id },
        data: { membership: 'FREE', isVip: false, vipExpiresAt: null },
      });
      await prisma.subscription.update({
        where: { userId: otherUser.id },
        data: { status: 'EXPIRED' },
      });
      await prisma.membershipRoomAccess.updateMany({
        where: { requestId: legacyRenewal.data.id },
        data: { startsAt: new Date(handoffNow.getTime() - 1000) },
      });
      const renewedRoomAccess = await json(`/community/groups/${group.id}`, otherUserToken);
      assert.equal(renewedRoomAccess.status, 200, 'the scheduled manual entitlement takes over after legacy expiry');

      const reminderNow = new Date();
      const firstExpiry = new Date(reminderNow.getTime() + 2 * 86_400_000);
      await prisma.membershipRoomAccess.update({
        where: { id: firstGrant.id },
        data: { expiresAt: firstExpiry },
      });
      await runMembershipAccessExpiryNotifications(reminderNow);
      await runMembershipAccessExpiryNotifications(reminderNow);
      const threeDayReminders = await prisma.notification.count({
        where: { userId: user.id, title: 'Deriv VIP access expires within 3 days' },
      });
      assert.equal(threeDayReminders, 1, 'three-day warning is sent only once');

      await runMembershipAccessExpiryNotifications(new Date(firstExpiry.getTime() - 12 * 60 * 60 * 1000));
      const oneDayReminders = await prisma.notification.count({
        where: { userId: user.id, title: 'Deriv VIP access expires within 1 day' },
      });
      assert.equal(oneDayReminders, 1, 'one-day warning is sent only once');

      await runMembershipAccessExpiryNotifications(new Date(firstExpiry.getTime() + 60_000));
      await runMembershipAccessExpiryNotifications(new Date(firstExpiry.getTime() + 60_000));
      const expiryNotices = await prisma.notification.count({
        where: { userId: user.id, title: 'Deriv VIP access expired' },
      });
      assert.equal(expiryNotices, 1, 'expiry notification is sent only once');

      await prisma.membershipRoomAccess.updateMany({ where: { userId: user.id }, data: { startsAt: new Date(Date.now() - 172_800_000), expiresAt: new Date(Date.now() - 86_400_000) } });
      await prisma.subscription.update({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 86_400_000) } });
      const expiredAccess = await json(`/community/groups/${group.id}`, userToken);
      assert.equal(expiredAccess.status, 402);
    });

    console.log(`Completed ${results.length} manual purchase integration checks.`);
  } finally {
    for (const socket of sockets) socket.disconnect();
    if (realtime) {
      await new Promise<void>((resolve) => realtime!.close(() => resolve()));
    } else if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    const testUserIds = [userId, otherUserId].filter((id): id is string => Boolean(id));
    const requests = testUserIds.length
      ? await prisma.purchaseRequest.findMany({
          where: { userId: { in: testUserIds } },
          select: { id: true, reference: true, proofStorageName: true },
        })
      : [];
    requestReferences.push(...requests.map((request) => request.reference));
    if (requestReferences.length) {
      await prisma.notification.deleteMany({
        where: {
          OR: [
            ...requestReferences.map((reference) => ({ body: { contains: reference } })),
            { title: { contains: runId } },
            { body: { contains: runId } },
          ],
        },
      });
    }
    if (groupId) await prisma.group.delete({ where: { id: groupId } }).catch(() => undefined);
    if (otherGroupId) await prisma.group.delete({ where: { id: otherGroupId } }).catch(() => undefined);
    if (signalId) {
      const signal = await prisma.signal.findUnique({ where: { id: signalId }, select: { roomPostId: true } });
      if (signal?.roomPostId) await prisma.groupPost.delete({ where: { id: signal.roomPostId } }).catch(() => undefined);
      await prisma.signal.delete({ where: { id: signalId } }).catch(() => undefined);
    }
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    if (otherUserId) await prisma.user.delete({ where: { id: otherUserId } }).catch(() => undefined);
    if (adminId) await prisma.user.delete({ where: { id: adminId } }).catch(() => undefined);
    if (courseId) await prisma.course.delete({ where: { id: courseId } }).catch(() => undefined);
    if (otherCourseId) await prisma.course.delete({ where: { id: otherCourseId } }).catch(() => undefined);
    if (createdCourseId) await prisma.course.delete({ where: { id: createdCourseId } }).catch(() => undefined);
    if (packageId) await prisma.membershipPackage.delete({ where: { id: packageId } }).catch(() => undefined);
    await Promise.all(requests.map((request) => rm(path.join(env.purchaseProofDir, request.proofStorageName), { force: true })));
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
