import { users } from '@ideas-hub/db';
import { asc } from 'drizzle-orm';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { t } from '@/lib/strings.vi';
import { createUser, setDisabled } from './actions';

const s = t.admin.users;

export default async function UsersPage() {
  const me = await requireAdmin();
  const rows = await db.select().from(users).orderBy(asc(users.name));
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
              <TableCell className="text-right">
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
    </>
  );
}
