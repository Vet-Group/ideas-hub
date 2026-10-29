import { can } from '@ideas-hub/core';
import { IDEA_STATUSES, storeMembers, users } from '@ideas-hub/db';
import { type IdeaStatus, ideaFunnel, ideaKeywordOptions, listIdeas, storeHasIdeas } from '@ideas-hub/db/queries';
import { asc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { IdeaFunnel } from '@/components/ideas/funnel';
import { IdeasView } from '@/components/ideas/ideas-view';
import { NewIdeaDialog } from '@/components/ideas/new-idea-dialog';
import { StoreSelect } from '@/components/ideas/store-select';
import { type IdeaItem } from '@/components/ideas/types';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/session';
import { saveTargets, userStores } from '@/lib/store';
import { t } from '@/lib/strings.vi';
import { thumbUrl } from '@/lib/thumb-url';
import { cn } from '@/lib/utils';

type Params = { store?: string; view?: string; status?: string; tag?: string; keyword?: string; assignee?: string; q?: string };

const selectClass = 'border-input bg-surface h-9 rounded-md border px-2 text-sm outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/50';

/** `/ideas?store=…&view=table|board`: members with `view` on the store and admins; 404 otherwise. */
export default async function IdeasPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requireUser();
  const p = await searchParams;
  const { stores, selectedId } = await userStores(user);
  const storeId = p.store ?? selectedId;
  if (!storeId) {
    return (
      <>
        <PageHeader title={t.ideaViews.title} />
        <p className="text-fg-2">{t.ideaViews.noStore}</p>
      </>
    );
  }
  const opt = (v?: string) => v?.trim() || undefined;
  const filters = { tag: opt(p.tag), keyword: opt(p.keyword), assigneeId: opt(p.assignee), q: opt(p.q) };
  const rows = await listIdeas(db, user, storeId, filters);
  if (!rows) notFound();
  const tab: IdeaStatus = IDEA_STATUSES.includes(p.status as IdeaStatus) ? (p.status as IdeaStatus) : 'new';
  const filtered = Object.values(filters).some(Boolean);
  const [members, keywords, targets, anyIdeas, funnel] = await Promise.all([
    db.select({ id: users.id, name: users.name }).from(storeMembers).innerJoin(users, eq(users.id, storeMembers.userId)).where(eq(storeMembers.storeId, storeId)).orderBy(asc(users.name)),
    ideaKeywordOptions(db, user, storeId),
    saveTargets(user),
    filtered ? storeHasIdeas(db, user, storeId) : rows.length > 0,
    ideaFunnel(db, user, storeId),
  ]);
  const canSave = can(user, storeId, 'save');
  const ideas: IdeaItem[] = rows.map((r) => {
    const snap = r.snapshot as { keyword?: string | null; thumbnailKey?: string | null };
    return {
      id: r.id,
      title: r.title,
      source: r.source,
      via: r.via,
      keyword: snap.keyword ?? null,
      status: r.status,
      assigneeName: r.assigneeName,
      createdByName: r.createdByName,
      updatedAt: r.updatedAt.toISOString(),
      thumbSrc: snap.thumbnailKey ? thumbUrl(snap.thumbnailKey) : null,
      imageSrc: r.imageKey ? `/ideas/${r.id}/image` : null,
    };
  });
  const keep = new URLSearchParams(Object.entries({ store: storeId, ...p, status: undefined }).filter((e): e is [string, string] => !!e[1]));
  const tabHref = (s: IdeaStatus) => `/ideas?${new URLSearchParams({ ...Object.fromEntries(keep), status: s }).toString()}`;
  const csv = `/ideas/csv?${new URLSearchParams(Object.entries({ store: storeId, tag: filters.tag, keyword: filters.keyword, assignee: filters.assigneeId, q: filters.q }).filter((e): e is [string, string] => !!e[1])).toString()}`;
  const view = p.view === 'board' || p.view === 'table' ? p.view : null;
  // Back to the store's whole list; none when that is the page already shown.
  const clearHref = filtered || tab !== 'new' ? `/ideas?${new URLSearchParams({ store: storeId, ...(view ? { view } : {}) }).toString()}` : null;

  return (
    <>
      <PageHeader title={`${t.ideaViews.title} · ${stores.find((s) => s.id === storeId)?.name ?? ''}`}>
        <div className="flex flex-wrap items-center gap-2">
          {stores.length > 1 ? <StoreSelect stores={stores} storeId={storeId} /> : null}
          <Button asChild size="sm" variant="outline">
            <a href={csv} download>
              {t.ideaViews.csv}
            </a>
          </Button>
          <NewIdeaDialog stores={targets} defaultStoreId={canSave ? storeId : null} />
        </div>
      </PageHeader>
      <form action="/ideas" method="get" className="mb-3 flex flex-wrap items-end gap-2" aria-label={t.ideaViews.filters}>
        <input type="hidden" name="store" value={storeId} />
        {view ? <input type="hidden" name="view" value={view} /> : null}
        <input type="hidden" name="status" value={tab} />
        <div className="grid gap-1">
          <Label htmlFor="i-q">{t.ideaViews.text}</Label>
          <Input id="i-q" name="q" defaultValue={filters.q ?? ''} className="w-56" />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="i-tag">{t.ideaViews.tag}</Label>
          <Input id="i-tag" name="tag" defaultValue={filters.tag ?? ''} className="w-32" />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="i-kw">{t.ideaViews.keyword}</Label>
          <select id="i-kw" name="keyword" defaultValue={filters.keyword ?? ''} className={selectClass}>
            <option value="">{t.ideaViews.all}</option>
            {(keywords ?? []).map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="i-as">{t.ideaViews.assignee}</Label>
          <select id="i-as" name="assignee" defaultValue={filters.assigneeId ?? ''} className={selectClass}>
            <option value="">{t.ideaViews.all}</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="sm" variant="outline">
          {t.ideaViews.apply}
        </Button>
      </form>
      <nav aria-label={t.ideaViews.columns.status} className="mb-3 flex flex-wrap gap-1">
        {IDEA_STATUSES.map((s) => (
          <Link
            key={s}
            href={tabHref(s)}
            aria-current={s === tab ? 'page' : undefined}
            className={cn('rounded-md px-3 py-1.5 text-sm', s === tab ? 'bg-ink text-on-ink' : 'hover:bg-selected')}
          >
            {t.ideaViews.statuses[s]} <span className="font-mono text-xs">{ideas.filter((i) => i.status === s).length}</span>
          </Link>
        ))}
      </nav>
      <IdeasView ideas={ideas} canSave={canSave} view={view} tab={tab} storeHasIdeas={anyIdeas ?? false} clearHref={clearHref} />
      {funnel ? <IdeaFunnel weeks={funnel} /> : null}
    </>
  );
}
