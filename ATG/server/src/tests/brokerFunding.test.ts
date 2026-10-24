process.env.NODE_ENV = 'test';
process.env.DERIV_API_KEY = 'test-deriv-key';
process.env.DERIV_API_SECRET = 'test-deriv-secret';
process.env.DERIV_WEBHOOK_SECRET = 'test-deriv-webhook-secret';
process.env.WELTRADE_API_KEY = '';
process.env.WELTRADE_API_SECRET = '';
process.env.WELTRADE_WEBHOOK_SECRET = '';

import http from 'node:http';
import crypto from 'node:crypto';
import { assertIsolatedTestDatabase, registerPayload } from './helpers.js';
import assert from 'node:assert';
import type { FundingLimits } from '../services/brokerFunding/index.js';

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

const WEBHOOK_SECRET = 'test-deriv-webhook-secret';

function sign(body: string): string {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
}

async function main() {
  const { createApp } = await import('../app.js');
  const { prisma } = await import('../lib/prisma.js');
  assertIsolatedTestDatabase();
  const { fundingLimits } = await import('../services/brokerFunding/index.js');
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  const base = `http://localhost:${port}/api`;

  const stamp = Date.now();
  const email = `broker_${stamp}@test.com`;
  const otherEmail = `broker_other_${stamp}@test.com`;
  let token = '';
  let otherToken = '';
  let adminToken = '';
  let userId = '';
  let limits: FundingLimits;
  let depositId = '';
  let depositRef = '';
  let withdrawId = '';

  const req = (path: string, opts: RequestInit = {}, tok?: string) =>
    fetch(base + path, {
      ...opts,
      headers: {
        'content-type': 'application/json',
        ...((tok ?? token) ? { authorization: `Bearer ${tok ?? token}` } : {}),
        ...(opts.headers ?? {}),
      },
    });

  await step('register a customer', async () => {
    const r = await req('/auth/register', {
      method: 'POST',
      body: JSON.stringify(registerPayload({ name: 'Broker Tester', email })),
    });
    assert.equal(r.status, 201);
    const body = (await r.json()) as { accessToken: string; user: { id: string } };
    token = body.accessToken;
    userId = body.user.id;
  });

  await step('broker config exposes brokers, limits and gateways', async () => {
    const body = (await (await req('/broker/config')).json()) as {
      brokers: { id: string }[];
      limits: { deposit: { min: number }; withdrawal: { dailyMax: number } };
      gateways: { broker: string; configured: boolean; ready: boolean; reason: string | null; kind: string }[];
      manualProcessing: boolean;
    };
    assert.deepEqual(body.brokers.map((b) => b.id), ['DERIV', 'WELTRADE']);
    assert.ok(body.limits.deposit.min > 0, 'deposit min must be server configured');
    assert.ok(body.limits.withdrawal.dailyMax > 0, 'daily withdrawal limit must be server configured');

    const deriv = body.gateways.find((g) => g.broker === 'DERIV')!;
    const weltrade = body.gateways.find((g) => g.broker === 'WELTRADE')!;
    assert.equal(deriv.configured, true, 'Deriv credentials detected');
    assert.equal(deriv.ready, false, 'gateway stays disabled until endpoints are mapped');
    assert.ok(deriv.reason, 'a disabled gateway must explain why');
    assert.equal(deriv.kind, 'manual');
    assert.equal(weltrade.configured, false, 'Weltrade has no credentials');
    assert.equal(weltrade.ready, false);
    assert.equal(body.manualProcessing, true, 'requests are labelled manual processing');
  });

  await step('register a second customer (ownership checks)', async () => {
    const r = await req('/auth/register', {
      method: 'POST',
      body: JSON.stringify(registerPayload({ name: 'Other Trader', email: otherEmail })),
    });
    assert.equal(r.status, 201);
    otherToken = ((await r.json()) as { accessToken: string }).accessToken;
  });

  await step('non-admin cannot reach the broker admin queues (403)', async () => {
    assert.equal((await req('/admin/broker/deposits')).status, 403);
    assert.equal((await req('/admin/broker/withdrawals')).status, 403);
    assert.equal((await req('/admin/broker/audit')).status, 403);
  });

  await step('unauthenticated broker request rejected (401)', async () => {
    assert.equal((await fetch(base + '/broker/config')).status, 401);
  });

  await step('admin can log in', async () => {
    const r = await req('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'blessed@atg.com', password: '1953' }),
    });
    assert.equal(r.status, 200);
    adminToken = ((await r.json()) as { accessToken: string }).accessToken;
  });

  await step('non-admin cannot read or change broker settings (403)', async () => {
    assert.equal((await req('/admin/broker/settings', {}, token)).status, 403);
    const r = await req('/admin/broker/settings', { method: 'PUT', body: JSON.stringify({ deposit: { min: 1 } }) }, token);
    assert.equal(r.status, 403);
  });

  await step('admin updates the deposit minimum at runtime and it is enforced', async () => {
    const put = await req('/admin/broker/settings', { method: 'PUT', body: JSON.stringify({ deposit: { min: 50 } }) }, adminToken);
    assert.equal(put.status, 200, await put.clone().text());
    const body = (await put.json()) as { settings: { deposit: { min: number } }; limits: { deposit: { min: number } } };
    assert.equal(body.settings.deposit.min, 50);

    const cfg = (await (await req('/broker/config')).json()) as { limits: { deposit: { min: number } } };
    assert.equal(cfg.limits.deposit.min, 50, 'customer config reflects the new limit immediately');

    const rejected = await req('/broker/deposits', {
      method: 'POST',
      body: JSON.stringify({ broker: 'DERIV', amount: 20, method: 'ECOCASH', paymentReference: 'CR123456' }),
    });
    assert.equal(rejected.status, 400, 'an amount valid under the old limit is refused under the new one');
    assert.equal(((await rejected.json()) as { code?: string }).code, 'AMOUNT_LIMIT');

    const restore = await req('/admin/broker/settings', { method: 'PUT', body: JSON.stringify({ deposit: { min: 10 } }) }, adminToken);
    assert.equal(restore.status, 200);
  });

  await step('admin fee is configurable and snapshotted on each deposit', async () => {
    const put = await req('/admin/broker/settings', { method: 'PUT', body: JSON.stringify({ feePct: 10 }) }, adminToken);
    assert.equal(put.status, 200, await put.clone().text());

    const r = await req('/broker/deposits', {
      method: 'POST',
      body: JSON.stringify({ broker: 'DERIV', amount: 100, method: 'ECOCASH', paymentReference: 'CR123456' }),
    });
    assert.equal(r.status, 201, await r.clone().text());
    const body = (await r.json()) as { transaction: { feePct: number; feeAmount: number } };
    assert.equal(body.transaction.feePct, 10);
    assert.equal(body.transaction.feeAmount, 10, '10% of 100 = 10 fee recorded on the row');

    const list = (await (await req('/broker/deposits')).json()) as Array<{ reference: string; feePct: number; feeAmount: number }>;
    const snapshot = list.find((t) => t.feeAmount === 10)!;
    assert.equal(snapshot.feePct, 10, 'older rows keep the fee they were created with');

    await req('/admin/broker/settings', { method: 'PUT', body: JSON.stringify({ feePct: 0 }) }, adminToken);
  });

  await step('invalid settings are rejected (min >= max)', async () => {
    const r = await req('/admin/broker/settings', { method: 'PUT', body: JSON.stringify({ deposit: { min: 99999, max: 100 } }) }, adminToken);
    assert.equal(r.status, 400);
  });

  await step('deposit below the configured minimum is rejected', async () => {
    limits = await fundingLimits();
    const r = await req(
      '/broker/deposits',
      { method: 'POST', body: JSON.stringify({ broker: 'DERIV', amount: limits.deposit.min - 1, method: 'ECOCASH', paymentReference: 'CR123456' }) },
    );
    assert.equal(r.status, 400);
    assert.equal(((await r.json()) as { code?: string }).code, 'AMOUNT_LIMIT');
  });

  await step('broker deposit is created PENDING and never touches the wallet', async () => {
    const r = await req(
      '/broker/deposits',
      { method: 'POST', body: JSON.stringify({ broker: 'DERIV', amount: 100, method: 'ECOCASH', paymentReference: 'CR123456' }) },
    );
    assert.equal(r.status, 201, await r.clone().text());
    const body = (await r.json()) as { transaction: { id: string; reference: string; status: string; provider: string }; mode: string; instructions: string };
    depositId = body.transaction.id;
    depositRef = body.transaction.reference;
    assert.ok(depositRef.startsWith('ATG-BD-'), `unique deposit reference, got ${depositRef}`);
    assert.equal(body.transaction.status, 'PENDING');
    assert.equal(body.transaction.provider, 'manual');
    assert.equal(body.mode, 'manual');
    assert.ok(/MANUAL PROCESSING/i.test(body.instructions), 'instructions must be labelled manual processing');

    const wallet = (await (await req('/wallet')).json()) as { balance: number };
    assert.equal(wallet.balance, 0, 'broker funding must never credit the ATG wallet');
  });

  await step('a replayed deposit submit is idempotent (no second request)', async () => {
    const payload = JSON.stringify({ broker: 'DERIV', amount: 100, method: 'ECOCASH', paymentReference: 'CR123456', idempotencyKey: `key-${stamp}` });
    const first = await req('/broker/deposits', { method: 'POST', body: payload });
    assert.equal(first.status, 201);
    const second = await req('/broker/deposits', { method: 'POST', body: payload });
    assert.equal(second.status, 200, 'replay returns the original request');
    const body = (await second.json()) as { transaction: { reference: string }; duplicate: boolean };
    assert.equal(body.duplicate, true);
    assert.notEqual(body.transaction.reference, depositRef, 'a different key creates a different request');

    const list = (await (await req('/broker/deposits')).json()) as { reference: string }[];
    const matching = list.filter((t) => t.reference === body.transaction.reference);
    assert.equal(matching.length, 1, 'the replayed key must not create a duplicate row');
  });

  await step('broker withdrawal requires verified balance and account identity', async () => {
    const missingBalance = await req('/broker/withdrawals', {
      method: 'POST',
      body: JSON.stringify({
        broker: 'WELTRADE',
        amount: 10,
        method: 'ONEMONEY',
        destination: '0771234567',
        destinationType: 'MOBILE_WALLET',
        paymentReference: 'WT-CLIENT-123',
      }),
    });
    assert.equal(missingBalance.status, 409);
    assert.equal(((await missingBalance.json()) as { code?: string }).code, 'BALANCE_NOT_VERIFIED');

    const missingClientId = await req('/broker/withdrawals', {
      method: 'POST',
      body: JSON.stringify({
        broker: 'WELTRADE',
        amount: 10,
        method: 'ONEMONEY',
        destination: '0771234567',
        destinationType: 'MOBILE_WALLET',
      }),
    });
    assert.equal(missingClientId.status, 422);

    const verified = await req('/admin/broker/balances', {
      method: 'POST',
      body: JSON.stringify({
        userId,
        broker: 'WELTRADE',
        balance: 1000,
        source: 'MANUAL_RECONCILIATION',
        reference: 'WT-STATEMENT-001',
      }),
    }, adminToken);
    assert.equal(verified.status, 201, await verified.clone().text());
  });

  await step('broker withdrawal is created PENDING and does not send payout before review', async () => {
    const r = await req(
      '/broker/withdrawals',
      {
        method: 'POST',
        body: JSON.stringify({
          broker: 'WELTRADE',
          amount: 250,
          method: 'ONEMONEY',
          destination: '0771234567',
          destinationType: 'MOBILE_WALLET',
          paymentReference: 'WT-CLIENT-123',
        }),
      },
    );
    assert.equal(r.status, 201, await r.clone().text());
    const body = (await r.json()) as { transaction: { id: string; reference: string; status: string; provider: string } };
    withdrawId = body.transaction.id;
    assert.ok(body.transaction.reference.startsWith('ATG-BW-'));
    assert.equal(body.transaction.status, 'PENDING', 'withdrawals start pending review');
    assert.equal(body.transaction.provider, 'manual', 'request submission must not call a payout gateway');
  });

  await step('an identical open withdrawal is blocked as a duplicate', async () => {
    const r = await req(
      '/broker/withdrawals',
      {
        method: 'POST',
        body: JSON.stringify({ broker: 'WELTRADE', amount: 250, method: 'ONEMONEY', destination: '0771234567', destinationType: 'MOBILE_WALLET', paymentReference: 'WT-CLIENT-123' }),
      },
    );
    assert.equal(r.status, 409);
    assert.equal(((await r.json()) as { code?: string }).code, 'DUPLICATE');
  });

  await step('daily withdrawal limit is enforced server side', async () => {
    const r = await req(
      '/broker/withdrawals',
      {
        method: 'POST',
        body: JSON.stringify({
          broker: 'DERIV',
          amount: limits.withdrawal.dailyMax,
          method: 'ECOCASH',
          destination: '0779999999',
          destinationType: 'MOBILE_WALLET',
          paymentReference: 'DERIV-ACCOUNT-001',
        }),
      },
    );
    assert.equal(r.status, 400);
    assert.equal(((await r.json()) as { code?: string }).code, 'DAILY_LIMIT');
  });

  await step('customer cannot read another customer\'s funding request (404)', async () => {
    assert.equal((await req(`/broker/transactions/${depositId}`, {}, otherToken)).status, 404);
  });

  await step('admin queues are separated and destinations are masked', async () => {
    const deposits = (await (await req('/admin/broker/deposits', {}, adminToken)).json()) as Array<{ id: string; direction: string; destinationMasked: string | null; user?: { email: string } }>;
    const withdrawals = (await (await req('/admin/broker/withdrawals', {}, adminToken)).json()) as Array<{
      id: string;
      direction: string;
      destinationMasked: string | null;
      destination: string | undefined;
    }>;

    assert.ok(deposits.every((d) => d.direction === 'DEPOSIT'), 'deposit queue holds deposits only');
    assert.ok(withdrawals.every((w) => w.direction === 'WITHDRAWAL'), 'withdrawal queue holds withdrawals only');
    assert.ok(deposits.some((d) => d.id === depositId), 'the new deposit is in the deposit queue');
    assert.ok(withdrawals.some((w) => w.id === withdrawId), 'the new withdrawal is in the withdrawal queue');

    const mine = withdrawals.find((w) => w.id === withdrawId)!;
    assert.equal(mine.destination, undefined, 'the list view never returns the raw destination');
    assert.equal(mine.destinationMasked, '0771***567', 'destination is masked in list responses');
  });

  await step('admin filters the queue by broker and status', async () => {
    const derivOnly = (await (await req('/admin/broker/deposits?broker=DERIV', {}, adminToken)).json()) as Array<{ broker: string }>;
    assert.ok(derivOnly.length > 0 && derivOnly.every((d) => d.broker === 'DERIV'), 'broker filter applies');

    const pending = (await (await req('/admin/broker/deposits?status=PENDING', {}, adminToken)).json()) as Array<{ status: string }>;
    assert.ok(pending.every((d) => d.status === 'PENDING'), 'status filter applies');

    const byCustomer = (await (await req(`/admin/broker/deposits?q=${encodeURIComponent(email)}`, {}, adminToken)).json()) as unknown[];
    assert.ok(byCustomer.length > 0, 'customer filter applies');

    const empty = (await (await req('/admin/broker/deposits?minAmount=999999', {}, adminToken)).json()) as unknown[];
    assert.equal(empty.length, 0, 'amount filter applies');
  });

  await step('a withdrawal cannot be approved before it is reviewed', async () => {
    const r = await req(`/admin/broker/transactions/${withdrawId}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'approve' }),
    }, adminToken);
    assert.equal(r.status, 409);
    assert.equal(((await r.json()) as { code?: string }).code, 'REVIEW_REQUIRED');
  });

  await step('completion without evidence is refused', async () => {
    let r = await req(`/admin/broker/transactions/${withdrawId}`, { method: 'PATCH', body: JSON.stringify({ action: 'review' }) }, adminToken);
    assert.equal(r.status, 200);
    r = await req(`/admin/broker/transactions/${withdrawId}`, { method: 'PATCH', body: JSON.stringify({ action: 'approve' }) }, adminToken);
    assert.equal(r.status, 200);
    r = await req(`/admin/broker/transactions/${withdrawId}`, { method: 'PATCH', body: JSON.stringify({ action: 'start_processing', internalNote: 'Payout queued at provider' }) }, adminToken);
    assert.equal(r.status, 200);

    r = await req(`/admin/broker/transactions/${withdrawId}`, { method: 'PATCH', body: JSON.stringify({ action: 'complete' }) }, adminToken);
    assert.equal(r.status, 400, 'a transfer may never be marked completed without evidence');
    assert.equal(((await r.json()) as { code?: string }).code, 'EVIDENCE_REQUIRED');
  });

  await step('withdrawal completes only with a recorded reconciliation', async () => {
    const r = await req(`/admin/broker/transactions/${withdrawId}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'complete', evidence: 'EcoCash statement 2026-10-16 ref EC-9981', providerRef: 'EC-9981' }),
    }, adminToken);
    assert.equal(r.status, 200, await r.clone().text());
    const body = (await r.json()) as { status: string; providerRef: string | null };
    assert.equal(body.status, 'COMPLETED');
    assert.equal(body.providerRef, 'EC-9981');

    const wallet = (await (await req('/wallet')).json()) as { balance: number };
    assert.equal(wallet.balance, 0, 'completing a broker withdrawal must not move the ATG wallet');
  });

  await step('USDT withdrawals require a verified TRC20 transaction hash before completion', async () => {
    const created = await req('/broker/withdrawals', {
      method: 'POST',
      body: JSON.stringify({
        broker: 'WELTRADE',
        amount: 10,
        method: 'USDT_TRC20',
        destination: `T${'1'.repeat(33)}`,
        destinationType: 'CRYPTO_WALLET',
        paymentReference: 'WT-CLIENT-123',
      }),
    });
    assert.equal(created.status, 201, await created.clone().text());
    const body = (await created.json()) as { transaction: { id: string } };
    const url = `/admin/broker/transactions/${body.transaction.id}`;
    for (const action of ['review', 'approve', 'start_processing']) {
      const result = await req(url, { method: 'PATCH', body: JSON.stringify({ action }) }, adminToken);
      assert.equal(result.status, 200, await result.clone().text());
    }

    const missingHash = await req(url, { method: 'PATCH', body: JSON.stringify({ action: 'complete', providerRef: 'not-a-hash' }) }, adminToken);
    assert.equal(missingHash.status, 400);
    assert.equal(((await missingHash.json()) as { code?: string }).code, 'EVIDENCE_REQUIRED');

    const hash = 'a'.repeat(64);
    const completed = await req(url, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'complete', providerRef: hash }),
    }, adminToken);
    assert.equal(completed.status, 200, await completed.clone().text());
    assert.equal(((await completed.json()) as { providerRef: string }).providerRef, hash);
  });

  await step('every action lands in the immutable audit log', async () => {
    const rows = (await (await req(`/admin/broker/audit?transactionId=${withdrawId}`, {}, adminToken)).json()) as Array<{
      action: string;
      fromStatus: string | null;
      toStatus: string | null;
      source: string;
      actorRole: string | null;
    }>;
    const actions = rows.map((r) => r.action);
    for (const expected of ['CREATED', 'REVIEW', 'APPROVE', 'START_PROCESSING', 'COMPLETE']) {
      assert.ok(actions.includes(expected), `audit log should record ${expected}, got ${actions.join(', ')}`);
    }
    assert.ok(rows.every((r) => r.actorRole === 'ADMIN' || r.actorRole === 'USER'), 'every entry records who acted');
    const chain = rows.filter((r) => r.toStatus);
    assert.ok(chain.length >= 5, 'status history is preserved');
    assert.ok(rows.some((r) => r.source === 'CUSTOMER'), 'customer actions are audited');
    assert.ok(rows.some((r) => r.source === 'ADMIN'), 'admin actions are audited');
  });

  await step('customer timeline hides internal staff notes', async () => {
    const detail = (await (await req(`/broker/transactions/${withdrawId}`)).json()) as {
      timeline: { source: string; note: string | null }[];
      adminNote: string | null;
    };
    assert.ok(detail.timeline.length > 0, 'the customer sees a status timeline');
    assert.ok(
      detail.timeline.every((t) => t.source !== 'ADMIN' || t.note === null),
      'internal admin notes must never reach the customer',
    );
  });

  await step('balances stay hidden until they are verified', async () => {
    const before = (await (await req('/broker/balances')).json()) as {
      balances: Array<{ broker: string; available: boolean; balance: number | null }>;
    };
    assert.equal(before.balances.length, 2);
    assert.equal(before.balances.find((b) => b.broker === 'DERIV')?.available, false, 'unverified balances stay hidden');
    assert.equal(before.balances.find((b) => b.broker === 'WELTRADE')?.available, true, 'verified balances are shown');

    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    const created = await req('/admin/broker/balances', {
      method: 'POST',
      body: JSON.stringify({ userId: user!.id, broker: 'DERIV', balance: 1234.5, source: 'MANUAL_RECONCILIATION', reference: 'Deriv stmt 16/10' }),
    }, adminToken);
    assert.equal(created.status, 201);

    const after = (await (await req('/broker/balances')).json()) as {
      balances: Array<{ broker: string; available: boolean; balance: number | null; verifiedAt: string | null }>;
    };
    const deriv = after.balances.find((b) => b.broker === 'DERIV')!;
    const weltrade = after.balances.find((b) => b.broker === 'WELTRADE')!;
    assert.equal(deriv.available, true);
    assert.equal(deriv.balance, 1234.5);
    assert.ok(deriv.verifiedAt, 'verified balances carry a verification timestamp');
    assert.equal(weltrade.available, true, 'verifying Deriv must not erase the separate Weltrade balance');
    assert.equal(weltrade.balance, 1000, 'each broker balance remains independent');
  });


  async function sendWebhook(body: string, signature?: string) {
    return fetch(`${base}/broker/webhook/DERIV`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-atg-signature': signature ?? '' },
      body,
    });
  }

  let webhookRef = '';

  await step('deposit is only completed by a signature-verified webhook', async () => {
    const r = await req(
      '/broker/deposits',
      { method: 'POST', body: JSON.stringify({ broker: 'DERIV', amount: 40, method: 'ECOCASH', paymentReference: 'CR777' }) },
    );
    assert.equal(r.status, 201);
    const created = (await r.json()) as { transaction: { reference: string; status: string } };
    webhookRef = created.transaction.reference;
    assert.equal(created.transaction.status, 'PENDING');

    const payload = JSON.stringify({ event_id: `evt_${stamp}`, reference: webhookRef, outcome: 'COMPLETED', provider_ref: 'DRV-1' });

    const bad = await sendWebhook(payload, 'deadbeef');
    assert.equal(bad.status, 400, 'an invalid signature must be rejected');

    const good = await sendWebhook(payload, sign(payload));
    assert.equal(good.status, 200, await good.clone().text());
    const body = (await good.json()) as { status: string };
    assert.equal(body.status, 'COMPLETED', 'a verified provider callback completes the deposit');

    const stored = await prisma.brokerTransaction.findUnique({ where: { reference: webhookRef } });
    assert.equal(stored?.status, 'COMPLETED');
    assert.equal(stored?.evidenceType, 'PROVIDER_WEBHOOK', 'the evidence source is recorded');
    assert.equal(stored?.providerRef, 'DRV-1');
    assert.equal(stored?.evidence, `provider webhook evt_${stamp}`);
  });

  await step('the webhook walks the required lifecycle and audits every step', async () => {
    const tx = await prisma.brokerTransaction.findUnique({ where: { reference: webhookRef } });
    const rows = (await (await req(`/admin/broker/audit?transactionId=${tx!.id}`, {}, adminToken)).json()) as Array<{
      id: string;
      action: string;
      toStatus: string | null;
      source: string;
      at: string;
    }>;

    const steps = rows.filter((r) => r.toStatus && r.action !== 'CREATED');
    steps.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime() || (a.id < b.id ? -1 : 1));
    assert.deepEqual(
      steps.map((r) => r.toStatus),
      ['UNDER_REVIEW', 'APPROVED', 'PROCESSING', 'COMPLETED'],
      'full lifecycle recorded in order',
    );
    assert.ok(steps.every((r) => r.source === 'PROVIDER'), 'automated steps are attributed to the provider');
    assert.ok(rows.some((r) => r.action === 'CREATED' && r.source === 'CUSTOMER'), 'the customer submission is audited too');
    assert.ok(rows.some((r) => r.action === 'WEBHOOK_COMPLETED' && r.source === 'PROVIDER'), 'the completing callback is audited');
  });

  await step('a replayed webhook is ignored (idempotent)', async () => {
    const payload = JSON.stringify({ event_id: `evt_${stamp}`, reference: webhookRef, outcome: 'COMPLETED', provider_ref: 'DRV-1' });
    const again = await sendWebhook(payload, sign(payload));
    assert.equal(again.status, 200);
    const body = (await again.json()) as { duplicate?: boolean; received?: boolean };
    assert.equal(body.duplicate, true, 'the same event id must not be processed twice');
  });

  await step('a settlement callback cannot bypass review on a pending withdrawal', async () => {
    const r = await req(
      '/broker/withdrawals',
      {
        method: 'POST',
        body: JSON.stringify({ broker: 'DERIV', amount: 60, method: 'ECOCASH', destination: '0775551234', destinationType: 'MOBILE_WALLET', paymentReference: 'DERIV-ACCOUNT-001' }),
      },
    );
    assert.equal(r.status, 201);
    const created = (await r.json()) as { transaction: { reference: string; status: string } };
    assert.equal(created.transaction.status, 'PENDING');

    const payload = JSON.stringify({ event_id: `evt_wd_${stamp}`, reference: created.transaction.reference, outcome: 'COMPLETED' });
    const res = await sendWebhook(payload, sign(payload));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { heldForReview?: boolean; status: string };
    assert.equal(body.heldForReview, true, 'admin review is never bypassed');
    assert.equal(body.status, 'PENDING');

    const stillPending = await prisma.brokerTransaction.findUnique({ where: { reference: created.transaction.reference } });
    assert.equal(stillPending?.status, 'PENDING');
  });

  await step('a broker without a webhook secret rejects every callback', async () => {
    const payload = JSON.stringify({ event_id: `evt_x_${stamp}`, reference: 'whatever', outcome: 'COMPLETED' });
    const res = await fetch(`${base}/broker/webhook/WELTRADE`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-atg-signature': sign(payload) },
      body: payload,
    });
    assert.equal(res.status, 400, 'gateways stay disabled until credentials are configured');
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /not configured/i);
  });

  await step('an unknown funding reference returns 404', async () => {
    const payload = JSON.stringify({ event_id: `evt_y_${stamp}`, reference: 'ATG-BD-NOPE1234', outcome: 'COMPLETED' });
    const res = await sendWebhook(payload, sign(payload));
    assert.equal(res.status, 404);
  });

  await step('broker ledgers stay separate from wallet + purchase ledgers', async () => {
    const walletTxns = (await (await req('/wallet/transactions')).json()) as Array<{ type: string }>;
    assert.ok(
      !walletTxns.some((t) => String(t.type).includes('BROKER')),
      'no broker funding row may ever appear in the ATG wallet ledger',
    );
    const purchases = (await (await req('/payments/purchases')).json()) as unknown[];
    assert.ok(Array.isArray(purchases), 'purchase history is a separate ledger');
    const wallet = (await (await req('/wallet')).json()) as { balance: number };
    assert.equal(wallet.balance, 0, 'the ATG wallet balance is untouched by broker funding');
  });

  await prisma.user.deleteMany({ where: { email: { in: [email, otherEmail] } } }).catch(() => {});
  server.close();
  await prisma.$disconnect();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} broker funding checks passed.`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
