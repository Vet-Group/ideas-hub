import 'server-only';
import { now } from './now';

/** A CSV download named `<name>-<day in Vietnam>.csv`, never cached or sniffed. */
export function csvResponse(name: string, body: string): Response {
  const day = now().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}-${day}.csv"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}

/** Rows a CSV export holds at most. */
export const CSV_ROW_CAP = 5000;
