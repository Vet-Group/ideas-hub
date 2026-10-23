import { can } from '@ideas-hub/core';
import { storeMembers, users } from '@ideas-hub/db';
import { getIdea, suggestionNewsItems } from '@ideas-hub/db/queries';
import { asc, eq } from 'drizzle-orm';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Thumb } from '@/components/ads/thumb';
import { SuggestionEvidence } from '@/components/briefing/ai-panels';
import { PageHeader } from '@/components/page-header';
import { db } from '@/lib/db';
import { formatDateTime } from '@/lib/format';
import { requireUser } from '@/lib/session';
import { t } from '@/lib/strings.vi';
import { thumbUrl } from '@/lib/thumb-url';
import { IdeaDetailsForm } from './details-form';

/** One idea; 404 when it does not exist or is in a store the user may not view (an undone idea too). */
export default async function IdeaPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const idea = await getIdea(db, user, (await params).id);
  if (!idea) notFound();
  const snap = idea.snapshot as { thumbnailKey?: string | null; caption?: string | null; link?: string | null; adLibraryUrl?: string | null; keyword?: string | null; trendScore?: number | null; mediaType?: string | null; kind?: 'idea' | 'keyword'; text?: string; reason?: string; evidence?: { ads?: string[]; news?: string[] } };
  const isSuggestion = idea.source === 'suggestion';
  const newsById = new Map((isSuggestion && idea.sourceRef ? await suggestionNewsItems(db, idea.sourceRef) : []).map((n) => [n.id, n]));
  const canSave = can(user, idea.storeId, 'save');
  const members = canSave
    ? await db.select({ id: users.id, name: users.name }).from(storeMembers).innerJoin(users, eq(users.id, storeMembers.userId)).where(eq(storeMembers.storeId, idea.storeId)).orderBy(asc(users.name))
    : [];
  return (
    <>
      <PageHeader title={idea.title}>
        <Link href={`/ideas?store=${idea.storeId}`} className="text-sm underline">
          {t.ideaViews.back}
        </Link>
      </PageHeader>
      <div className={isSuggestion ? 'grid gap-4' : 'grid gap-4 md:grid-cols-[320px_minmax(0,1fr)]'}>
        {isSuggestion ? null : (
          <div className="grid content-start gap-2">
            {idea.imageKey ? (
              // The image route checks the session, which the optimizer's fetch would not carry.
              <Image src={`/ideas/${idea.id}/image`} alt={idea.title} width={320} height={320} unoptimized className="rounded-card w-full object-contain" />
            ) : (
              <Thumb src={snap.thumbnailKey ? thumbUrl(snap.thumbnailKey) : null} mediaType={snap.mediaType} alt={idea.title} className="rounded-card" />
            )}
          </div>
        )}
        <div className="grid content-start gap-3">
          <p className="text-fg-2 text-sm">
            {t.ideaViews.sources[idea.source]} · {t.ideaViews.via[idea.via]} · {idea.createdByName} · {formatDateTime(idea.createdAt)}
          </p>
          {isSuggestion ? (
            <div className="grid gap-1 text-sm">
              <p>
                {snap.kind ? <span className="bg-neutral-bg text-fg-2 rounded-pill mr-2 px-2 py-0.5 text-xs">{t.briefing.suggestionKind[snap.kind]}</span> : null}
                <span className="font-medium whitespace-pre-line">{snap.text}</span>
              </p>
              {snap.reason ? <p className="text-fg-2">{snap.reason}</p> : null}
              {snap.keyword ? (
                <p className="text-fg-2">
                  {t.ideaViews.columns.keyword}: {snap.keyword}
                </p>
              ) : null}
              <SuggestionEvidence evidence={{ ads: snap.evidence?.ads ?? [], news: snap.evidence?.news ?? [] }} newsById={newsById} adHref={(id) => `/ads/${encodeURIComponent(id)}`} />
            </div>
          ) : null}
          {snap.caption ? <p className="text-sm whitespace-pre-line">{snap.caption}</p> : null}
          <div className="flex flex-wrap gap-3 text-sm">
            {snap.adLibraryUrl ? (
              <a href={snap.adLibraryUrl} target="_blank" rel="noopener noreferrer" className="underline">
                {t.ads.openLibrary}
              </a>
            ) : null}
            {snap.link ? (
              <a href={snap.link} target="_blank" rel="noopener noreferrer nofollow" className="underline">
                {t.ideaViews.openSource}
              </a>
            ) : null}
          </div>
          <IdeaDetailsForm
            id={idea.id}
            title={idea.title}
            status={idea.status}
            notes={idea.notes ?? ''}
            tags={idea.tags}
            assigneeId={idea.assigneeId}
            members={members}
            canSave={canSave}
            assigneeName={idea.assigneeName}
          />
        </div>
      </div>
    </>
  );
}
