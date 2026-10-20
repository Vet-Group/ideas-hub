// `AdLibrarySearchPaginationQuery` responses read while scrolling: the same connection under
// data.ad_library_main, without `count`, after an optional `for (;;);` prefix.
import { type Connection, parseJson, readConnection } from './connection';

export const PAGINATION_QUERY = 'AdLibrarySearchPaginationQuery';

export function parseGraphql(body: string): Connection {
  return readConnection(parseJson(body));
}

/** True when a GraphQL request body names the pagination query. */
export function isPaginationRequest(postData: string | null): boolean {
  return new URLSearchParams(postData ?? '').get('fb_api_req_friendly_name') === PAGINATION_QUERY;
}
