// Personal API token format (contract `ideas-hub-v1.md` §3): `ihp_` + 40 random base62 characters, shown
// once and stored only as a SHA-256 hash.
import { createHash, randomInt } from 'node:crypto';

export const TOKEN_DEFAULT_DAYS = 90;
export const TOKEN_MAX_DAYS = 365;

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const TOKEN_PATTERN = /^ihp_[0-9A-Za-z]{40}$/;

export function generateToken(): string {
  let body = '';
  for (let i = 0; i < 40; i++) body += BASE62[randomInt(BASE62.length)];
  return `ihp_${body}`;
}

/** Hex SHA-256. The token is 238 random bits, so a plain unsalted hash is enough. */
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
