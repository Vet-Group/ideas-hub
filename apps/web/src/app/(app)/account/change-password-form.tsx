'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { t } from '@/lib/strings.vi';
import { changePassword } from './actions';

const s = t.account;

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePassword, null);
  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="currentPassword">{s.current}</Label>
        <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="newPassword">{s.new}</Label>
        <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" minLength={8} required />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="repeatPassword">{s.repeat}</Label>
        <Input id="repeatPassword" name="repeatPassword" type="password" autoComplete="new-password" required />
      </div>
      {state?.error ? (
        <p role="alert" className="text-critical text-[13px]">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {s.submit}
      </Button>
    </form>
  );
}
