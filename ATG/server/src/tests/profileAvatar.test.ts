process.env.NODE_ENV = 'test';

import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import sharp from 'sharp';
import dotenv from 'dotenv';
import { assertIsolatedTestDatabase, registerPayload, uniqueEmail } from './helpers.js';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(serverRoot, '.env') });
assertIsolatedTestDatabase();

const avatarDir = await mkdtemp(path.join(os.tmpdir(), 'atg-avatar-test-'));
process.env.AVATAR_DIR = avatarDir;

const { createApp } = await import('../app.js');
const { env } = await import('../config/env.js');
const { prisma } = await import('../lib/prisma.js');
const app = createApp();
const server = http.createServer(app);

let userId: string | undefined;
let groupId: string | undefined;
let signalId: string | undefined;

try {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  env.publicUrl = baseUrl;

  const unauthorized = await fetch(`${baseUrl}/api/users/profile/avatar`, { method: 'POST' });
  assert.equal(unauthorized.status, 401, 'avatar uploads require authentication');

  const email = uniqueEmail('avatar');
  const payload = { ...registerPayload(), email };
  const registration = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const session = (await registration.json()) as { user?: { id: string }; accessToken?: string; error?: string };
  assert.equal(registration.status, 201, session.error ?? 'test account registration failed');
  assert.ok(session.user?.id && session.accessToken);
  userId = session.user.id;
  const authorization = { authorization: `Bearer ${session.accessToken}` };

  const profileUpdate = await fetch(`${baseUrl}/api/users/profile`, {
    method: 'PATCH',
    headers: { ...authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Updated Test Name', phone: payload.phone, country: 'Zimbabwe', bio: 'Updated profile bio' }),
  });
  const profileUpdateBody = (await profileUpdate.json()) as {
    user?: { id: string; name: string; phone: string | null; country: string | null; bio: string | null; avatarUrl: string | null };
    error?: string;
  };
  assert.equal(profileUpdate.status, 200, profileUpdateBody.error ?? 'profile update failed');
  assert.deepEqual(profileUpdateBody.user, {
    id: userId,
    name: 'Updated Test Name',
    phone: payload.phone,
    country: 'Zimbabwe',
    bio: 'Updated profile bio',
    avatarUrl: null,
  });
  const updatedMeResponse = await fetch(`${baseUrl}/api/auth/me`, { headers: authorization });
  const updatedMe = (await updatedMeResponse.json()) as { name: string; phone: string | null; country: string | null; bio: string | null };
  assert.equal(updatedMeResponse.status, 200);
  assert.equal(updatedMe.name, 'Updated Test Name', 'session profile reflects the saved name');
  assert.equal(updatedMe.phone, payload.phone);
  assert.equal(updatedMe.country, 'Zimbabwe');
  assert.equal(updatedMe.bio, 'Updated profile bio');

  const group = await prisma.group.create({
    data: { name: `Avatar test ${Date.now()}`, accessTier: 'FREE' },
    select: { id: true },
  });
  groupId = group.id;
  await prisma.groupPost.create({
    data: { groupId, authorId: userId, body: 'Profile identity persistence test' },
  });
  const signal = await prisma.signal.create({
    data: {
      pair: `Avatar test ${Date.now()}`,
      direction: 'BUY',
      entry: 10,
      takeProfit: 12,
      stopLoss: 9,
      audience: 'FREE',
      tier: 'FREE',
      authorId: userId,
    },
    select: { id: true },
  });
  signalId = signal.id;

  const invalidMime = new FormData();
  invalidMime.append('avatar', new Blob(['not an image'], { type: 'text/plain' }), 'avatar.txt');
  const rejectedMime = await fetch(`${baseUrl}/api/users/profile/avatar`, {
    method: 'POST',
    headers: authorization,
    body: invalidMime,
  });
  assert.equal(rejectedMime.status, 400, 'unsupported MIME type is rejected');

  const invalidImage = new FormData();
  invalidImage.append('avatar', new Blob(['not a png'], { type: 'image/png' }), 'broken.png');
  const rejectedImage = await fetch(`${baseUrl}/api/users/profile/avatar`, {
    method: 'POST',
    headers: authorization,
    body: invalidImage,
  });
  assert.equal(rejectedImage.status, 400, 'invalid image contents are rejected');

  const oversized = new FormData();
  oversized.append('avatar', new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: 'image/png' }), 'large.png');
  const rejectedSize = await fetch(`${baseUrl}/api/users/profile/avatar`, {
    method: 'POST',
    headers: authorization,
    body: oversized,
  });
  assert.equal(rejectedSize.status, 413, 'uploads larger than 5 MB are rejected');

  const png = await sharp({
    create: { width: 8, height: 6, channels: 3, background: '#b18a42' },
  })
    .png()
    .toBuffer();
  const validImage = new FormData();
  validImage.append('avatar', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'avatar.png');
  const uploaded = await fetch(`${baseUrl}/api/users/profile/avatar`, {
    method: 'POST',
    headers: authorization,
    body: validImage,
  });
  const uploadBody = (await uploaded.json()) as { user?: { id: string; avatarUrl: string | null }; error?: string };
  assert.equal(uploaded.status, 200, uploadBody.error ?? 'valid image upload failed');
  assert.equal(uploadBody.user?.id, userId);
  assert.ok(uploadBody.user?.avatarUrl);
  assert.equal(new URL(uploadBody.user.avatarUrl).origin, baseUrl, 'avatar URL uses the configured API origin');

  const communityResponse = await fetch(`${baseUrl}/api/community/posts`, { headers: authorization });
  const communityPosts = (await communityResponse.json()) as { author: { id: string; name: string; avatarUrl: string | null } }[];
  const ownPost = communityPosts.find((post) => post.author.id === userId);
  assert.equal(communityResponse.status, 200);
  assert.equal(ownPost?.author.name, 'Updated Test Name', 'community posts show the updated profile name');
  assert.equal(ownPost?.author.avatarUrl, uploadBody.user.avatarUrl, 'community posts show the updated profile picture');

  const signalsResponse = await fetch(`${baseUrl}/api/signals`, { headers: authorization });
  const signals = (await signalsResponse.json()) as { id: string; author: { id: string; name: string; avatarUrl: string | null } | null }[];
  const ownSignal = signals.find((item) => item.id === signalId);
  assert.equal(signalsResponse.status, 200);
  assert.equal(ownSignal?.author?.name, 'Updated Test Name', 'signals show the updated profile name');
  assert.equal(ownSignal?.author?.avatarUrl, uploadBody.user.avatarUrl, 'signals show the updated profile picture');

  const imageResponse = await fetch(uploadBody.user.avatarUrl);
  assert.equal(imageResponse.status, 200, 'uploaded avatar is publicly retrievable');
  assert.equal(imageResponse.headers.get('content-type'), 'image/webp');
  assert.equal(imageResponse.headers.get('cross-origin-resource-policy'), 'cross-origin');
  const servedImage = Buffer.from(await imageResponse.arrayBuffer());
  assert.equal((await sharp(servedImage).metadata()).format, 'webp', 'stored image was converted to WebP');

  const profileResponse = await fetch(`${baseUrl}/api/users/profile`, { headers: authorization });
  const profile = (await profileResponse.json()) as { avatarUrl: string | null; name: string };
  assert.equal(profileResponse.status, 200);
  assert.equal(profile.avatarUrl, uploadBody.user.avatarUrl, 'profile returns the uploaded avatar');
  assert.equal(profile.name, 'Updated Test Name', 'avatar changes preserve updated profile fields');

  const cleared = await fetch(`${baseUrl}/api/users/profile`, {
    method: 'PATCH',
    headers: { ...authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ avatarUrl: null }),
  });
  assert.equal(cleared.status, 200, 'profile picture can be removed');
  const clearedProfileResponse = await fetch(`${baseUrl}/api/users/profile`, { headers: authorization });
  const clearedProfile = (await clearedProfileResponse.json()) as { avatarUrl: string | null; name: string };
  assert.equal(clearedProfile.avatarUrl, null);
  assert.equal(clearedProfile.name, 'Updated Test Name', 'clearing an avatar preserves the updated name');

  const missingAvatar = await fetch(`${baseUrl}/uploads/avatars/not-found.webp`);
  assert.equal(missingAvatar.status, 404, 'missing avatar paths do not return the web app shell');

  console.log('Profile avatar end-to-end checks passed.');
} finally {
  if (signalId) await prisma.signal.delete({ where: { id: signalId } });
  if (groupId) await prisma.group.delete({ where: { id: groupId } });
  if (userId) await prisma.user.delete({ where: { id: userId } });
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  await prisma.$disconnect();
  await rm(avatarDir, { recursive: true, force: true });
}
