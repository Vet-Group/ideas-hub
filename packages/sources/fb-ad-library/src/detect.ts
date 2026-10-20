// Block and "no results" detection (spec §1 "Block detection").
import { type Signal } from '@ideas-hub/core';
import { type Connection } from './connection';

export type BlockReason = 'captcha' | 'login_wall' | 'empty_embedded' | 'empty_payloads';

export type EmbeddedVerdict =
  | { kind: 'ok' }
  | { kind: 'no_results' }
  | { kind: 'blocked'; reason: BlockReason; signal: Extract<Signal, 'blocked' | 'captcha'> };

/**
 * The "no results" marker is the embedded connection with `count: 0` and no edges (fixture
 * no-results.json). Empty edges with any other count is embedded data empty without the marker: a block.
 */
export function classifyEmbedded(conn: Connection): EmbeddedVerdict {
  if (conn.captcha) return { kind: 'blocked', reason: 'captcha', signal: 'captcha' };
  if (conn.ads.length > 0) return { kind: 'ok' };
  if (conn.count === 0) return { kind: 'no_results' };
  return { kind: 'blocked', reason: 'empty_embedded', signal: 'blocked' };
}

/** A login wall sends the same signal as a captcha (spec §1 "Backoff"). */
export function isLoginWallUrl(url: string): boolean {
  return /facebook\.com\/(login|checkpoint)/.test(url);
}
