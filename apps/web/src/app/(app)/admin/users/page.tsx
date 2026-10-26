import { users } from '@ideas-hub/db';
import { AC6_STORE_TARGET, AC6_TOTAL_TARGET, PILOT_RUN_START, storeAdoption, userAdoption } from '@ideas-hub/db/queries';
import { asc } from 'drizzle-orm';
import { PageHeader } from '@/components/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/db';
import { formatDate, formatDateTime } from '@/lib/format';
import { requireAdmin } from '@/lib/session';
import { t } from '@/lib/strings.vi';
import { createUser, setDisabled, updateLogin } from './actions';

const s = t.admin.users;

export default async function UsersPage() {
  const me = await requireAdmin();
  const [rows, perUser, perStore] = await Promise.all([
    db.select().from(users).orderBy(asc(users.name)),
    userAdoption(db),
    storeAdoption(db),
  ]);
  const adoption = new Map(perUser.map((a) => [a.userId, a]));
  const lastActive = (id: string) => adoption.get(id)?.lastActiveAt;
  const total = perStore.reduce((sum, st) => sum + st.ideas, 0);
  return (
    <>
      <PageHeader title={s.title} />
      <form action={createUser} className="bg-surface border-line rounded-card mb-4 grid gap-3 border p-3 md:grid-cols-[1fr_1fr_140px_1fr_auto] md:items-end">
        <div className="grid gap-1.5">
          <Label htmlFor="name">{s.name}</Label>
          <Input id="name" name="name" required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="email">{s.email}</Label>
          <Input id="email" name="email" type="email" required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="role">{s.role}</Label>
          <select id="role" name="role" className="border-input bg-surface rounded-control h-9 border px-2 text-[13px]" defaultValue="member">
            <option value="member">{s.roles.member}</option>
            <option value="admin">{s.roles.admin}</option>
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="password">{s.password}</Label>
          <Input id="password" name="password" type="password" minLength={8} required autoComplete="new-password" />
        </div>
        <Button type="submit">{s.create}</Button>
      </form>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{s.name}</TableHead>
            <TableHead>{s.email}</TableHead>
            <TableHead>{s.role}</TableHead>
            <TableHead>{t.runs.status}</TableHead>
            <TableHead>{s.lastActive}</TableHead>
            <TableHead>{s.savedFromBriefing}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((u) => (
            <TableRow key={u.id}>
              <TableCell>{u.name}</TableCell>
              <TableCell>{u.email}</TableCell>
              <TableCell>{s.roles[u.role] ?? u.role}</TableCell>
              <TableCell>{u.disabled ? s.disabled : s.active}</TableCell>
              <TableCell>{lastActive(u.id) ? formatDateTime(lastActive(u.id)) : s.neverActive}</TableCell>
              <TableCell>{u.role === 'admin' ? t.common.none : (adoption.get(u.id)?.ideas ?? 0)}</TableCell>
              <TableCell className="flex items-start justify-end gap-2">
                <details className="text-left">
                  <summary className={buttonVariants({ variant: 'outline', size: 'sm' })}>{s.editLogin}</summary>
                  <form action={updateLogin} className="mt-2 grid w-64 gap-2">
                    <input type="hidden" name="userId" value={u.id} />
                    <Label htmlFor={`email-${u.id}`}>{s.email}</Label>
                    <Input id={`email-${u.id}`} name="email" type="email" defaultValue={u.email} required />
                    <Label htmlFor={`password-${u.id}`}>{s.newPassword}</Label>
                    <Input id={`password-${u.id}`} name="password" type="password" minLength={8} autoComplete="new-password" />
                    <Button type="submit" size="sm">{s.saveLogin}</Button>
                  </form>
                </details>
                <form action={setDisabled}>
                  <input type="hidden" name="userId" value={u.id} />
                  <input type="hidden" name="disabled" value={u.disabled ? '0' : '1'} />
                  <Button
                    type="submit"
                    variant="outline"
                    size="sm"
                    disabled={u.id === me.userId}
                    title={u.id === me.userId ? s.cannotDisableSelf : undefined}
                  >
                    {u.disabled ? s.enable : s.disable}
                  </Button>
                </form>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <h2 className="mt-6 mb-1 text-[15px] font-semibold">{s.adoptionTitle}</h2>
      <p className="text-muted-foreground mb-2 text-[13px]">{s.adoptionNote(formatDate(PILOT_RUN_START))}</p>
      <Table>
        <TableBody>
          {perStore.map((st) => (
            <TableRow key={st.storeId}>
              <TableCell>{st.name}</TableCell>
              <TableCell className="text-right">{`${st.ideas}/${AC6_STORE_TARGET}`}</TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell className="font-semibold">{s.adoptionTotal}</TableCell>
            <TableCell className="text-right font-semibold">{`${total}/${AC6_TOTAL_TARGET}`}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </>
  );
}
