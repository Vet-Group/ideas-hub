import { db } from '@/lib/db';
import { now } from '@/lib/now';
import { objectStore } from '@/lib/object-store';
import { currentUser } from '@/lib/session';
import { handleManualIdea } from './handler';

export async function POST(request: Request) {
  return handleManualIdea(request, { db, viewer: await currentUser(), store: objectStore, appUrl: process.env.APP_URL ?? '', now });
}
