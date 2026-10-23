import crypto from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Hashing for account-recovery security answers.
 *
 * Answers are low-entropy secrets a human can type ("Harare", "Precious"),
 * so a fast hash would be trivially brute-forced from a stolen database.
 * scrypt is used instead — memory-hard, in Node's standard library (no native
 * dependency to compile), with per-answer random salt. Verification is
 * constant-time.
 *
 * Stored format: `scrypt$N$r$p$<salt-b64>$<hash-b64>` so parameters can be
 * raised later and old hashes still verify.
 */

const scrypt = promisify(crypto.scrypt) as (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions,
) => Promise<Buffer>;

const PARAMS = { N: 32768, r: 8, p: 1, keylen: 32, saltBytes: 16 };
// scrypt needs roughly 128*N*r bytes; the Node default maxmem (32 MB) is just
// under what N=32768 needs, so give it headroom.
const MAXMEM = 96 * 1024 * 1024;

/**
 * Canonical form of an answer: users type with arbitrary spacing/case and
 * must get the same hash. NFKC folds compatibility characters so a phone
 * keyboard's smart punctuation can't break recovery.
 */
export function normalizeAnswer(raw: string): string {
  return (raw ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export async function hashAnswer(raw: string): Promise<string> {
  const answer = normalizeAnswer(raw);
  const salt = crypto.randomBytes(PARAMS.saltBytes);
  const derived = await scrypt(answer, salt, PARAMS.keylen, {
    N: PARAMS.N,
    r: PARAMS.r,
    p: PARAMS.p,
    maxmem: MAXMEM,
  });
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

/** Constant-time verify. Returns false for malformed/legacy stored values. */
export async function verifyAnswer(raw: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], 'base64');
    expected = Buffer.from(parts[5], 'base64');
  } catch {
    return false;
  }
  if (!salt.length || !expected.length) return false;

  const derived = await scrypt(normalizeAnswer(raw), salt, expected.length, {
    N,
    r,
    p,
    maxmem: MAXMEM,
  });
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

/** Sleep used to slow down failed recovery attempts (timing-attack friction). */
export function delayFailure(ms = 450): Promise<void> {
  const jitter = Math.floor(Math.random() * 250);
  return new Promise((resolve) => setTimeout(resolve, ms + jitter));
}
