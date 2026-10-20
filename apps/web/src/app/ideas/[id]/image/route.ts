import { db } from '@/lib/db';
import { objectStore } from '@/lib/object-store';
import { currentUser } from '@/lib/session';
import { handleIdeaImage } from './handler';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleIdeaImage(id, { db, viewer: await currentUser(), store: objectStore });
}
