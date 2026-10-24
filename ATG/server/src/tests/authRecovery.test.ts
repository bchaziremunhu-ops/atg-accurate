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
  let token = '';
  let otherToken = '';
  let regPhone = '';
  const testPhones = new Set<string>();
  let regAnswer = 'Harare';
  let regName = 'Recovery Tester';
  let regDob = '1995-06-15';

  const json = async <T>(path: string, opts: RequestInit = {}, tok?: string): Promise<{ status: number; body: T }> => {
    const r = await fetch(base + path, {
      ...opts,
      headers: {
        'content-type': 'application/json',
        ...((tok ?? token) ? { authorization: `Bearer ${tok ?? token}` } : {}),
        ...(opts.headers ?? {}),
      },
    });
    const body = (await r.json().catch(() => ({}))) as T;
    return { status: r.status, body };
  };


  await step('security question list is published', async () => {
    const { status, body } = await json<{ questions: { id: string; text: string }[] }>('/auth/security-questions');
    assert.equal(status, 200);
    assert.ok(body.questions.length >= 5, 'a usable list of questions');
    assert.ok(body.questions.every((q) => q.id && q.text));
  });

  await step('register with the full payload succeeds and returns a session', async () => {
    const payload = registerPayload({
      name: regName,
      phone: `+26377${stamp.toString().slice(-7)}`,
      dateOfBirth: regDob,
      securityQuestion: 'city_birth',
      securityAnswer: regAnswer,
    });
    regPhone = payload.phone;
    testPhones.add(payload.phone);
    const { status, body } = await json<{ accessToken: string; user: { phoneE164?: string; nationality?: string } }>(
      '/auth/register',
      { method: 'POST', body: JSON.stringify(payload) },
    );
    assert.equal(status, 201, JSON.stringify(body));
    assert.ok(body.accessToken, 'session issued immediately — no verification step');
    assert.equal(body.user.phoneE164, payload.phone, 'phone stored in canonical E.164');
    token = body.accessToken;
  });

  await step('duplicate phone is rejected (same number, different format)', async () => {
    const payload = registerPayload({ phone: `26377${stamp.toString().slice(-7)}` });
    const { status } = await json<{ error: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    assert.equal(status, 409, 'national format of the same number must collide');
  });

  await step('T&C and Privacy acceptance are mandatory', async () => {
    const { status } = await json('/auth/register', {
      method: 'POST',
      body: JSON.stringify(registerPayload({ acceptTerms: false })),
    });
    assert.equal(status, 422, 'reject without T&C acceptance');
    const { status: status2 } = await json('/auth/register', {
      method: 'POST',
      body: JSON.stringify(registerPayload({ acceptPrivacy: false })),
    });
    assert.equal(status2, 422, 'reject without Privacy acceptance');
  });

  await step('missing security question / answer is rejected', async () => {
    const { status } = await json('/auth/register', {
      method: 'POST',
      body: JSON.stringify(registerPayload({ securityQuestion: 'not_a_real_id' })),
    });
    assert.equal(status, 422);
  });

  await step('security answer is stored hashed, never plaintext', async () => {
    const user = await prisma.user.findFirst({ where: { phoneE164: regPhone } });
    assert.ok(user, 'user exists');
    assert.ok(user!.securityAnswerHash, 'answer hash present');
    assert.ok(user!.securityAnswerHash!.startsWith('scrypt$'), 'scrypt format');
    assert.ok(!user!.securityAnswerHash!.toLowerCase().includes(regAnswer.toLowerCase()), 'no plaintext leak');
    assert.ok(user!.termsAcceptedAt && user!.privacyAcceptedAt, 'acceptance timestamps recorded');
  });


  await step('login with the international number works', async () => {
    const { status } = await json<{ accessToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: regPhone, password: 'Password123!' }),
    });
    assert.equal(status, 200);
  });

  await step('login with the dial code (no +) of the same number works', async () => {
    const { status } = await json<{ accessToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: '26377' + stamp.toString().slice(-7), password: 'Password123!' }),
    });
    assert.equal(status, 200);
  });


  await step('forgot/start always succeeds, even for unknown numbers', async () => {
    const { status } = await json('/auth/forgot/start', {
      method: 'POST',
      body: JSON.stringify({ phone: '+263770000000' }),
    });
    assert.equal(status, 200, 'no enumeration at step 1');
  });

  await step('forgot/start with the real number is audited', async () => {
    const { status } = await json('/auth/forgot/start', {
      method: 'POST',
      body: JSON.stringify({ phone: regPhone }),
    });
    assert.equal(status, 200);
  });


  await step('wrong personal details get the generic error', async () => {
    const { status, body } = await json<{ error: string }>('/auth/forgot/verify', {
      method: 'POST',
      body: JSON.stringify({ phone: regPhone, fullName: 'Someone Else', dateOfBirth: '1990-01-01' }),
    });
    assert.equal(status, 400);
    assert.ok(body.error.includes("couldn't verify"), 'generic wording');
  });

  await step('unknown phone gets the identical generic error', async () => {
    const { status, body } = await json<{ error: string }>('/auth/forgot/verify', {
      method: 'POST',
      body: JSON.stringify({ phone: '+263779999999', fullName: 'Anyone', dateOfBirth: '1990-01-01' }),
    });
    assert.equal(status, 400);
    const known = await json<{ error: string }>('/auth/forgot/verify', {
      method: 'POST',
      body: JSON.stringify({ phone: regPhone, fullName: 'Wrong Name', dateOfBirth: regDob }),
    });
    assert.equal(body.error, known.body.error, 'same message whether the account exists or not');
  });

  await step('correct details reveal the security question (and nothing else)', async () => {
    const { status, body } = await json<{ question: { id: string; text: string } }>('/auth/forgot/verify', {
      method: 'POST',
      body: JSON.stringify({ phone: regPhone, fullName: regName, dateOfBirth: regDob }),
    });
    assert.equal(status, 200);
    assert.equal(body.question.id, 'city_birth');
    assert.ok(!JSON.stringify(body).includes('hash'), 'never leaks stored data');
  });


  await step('wrong security answer is rejected generically', async () => {
    const { status, body } = await json<{ error: string }>('/auth/forgot/reset', {
      method: 'POST',
      body: JSON.stringify({
        phone: regPhone,
        fullName: regName,
        dateOfBirth: regDob,
        answer: 'WrongAnswer',
        newPassword: 'NewPassword1!',
        confirmPassword: 'NewPassword1!',
      }),
    });
    assert.equal(status, 400);
    assert.ok(body.error.includes("didn't match"), 'generic answer-failure wording');
  });

  await step('password mismatch is rejected before any check', async () => {
    const { status } = await json('/auth/forgot/reset', {
      method: 'POST',
      body: JSON.stringify({
        phone: regPhone,
        fullName: regName,
        dateOfBirth: regDob,
        answer: regAnswer,
        newPassword: 'NewPassword1!',
        confirmPassword: 'Different1!',
      }),
    });
    assert.equal(status, 400);
  });

  await step('correct answer resets the password', async () => {
    const { status, body } = await json<{ ok: boolean; message: string }>('/auth/forgot/reset', {
      method: 'POST',
      body: JSON.stringify({
        phone: regPhone,
        fullName: regName,
        dateOfBirth: regDob,
        answer: regAnswer,
        newPassword: 'NewPassword1!',
        confirmPassword: 'NewPassword1!',
      }),
    });
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.ok, true);
    assert.ok(body.message.toLowerCase().includes('updated'));
  });

  await step('old password no longer works; new password does', async () => {
    const old = await json('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: regPhone, password: 'Password123!' }),
    });
    assert.equal(old.status, 401, 'old password rejected');
    const fresh = await json<{ accessToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: regPhone, password: 'NewPassword1!' }),
    });
    assert.equal(fresh.status, 200, 'new password accepted');
  });

  await step('a second user cannot recover the first user\'s account', async () => {
    const payload = registerPayload({ name: 'Second User', securityAnswer: 'Bulawayo' });
    testPhones.add(payload.phone);
    const reg = await json<{ accessToken: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    assert.equal(reg.status, 201);
    otherToken = reg.body.accessToken;
    const { status } = await json('/auth/forgot/reset', {
      method: 'POST',
      body: JSON.stringify({
        phone: regPhone,
        fullName: payload.name,
        dateOfBirth: payload.dateOfBirth,
        answer: 'Bulawayo',
        newPassword: 'Hacked123!',
        confirmPassword: 'Hacked123!',
      }),
    });
    assert.equal(status, 400, 'mismatched identity cannot be mixed across accounts');
  });


  await step('password reset revokes existing refresh tokens', async () => {
    const payload = registerPayload({ name: 'Session Killer' });
    testPhones.add(payload.phone);
    const reg = await json<{ refreshToken: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const refreshToken = reg.body.refreshToken;
    const refresh = () =>
      fetch(base + '/auth/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
    const before = await refresh();
    assert.equal(before.status, 200, 'token works before reset');

    const reset = await json('/auth/forgot/reset', {
      method: 'POST',
      body: JSON.stringify({
        phone: payload.phone,
        fullName: payload.name,
        dateOfBirth: payload.dateOfBirth,
        answer: payload.securityAnswer,
        newPassword: 'BrandNew123!',
        confirmPassword: 'BrandNew123!',
      }),
    });
    assert.equal(reset.status, 200);
    const after = await refresh();
    assert.equal(after.status, 401, 'reset kills every live session');
  });


  await step('recovery attempts are written to the security audit log', async () => {
    const events = await prisma.securityEvent.findMany({
      where: { phoneE164: regPhone },
      orderBy: { createdAt: 'desc' },
    });
    const types = new Set(events.map((e) => e.type));
    assert.ok(types.has('REGISTER'), 'registration audited');
    assert.ok(types.has('LOGIN_SUCCESS'), 'logins audited');
    assert.ok(types.has('RECOVERY_STARTED'), 'recovery start audited');
    assert.ok(types.has('RECOVERY_IDENTITY_FAILED'), 'failed identity audited');
    assert.ok(types.has('RECOVERY_QUESTION_ISSUED'), 'question issuance audited');
    assert.ok(types.has('RECOVERY_ANSWER_FAILED'), 'failed answer audited');
    assert.ok(types.has('PASSWORD_RESET'), 'reset audited');
    const serialized = JSON.stringify(events);
    assert.ok(!serialized.includes('scrypt$'), 'audit never stores answer hashes');
    assert.ok(!serialized.toLowerCase().includes('newpassword'), 'audit never stores passwords');
  });


  await step('repeated failed recovery locks the account temporarily', async () => {
    const payload = registerPayload({ name: 'Lockout Tester', securityAnswer: 'Mutare' });
    testPhones.add(payload.phone);
    const reg = await json<{ accessToken: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    assert.equal(reg.status, 201);

    let lastStatus = 0;
    for (let i = 0; i < 5; i++) {
      const { status } = await json<{ error: string }>('/auth/forgot/verify', {
        method: 'POST',
        body: JSON.stringify({ phone: payload.phone, fullName: 'Wrong Name', dateOfBirth: payload.dateOfBirth }),
      });
      lastStatus = status;
      if (status === 429) break;
    }
    const locked = await json<{ error: string }>('/auth/forgot/verify', {
      method: 'POST',
      body: JSON.stringify({ phone: payload.phone, fullName: payload.name, dateOfBirth: payload.dateOfBirth }),
    });
    assert.equal(locked.status, 429, `expected lockout, got ${lastStatus} then ${locked.status}`);
    assert.ok(locked.body.error.toLowerCase().includes('locked'), 'lockout is explicit');
  });

  await step('audit log contains no plaintext secrets', async () => {
    const all = await prisma.securityEvent.findMany({ take: 200 });
    const text = JSON.stringify(all).toLowerCase();
    for (const secret of ['password123!', 'newpassword1!', 'scrypt$', 'harare"', 'bulawayo"']) {
      assert.ok(!text.includes(secret), `audit must not contain ${secret}`);
    }
  });


  await prisma.user.deleteMany({
    where: { phoneE164: { in: [...testPhones] } },
  }).catch(() => {});

  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await prisma.$disconnect();

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n${passed}/${results.length} passed${failed ? `, ${failed} FAILED` : ''}`);
  if (failed) {
    for (const r of results.filter((x) => !x.ok)) console.log(`  ✗ ${r.name}: ${r.info}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
