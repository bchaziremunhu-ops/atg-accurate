/**
 * Weltrade broker-account registration (client id + admin verification).
 * Run with: npm test
 *
 * The rule this file defends: submitting a client id grants nothing. `status`
 * only ever moves through an administrator action, and the sign-up URL is never
 * invented — it comes from configuration or it is null.
 */
process.env.NODE_ENV = 'test';

import http from 'node:http';
import assert from 'node:assert';
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

type Account = {
  id: string;
  broker: string;
  clientId: string;
  status: string;
  rejectReason: string | null;
  submittedAt: string;
  reviewedAt: string | null;
};
type Config = { broker: string; registerUrl: string | null; account: Account | null };
type AdminRow = Account & {
  user: { id: string; name: string; email: string; membership: string };
  events: { action: string; reason: string | null; actorRole: string | null }[];
};
type AdminList = {
  accounts: AdminRow[];
  pending: number;
  verified: number;
  rejected: number;
  registerUrl: string | null;
};

async function main() {
  const { createApp } = await import('../app.js');
  const { prisma } = await import('../lib/prisma.js');
  assertIsolatedTestDatabase();
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  const base = `http://localhost:${port}/api`;

  const stamp = Date.now();
  const email = `weltrade_${stamp}@test.com`;
  const otherEmail = `weltrade_other_${stamp}@test.com`;
  let token = '';
  let otherToken = '';
  let adminToken = '';
  let accountId = '';
  let configBefore: { registerUrl: string | null } = { registerUrl: null };

  const req = (path: string, opts: RequestInit = {}, tok?: string) =>
    fetch(base + path, {
      ...opts,
      headers: {
        'content-type': 'application/json',
        ...((tok ?? token) ? { authorization: `Bearer ${tok ?? token}` } : {}),
        ...(opts.headers ?? {}),
      },
    });

  const json = async <T>(path: string, opts: RequestInit = {}, tok?: string): Promise<{ status: number; body: T }> => {
    const r = await req(path, opts, tok);
    const body = (await r.json().catch(() => ({}))) as T;
    return { status: r.status, body };
  };

  await step('register the customer and the admin session', async () => {
    const reg = await json<{ accessToken: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(registerPayload({ name: 'Weltrade Tester', email })),
    });
    assert.equal(reg.status, 201);
    token = reg.body.accessToken;

    const other = await json<{ accessToken: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(registerPayload({ name: 'Other Tester', email: otherEmail })),
    });
    assert.equal(other.status, 201);
    otherToken = other.body.accessToken;

    const admin = await json<{ accessToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'blessed@atg.com', password: '1953' }),
    });
    assert.equal(admin.status, 200, 'seeded administrator must exist');
    adminToken = admin.body.accessToken;

    configBefore = (await json<{ registerUrl: string | null }>('/admin/weltrade-accounts/config', {}, adminToken)).body;
  });

  await step('a fresh member has no submission and no invented sign-up link', async () => {
    const { status, body } = await json<Config>('/weltrade-account');
    assert.equal(status, 200);
    assert.equal(body.broker, 'WELTRADE');
    assert.equal(body.account, null);
    if (body.registerUrl !== null) {
      assert.match(body.registerUrl, /^https?:\/\//, 'a configured link must be a real http(s) URL');
    }
  });

  await step('a malformed client id is rejected', async () => {
    const { status } = await json('/weltrade-account', { method: 'POST', body: JSON.stringify({ clientId: 'x' }) });
    assert.equal(status, 422);
  });

  await step('submitting a client id starts as PENDING, never VERIFIED', async () => {
    const { status, body } = await json<{ account: Account; message: string }>('/weltrade-account', {
      method: 'POST',
      body: JSON.stringify({ clientId: `WT-${stamp}` }),
    });
    assert.equal(status, 201);
    assert.equal(body.account.status, 'PENDING');
    assert.equal(body.account.broker, 'WELTRADE');
    assert.equal(body.account.reviewedAt, null);
    assert.match(body.message, /pending administrator verification/i);
    accountId = body.account.id;
  });

  await step('submitting does not touch the wallet or grant anything', async () => {
    const wallet = await json<{ balance: number }>('/wallet');
    assert.equal(wallet.body.balance, 0, 'registration must never move money');
    const me = await json<{ isVip: boolean; role: string }>('/auth/me');
    assert.equal(me.body.role, 'USER', 'submitting a client id does not make anyone an admin');
    assert.equal(me.body.isVip, false, 'submitting a client id does not grant VIP');
  });

  await step('a member cannot reach the admin verification queue', async () => {
    const { status } = await json<AdminList>('/admin/weltrade-accounts', {}, otherToken);
    assert.equal(status, 403);
    const patch = await json('/admin/weltrade-accounts/nope', { method: 'PATCH', body: JSON.stringify({ action: 'verify' }) }, otherToken);
    assert.equal(patch.status, 403, 'role checks live on the server, not in hidden buttons');
  });

  await step('the queue lists the submission with its user and audit trail', async () => {
    const { status, body } = await json<AdminList>('/admin/weltrade-accounts', {}, adminToken);
    assert.equal(status, 200);
    assert.ok(body.pending >= 1, 'pending count must include the new submission');
    const row = body.accounts.find((a) => a.id === accountId);
    assert.ok(row, 'submission appears in the admin queue');
    assert.equal(row!.user.email, email);
    assert.ok(row!.events.some((e) => e.action === 'SUBMITTED'), 'the first event is recorded');
  });

  await step('rejecting without a reason is refused', async () => {
    const { status } = await json(`/admin/weltrade-accounts/${accountId}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'reject' }),
    }, adminToken);
    assert.equal(status, 400);
  });

  await step('rejecting records the reason the member can read', async () => {
    const { status, body } = await json<AdminRow>(`/admin/weltrade-accounts/${accountId}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'reject', reason: 'Client ID belongs to another account' }),
    }, adminToken);
    assert.equal(status, 200);
    assert.equal(body.status, 'REJECTED');
    assert.equal(body.rejectReason, 'Client ID belongs to another account');

    const mine = await json<Config>('/weltrade-account');
    assert.equal(mine.body.account?.status, 'REJECTED');
    assert.equal(mine.body.account?.rejectReason, 'Client ID belongs to another account');
  });

  await step('a rejected member can resubmit and returns to the queue', async () => {
    const { status, body } = await json<{ account: Account }>('/weltrade-account', {
      method: 'POST',
      body: JSON.stringify({ clientId: `WT-${stamp}-2` }),
    });
    assert.equal(status, 200);
    assert.equal(body.account.status, 'PENDING');
    assert.equal(body.account.rejectReason, null);

    const row = (await json<AdminList>('/admin/weltrade-accounts', {}, adminToken)).body.accounts.find((a) => a.id === accountId);
    assert.ok(row!.events.some((e) => e.action === 'RESUBMITTED'), 'resubmission is audited');
  });

  await step('verification is an explicit administrator action', async () => {
    const { status, body } = await json<AdminRow>(`/admin/weltrade-accounts/${accountId}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'verify' }),
    }, adminToken);
    assert.equal(status, 200);
    assert.equal(body.status, 'VERIFIED');
    assert.ok(body.reviewedAt, 'verification timestamped');
    assert.equal(body.rejectReason, null);

    const mine = await json<Config>('/weltrade-account');
    assert.equal(mine.body.account?.status, 'VERIFIED');
  });

  await step('a verified submission cannot be overwritten by the member', async () => {
    const { status } = await json('/weltrade-account', {
      method: 'POST',
      body: JSON.stringify({ clientId: `WT-${stamp}-3` }),
    });
    assert.equal(status, 409, 'only support can change a verified account');
  });

  await step('the sign-up link is validated, configurable and never guessed', async () => {
    const bad = await json('/admin/weltrade-accounts/config', {
      method: 'PUT',
      body: JSON.stringify({ registerUrl: 'javascript:alert(1)' }),
    }, adminToken);
    assert.equal(bad.status, 400, 'only http(s) URLs are accepted');

    const good = await json<{ registerUrl: string | null }>('/admin/weltrade-accounts/config', {
      method: 'PUT',
      body: JSON.stringify({ registerUrl: 'https://www.weltrade.com/open-account' }),
    }, adminToken);
    assert.equal(good.status, 200);
    assert.equal(good.body.registerUrl, 'https://www.weltrade.com/open-account');

    const visible = await json<Config>('/weltrade-account');
    assert.equal(visible.body.registerUrl, 'https://www.weltrade.com/open-account');
  });

  await step('another member only ever sees their own submission', async () => {
    const theirs = await json<Config>('/weltrade-account', {}, otherToken);
    assert.equal(theirs.body.account, null, 'no record exists for this member');
    assert.equal(theirs.body.broker, 'WELTRADE');
  });

  await step('unauthenticated requests are refused', async () => {
    const anon = await fetch(`${base}/weltrade-account`);
    assert.equal(anon.status, 401);
    const anonAdmin = await fetch(`${base}/admin/weltrade-accounts`);
    assert.equal(anonAdmin.status, 401);
  });

  // Leave configuration exactly as we found it, and remove the test members
  // (cascades their BrokerAccount + events rows).
  await req('/admin/weltrade-accounts/config', {
    method: 'PUT',
    body: JSON.stringify({ registerUrl: configBefore.registerUrl ?? '' }),
  }, adminToken);
  await prisma.user.deleteMany({ where: { email: { in: [email, otherEmail] } } }).catch(() => {});
  server.close();
  await prisma.$disconnect();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} weltrade account checks passed.`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
