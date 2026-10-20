import { storeMembers, stores, users } from '@ideas-hub/db';
import { asc, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { t } from '@/lib/strings.vi';
import { removeMember, setMember, updateStore } from '../actions';

const s = t.admin.stores;

const Tick = ({ name, label, checked }: { name: string; label: string; checked: boolean }) => (
  <label className="inline-flex min-h-6 items-center gap-1.5 text-[13px]">
    <input type="checkbox" name={name} defaultChecked={checked} className="accent-ink size-4" />
    {label}
  </label>
);

export default async function StorePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const [store] = await db.select().from(stores).where(eq(stores.id, id));
  if (!store) notFound();
  const members = await db
    .select({ userId: users.id, name: users.name, email: users.email, view: storeMembers.canView, save: storeMembers.canSave, keywords: storeMembers.canKeywords })
    .from(storeMembers)
    .innerJoin(users, eq(users.id, storeMembers.userId))
    .where(eq(storeMembers.storeId, id))
    .orderBy(asc(users.name));
  const others = (await db.select({ id: users.id, name: users.name, role: users.role }).from(users).orderBy(asc(users.name))).filter(
    (u) => u.role !== 'admin' && !members.some((m) => m.userId === u.id),
  );
  return (
    <>
      <PageHeader title={store.name} />
      <form action={updateStore} className="bg-surface border-line rounded-card mb-6 grid gap-3 border p-3 md:grid-cols-4 md:items-end">
        <input type="hidden" name="id" value={store.id} />
        {(
          [
            ['name', s.name, store.name],
            ['erpStoreCode', s.erp, store.erpStoreCode],
            ['podStudioStoreId', s.pod, store.podStudioStoreId],
            ['larkChatId', s.lark, store.larkChatId],
          ] as const
        ).map(([name, label, value]) => (
          <div key={name} className="grid gap-1.5">
            <Label htmlFor={name}>{label}</Label>
            <Input id={name} name={name} defaultValue={value ?? ''} required={name === 'name'} />
          </div>
        ))}
        <div className="md:col-span-4">
          <Button type="submit">{t.common.save}</Button>
        </div>
      </form>

      <h2 className="mb-2 text-[16px] font-semibold">{s.members}</h2>
      {members.length === 0 ? <p className="text-fg-2 mb-3">{s.noMembers}</p> : null}
      {members.length ? (
        <Table className="mb-4">
          <TableHeader>
            <TableRow>
              <TableHead>{s.member}</TableHead>
              <TableHead>{`${s.view} · ${s.saveTick} · ${s.keywordsTick}`}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => (
              <TableRow key={m.userId}>
                <TableCell>
                  {m.name} <span className="text-fg-2">{m.email}</span>
                </TableCell>
                <TableCell>
                  <form action={setMember} className="flex flex-wrap items-center gap-3">
                    <input type="hidden" name="storeId" value={id} />
                    <input type="hidden" name="userId" value={m.userId} />
                    <Tick name="view" label={s.view} checked={m.view} />
                    <Tick name="save" label={s.saveTick} checked={m.save} />
                    <Tick name="keywords" label={s.keywordsTick} checked={m.keywords} />
                    <Button type="submit" size="sm" variant="outline">
                      {t.common.save}
                    </Button>
                  </form>
                </TableCell>
                <TableCell className="text-right">
                  <form action={removeMember}>
                    <input type="hidden" name="storeId" value={id} />
                    <input type="hidden" name="userId" value={m.userId} />
                    <Button type="submit" size="sm" variant="ghost">
                      {s.remove}
                    </Button>
                  </form>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
      {others.length ? (
        <form action={setMember} className="bg-surface border-line rounded-card flex flex-wrap items-end gap-3 border p-3">
          <input type="hidden" name="storeId" value={id} />
          <div className="grid gap-1.5">
            <Label htmlFor="userId">{s.member}</Label>
            <select id="userId" name="userId" className="border-input bg-surface rounded-control h-9 min-w-56 border px-2 text-[13px]">
              {others.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <Tick name="view" label={s.view} checked />
          <Tick name="save" label={s.saveTick} checked={false} />
          <Tick name="keywords" label={s.keywordsTick} checked={false} />
          <Button type="submit">{s.addMember}</Button>
        </form>
      ) : null}
    </>
  );
}
