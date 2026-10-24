import crypto from 'node:crypto';
import { promisify } from 'node:util';


const scrypt = promisify(crypto.scrypt) as (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions,
) => Promise<Buffer>;

const PARAMS = { N: 32768, r: 8, p: 1, keylen: 32, saltBytes: 16 };
const MAXMEM = 96 * 1024 * 1024;

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

export function delayFailure(ms = 450): Promise<void> {
  const jitter = Math.floor(Math.random() * 250);
  return new Promise((resolve) => setTimeout(resolve, ms + jitter));
}
