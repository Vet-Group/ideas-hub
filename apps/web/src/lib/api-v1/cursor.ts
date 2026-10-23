// Opaque pagination cursors (contract §3 "Pagination"): base64url JSON of the last row's sort key plus a
// fingerprint of the filter set, so a cursor from another query is refused. The sort keys are validated
// as strictly as any query parameter, since a client can forge a cursor.
import { createHash } from 'node:crypto';
import { ApiError } from './error';

const fingerprint = (filters: Record<string, string | undefined>) =>
  createHash('sha256')
    .update(JSON.stringify(Object.entries(filters).filter(([, v]) => v !== undefined).sort()))
    .digest('hex')
    .slice(0, 12);

export function encodeCursor(key: string[], filters: Record<string, string | undefined>): string {
  return Buffer.from(JSON.stringify({ k: key, f: fingerprint(filters) })).toString('base64url');
}

/** The sort key of a cursor, or undefined without one; `valid` checks each part of the key. */
export function decodeCursor(cursor: string | null, filters: Record<string, string | undefined>, valid: readonly RegExp[]): string[] | undefined {
  if (cursor === null) return undefined;
  const bad = () => new ApiError(400, 'invalid_cursor', 'The cursor is not valid for this request.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw bad();
  }
  const { k, f } = (parsed ?? {}) as { k?: unknown; f?: unknown };
  if (f !== fingerprint(filters) || !Array.isArray(k) || k.length !== valid.length) throw bad();
  if (!k.every((part, i) => typeof part === 'string' && part.length <= 200 && valid[i]!.test(part))) throw bad();
  return k as string[];
}
