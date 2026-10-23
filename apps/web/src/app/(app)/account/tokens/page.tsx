import { storeScope } from '@ideas-hub/core';
import { TOKEN_SCOPES, apiTokens, stores, users } from '@ideas-hub/db';
import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db } from '@/lib/db';
import { formatDateTime } from '@/lib/format';
import { now } from '@/lib/now';
import { requireUser } from '@/lib/session';
import { t } from '@/lib/strings.vi';
import { revokeToken } from './actions';
import { TokenForm } from './token-form';

const s = t.tokens;

/** A user's own API tokens; an admin also sees, and can revoke, those of the service users they created. */
export default async function TokensPage() {
  const me = await requireUser();
  const scope = storeScope(me);
  const [storeRows, serviceUsers, tokens] = await Promise.all([
    scope.storeIds === 'all'
      ? db.select({ id: stores.id, name: stores.name }).from(stores).orderBy(asc(stores.name))
      : scope.storeIds.length === 0
        ? []
        : db.select({ id: stores.id, name: stores.name }).from(stores).where(inArray(stores.id, [...scope.storeIds])).orderBy(asc(stores.name)),
    me.role === 'admin'
      ? db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(and(eq(users.createdBy, me.userId), eq(users.disabled, false))).orderBy(asc(users.name))
      : [],
    db
      .select({
        id: apiTokens.id,
        name: apiTokens.name,
        scopes: apiTokens.scopes,
        storeIds: apiTokens.storeIds,
        expiresAt: apiTokens.expiresAt,
        lastUsedAt: apiTokens.lastUsedAt,
        revokedAt: apiTokens.revokedAt,
        ownerEmail: users.email,
      })
      .from(apiTokens)
      .innerJoin(users, eq(users.id, apiTokens.userId))
      .where(or(eq(apiTokens.userId, me.userId), me.role === 'admin' ? eq(users.createdBy, me.userId) : undefined))
      .orderBy(desc(apiTokens.createdAt)),
  ]);
  const storeNames = new Map(storeRows.map((x) => [x.id, x.name]));
  const at = now();
  const status = (k: (typeof tokens)[number]) => (k.revokedAt ? s.revoked : k.expiresAt <= at ? s.expired : s.active);
  return (
    <>
      <PageHeader title={s.title}>
        <Link href="/account" className="text-sm underline">
          {t.account.title}
        </Link>
      </PageHeader>
      <p className="text-fg-2 mb-4 max-w-xl text-[13px]">{s.hint}</p>
      <section aria-labelledby="create-token" className="mb-6">
        <h2 id="create-token" className="mb-2 text-[16px] font-semibold">
          {s.createHeading}
        </h2>
        <TokenForm scopes={TOKEN_SCOPES} stores={storeRows} serviceUsers={serviceUsers.map((u) => ({ id: u.id, label: `${u.name} · ${u.email}` }))} />
      </section>
      <section aria-labelledby="token-list">
        <h2 id="token-list" className="mb-2 text-[16px] font-semibold">
          {s.listHeading}
        </h2>
        {tokens.length === 0 ? (
          <p className="border-line text-fg-2 rounded-card border border-dashed p-4">{s.empty}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{s.colName}</TableHead>
                <TableHead>{s.colOwner}</TableHead>
                <TableHead>{s.colScopes}</TableHead>
                <TableHead>{s.colStores}</TableHead>
                <TableHead>{s.colExpires}</TableHead>
                <TableHead>{s.colLastUsed}</TableHead>
                <TableHead>{s.colStatus}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.map((k) => (
                <TableRow key={k.id}>
                  <TableCell>{k.name}</TableCell>
                  <TableCell>{k.ownerEmail}</TableCell>
                  <TableCell>{k.scopes.map((x) => s.scopeLabels[x] ?? x).join(', ')}</TableCell>
                  <TableCell>{k.storeIds ? k.storeIds.map((id) => storeNames.get(id) ?? id).join(', ') : s.allStores}</TableCell>
                  <TableCell>{formatDateTime(k.expiresAt)}</TableCell>
                  <TableCell>{k.lastUsedAt ? formatDateTime(k.lastUsedAt) : s.never}</TableCell>
                  <TableCell>{status(k)}</TableCell>
                  <TableCell className="text-right">
                    {k.revokedAt ? null : (
                      <form action={revokeToken}>
                        <input type="hidden" name="tokenId" value={k.id} />
                        <Button type="submit" variant="outline" size="sm">
                          {s.revoke}
                        </Button>
                      </form>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </>
  );
}
