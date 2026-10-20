// GET /ideas/[id]/image: an uploaded idea image after the session and store-scope check (plan Step 6
// "Idea images"). Pages show it with `next/image` `unoptimized`, since the optimizer's fetch has no session.
import { type Viewer } from '@ideas-hub/core';
import { type Db } from '@ideas-hub/db/client';
import { getIdea } from '@ideas-hub/db/queries';
import type { ObjectStore } from '@/lib/object-store';

const base = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' };

/** 404 for a missing idea, one outside the viewer's scope, no session or no image alike. */
export async function handleIdeaImage(ideaId: string, deps: { db: Db; viewer: Viewer | null; store: Pick<ObjectStore, 'getObject'> }): Promise<Response> {
  const notFound = () => new Response(null, { status: 404, headers: base });
  if (!deps.viewer) return notFound();
  const idea = await getIdea(deps.db, deps.viewer, ideaId);
  if (!idea?.imageKey) return notFound();
  const object = await deps.store.getObject(idea.imageKey).catch(() => null);
  if (!object) return notFound();
  const headers = new Headers({ ...base, 'Content-Type': 'image/webp' });
  if (object.contentLength !== undefined) headers.set('Content-Length', String(object.contentLength));
  return new Response(object.body, { headers });
}
