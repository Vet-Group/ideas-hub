import { db } from '@/lib/db';
import { handleHealth } from './handler';

export const dynamic = 'force-dynamic';

export function GET() {
  return handleHealth(db);
}
