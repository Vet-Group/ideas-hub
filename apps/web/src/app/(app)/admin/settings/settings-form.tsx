'use client';

import { useActionState, useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { t } from '@/lib/strings.vi';
import { type SaveResult, saveSettings } from './actions';

const s = t.admin.settings;

export interface FieldView {
  key: string;
  label: string;
  kind: string;
  value?: string;
  parts?: { name: string; label: string; value: string }[];
}

export function SettingsForm({ fields }: { fields: FieldView[] }) {
  const [state, action, pending] = useActionState<SaveResult | null, FormData>(saveSettings, null);
  useEffect(() => {
    if (state?.ok) toast.success(s.saved);
  }, [state]);
  const errorOf = (name: string) => state?.fieldErrors?.find((e) => e.key === name);
  const input = (name: string, label: string, value: string | undefined, numeric: boolean) => {
    const err = errorOf(name);
    return (
      <div key={name} className="grid gap-1.5">
        <Label htmlFor={name}>{label}</Label>
        <Input
          id={name}
          name={name}
          defaultValue={value}
          inputMode={numeric ? 'decimal' : undefined}
          aria-invalid={err ? true : undefined}
          aria-describedby={err ? `${name}-err` : undefined}
        />
        {err ? (
          <p id={`${name}-err`} className="text-critical text-[12px]">
            {s.fieldErrors[err.code]}
          </p>
        ) : null}
      </div>
    );
  };
  return (
    <form action={action} className="grid gap-4">
      {state?.problems?.length ? (
        <div role="alert" className="bg-critical-bg text-critical rounded-card p-3 text-[13px]">
          <p className="font-semibold">{s.invalid}</p>
          <ul className="list-disc pl-5">
            {state.problems.map((p) => (
              <li key={p}>{s.problems[p] ?? p}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {state?.ok ? (
        <p role="status" className="text-success text-[13px] font-semibold">
          {s.saved}
        </p>
      ) : null}
      <div className="bg-surface border-line rounded-card grid gap-4 border p-3 md:grid-cols-2 xl:grid-cols-3">
        {fields.map((f) =>
          f.parts ? (
            <fieldset key={f.key} className="border-line rounded-control grid gap-2 border p-2 md:col-span-2 xl:col-span-3">
              <legend className="px-1 text-[13px] font-semibold">{f.label}</legend>
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">{f.parts.map((p) => input(p.name, p.label, p.value, true))}</div>
            </fieldset>
          ) : (
            input(f.key, f.label, f.value, f.kind === 'number')
          ),
        )}
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          {s.submit}
        </Button>
      </div>
    </form>
  );
}
