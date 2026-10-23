'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TOKEN_DEFAULT_DAYS, TOKEN_MAX_DAYS } from '@/lib/api-v1/token';
import { t } from '@/lib/strings.vi';
import { type CreateTokenState, createToken } from './actions';

const s = t.tokens;

export function TokenForm({
  scopes,
  stores,
  serviceUsers,
}: {
  scopes: readonly string[];
  stores: { id: string; name: string }[];
  /** Admins only: the service users they created, who can own a token besides the admin. */
  serviceUsers: { id: string; label: string }[];
}) {
  const [state, action, pending] = useActionState<CreateTokenState, FormData>(createToken, null);
  return (
    <>
      {state && 'token' in state ? (
        <div role="status" className="bg-selected rounded-card mb-3 grid gap-2 p-3 text-[13px]">
          <p>{s.created(state.name)}</p>
          <code className="bg-surface border-line rounded-control block overflow-x-auto border p-2 select-all">{state.token}</code>
        </div>
      ) : null}
      <form action={action} className="bg-surface border-line rounded-card grid max-w-xl gap-4 border p-3">
        <div className="grid gap-1.5">
          <Label htmlFor="name">{s.name}</Label>
          <Input id="name" name="name" maxLength={80} required />
        </div>
        {serviceUsers.length > 0 ? (
          <div className="grid gap-1.5">
            <Label htmlFor="ownerId">{s.owner}</Label>
            <select id="ownerId" name="ownerId" className="border-input bg-surface rounded-control h-9 border px-2 text-[13px]" defaultValue="">
              <option value="">{s.ownerSelf}</option>
              {serviceUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <fieldset className="grid gap-1.5">
          <legend className="mb-1 text-[13px] font-medium">{s.scopes}</legend>
          {scopes.map((scope) => (
            <label key={scope} className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" name="scopes" value={scope} defaultChecked className="accent-ink size-5" />
              {s.scopeLabels[scope] ?? scope}
            </label>
          ))}
        </fieldset>
        {stores.length > 0 ? (
          <fieldset className="grid gap-1.5">
            <legend className="mb-1 text-[13px] font-medium">{s.stores}</legend>
            {stores.map((store) => (
              <label key={store.id} className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" name="storeIds" value={store.id} className="accent-ink size-5" />
                {store.name}
              </label>
            ))}
          </fieldset>
        ) : null}
        <div className="grid gap-1.5">
          <Label htmlFor="days">{s.days}</Label>
          <Input id="days" name="days" type="number" min={1} max={TOKEN_MAX_DAYS} defaultValue={TOKEN_DEFAULT_DAYS} required />
        </div>
        {state && 'error' in state ? (
          <p role="alert" className="text-critical text-[13px]">
            {state.error}
          </p>
        ) : null}
        <Button type="submit" disabled={pending} className="justify-self-start">
          {s.submit}
        </Button>
      </form>
    </>
  );
}
