// The 30 ads embedded in the search document: one <script> holding JSON
// (require → ScheduledServerJS → RelayPrefetchedStreamCache → __bbox.result.data).
import { type Connection, parseJson, readConnection } from './connection';

/** Marker that picks the embedded-data script out of the page's scripts. */
export const EMBEDDED_MARKER = 'search_results_connection';

export function parseEmbedded(scriptText: string): Connection {
  return readConnection(parseJson(scriptText));
}

/**
 * Has-next of the embedded page: `page_info` when present, otherwise a total count above the ads read
 * (spec §2 CrawlSearch).
 */
export function embeddedHasNext(conn: Connection, adsRead: number): boolean {
  return conn.hasNext ?? (conn.count ?? 0) > adsRead;
}
