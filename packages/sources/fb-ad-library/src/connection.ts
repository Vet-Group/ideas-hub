// The search results connection both payloads carry (docs/research/2026-10-20-fb-probe.md "Payloads").

/** One ad object as the payload has it; only the fields the adapter reads are typed. */
export interface RawAd {
  ad_archive_id: string;
  collation_id?: string | null;
  collation_count?: number | null;
  is_active?: boolean;
  page_id?: string | null;
  page_name?: string | null;
  start_date?: number | null;
  end_date?: number | null;
  snapshot?: RawSnapshot;
  [key: string]: unknown;
}

export interface RawCard {
  body?: string | null;
  title?: string | null;
  link_url?: string | null;
  resized_image_url?: string | null;
  video_preview_image_url?: string | null;
}

export interface RawSnapshot {
  page_name?: string | null;
  body?: { text?: string | null } | null;
  title?: string | null;
  link_url?: string | null;
  cta_text?: string | null;
  display_format?: string | null;
  images?: { resized_image_url?: string | null }[];
  videos?: { video_preview_image_url?: string | null }[];
  cards?: RawCard[];
}

export interface Connection {
  /** Total result count; the embedded payload only (50001 means "more than 50,000"). */
  count?: number;
  /** `page_info.has_next_page`, when present. */
  hasNext?: boolean;
  ads: RawAd[];
  captcha: boolean;
}

export class ParseError extends Error {
  override name = 'ParseError';
}

interface RawConnection {
  count?: unknown;
  edges?: unknown;
  page_info?: { has_next_page?: unknown } | null;
}

function findKey(o: unknown, key: string, depth = 0): Record<string, unknown> | null {
  if (!o || typeof o !== 'object' || depth > 40) return null;
  if (key in o) return o as Record<string, unknown>;
  for (const v of Object.values(o)) {
    const hit = findKey(v, key, depth + 1);
    if (hit) return hit;
  }
  return null;
}

/** Reads `search_results_connection` anywhere in a parsed payload. */
export function readConnection(root: unknown): Connection {
  const holder = findKey(root, 'search_results_connection');
  if (!holder) throw new ParseError('no search_results_connection');
  const conn = holder.search_results_connection as RawConnection | null;
  if (!conn || typeof conn !== 'object' || !Array.isArray(conn.edges)) throw new ParseError('connection without edges');
  const ads = (conn.edges as { node?: { collated_results?: unknown } }[]).flatMap((e) => {
    const list = e?.node?.collated_results;
    return Array.isArray(list) ? (list as RawAd[]) : [];
  });
  for (const ad of ads) {
    if (!ad || typeof ad.ad_archive_id !== 'string') throw new ParseError('ad without ad_archive_id');
  }
  const captcha = findKey(root, 'xfb_ad_library_is_captcha_required')?.xfb_ad_library_is_captcha_required === true;
  const hasNext = conn.page_info?.has_next_page;
  return {
    count: typeof conn.count === 'number' ? conn.count : undefined,
    hasNext: typeof hasNext === 'boolean' ? hasNext : undefined,
    ads,
    captcha,
  };
}

/** `JSON.parse` that turns a syntax error into a ParseError. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text.replace(/^for \(;;\);/, ''));
  } catch (e) {
    throw new ParseError(`invalid JSON: ${String(e).slice(0, 200)}`);
  }
}
