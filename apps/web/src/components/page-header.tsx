import { type ReactNode } from 'react';

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 pt-2">
      <h1 className="text-[length:var(--vet-text-h1)] leading-tight font-semibold">{title}</h1>
      {children}
    </div>
  );
}
