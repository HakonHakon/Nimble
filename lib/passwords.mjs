import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

export const validPassword = value => typeof value === 'string' && value.length >= 12 && value.length <= 256;
const currentPrefix = 'scrypt$131072$8$1$';
const cost = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
let active = 0;
const waiters = [];
async function derive(password, salt, options = cost) {
  if (active >= 2) {
    if (waiters.length >= 32) throw Object.assign(new Error('Sign in is busy. Please try again shortly.'), { statusCode: 429 });
    await new Promise(resolve => waiters.push(resolve));
  } else active++;
  try { return await promisify(scrypt)(password, salt, 64, options); }
  finally { const next = waiters.shift(); if (next) next(); else active--; }
}
export async function passwordHash(password) {
  if (!validPassword(password)) throw Object.assign(new Error('Use a password of 12–256 characters.'), { statusCode: 400 });
  const salt = randomBytes(16).toString('base64');
  return { salt, hash: currentPrefix + (await derive(password, Buffer.from(salt, 'base64'))).toString('base64') };
}
export async function checkPassword(password, user) {
  if (typeof password !== 'string' || password.length > 256) return false;
  const encoded = user?.password_hash || '', modern = encoded.startsWith(currentPrefix);
  const options = user && !modern ? { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } : cost;
  const actual = Buffer.from((await derive(password, Buffer.from(user?.password_salt || 'AAAAAAAAAAAAAAAAAAAAAA==', 'base64'), options)).toString('base64'));
  const expected = Buffer.from(modern ? encoded.slice(currentPrefix.length) : encoded);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
