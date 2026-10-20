'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { undoAction } from '@/app/(app)/ideas/actions';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { t } from '@/lib/strings.vi';

/**
 * "Ý tưởng mới": a link and/or an image, and the stores. Posted to /api/ideas/manual (a route handler, not
 * a Server Action, because of the 5 MB image; plan Step 6), then the same toast as a save.
 */
export function NewIdeaDialog({ stores, defaultStoreId }: { stores: { id: string; name: string }[]; defaultStoreId: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<string[]>(defaultStoreId ? [defaultStoreId] : stores.slice(0, 1).map((s) => s.id));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (stores.length === 0) return null;

  const submit = (form: HTMLFormElement) => {
    const data = new FormData(form);
    const image = data.get('image');
    if (!String(data.get('link') ?? '').trim() && !(image instanceof File && image.size > 0)) {
      setError(t.ideaViews.needLinkOrImage);
      return;
    }
    if (!(image instanceof File && image.size > 0)) data.delete('image');
    data.delete('storeIds');
    for (const id of checked) data.append('storeIds', id);
    setError(null);
    start(async () => {
      const res = await fetch('/api/ideas/manual', { method: 'POST', body: data });
      const body = (await res.json().catch(() => ({}))) as { results?: { storeId: string; ideaId: string; created: boolean }[]; error?: string };
      if (!res.ok || !body.results) {
        setError(body.error ?? t.save.failed);
        return;
      }
      setOpen(false);
      form.reset();
      router.refresh();
      const created = body.results.filter((r) => r.created);
      const names = body.results.map((r) => stores.find((s) => s.id === r.storeId)?.name ?? r.storeId).join(', ');
      toast.success(created.length ? t.save.savedTo(names) : t.save.existing, {
        duration: 10_000,
        action: created.length
          ? {
              label: t.save.undo,
              onClick: async () => {
                const u = await undoAction(created.map((r) => r.ideaId));
                if (u.ok) toast(t.save.undone);
                else toast.error(u.error ?? t.save.expired);
                router.refresh();
              },
            }
          : undefined,
      });
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm">
          <Plus aria-hidden />
          {t.ideaViews.newIdea}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>{t.ideaViews.newIdea}</DialogTitle>
        <DialogDescription>{t.ideaViews.newIdeaHelp}</DialogDescription>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit(e.currentTarget);
          }}
        >
          <div className="grid gap-1">
            <Label htmlFor="idea-link">{t.ideaViews.link}</Label>
            <Input id="idea-link" name="link" type="url" inputMode="url" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="idea-title">{t.ideaViews.ideaTitle}</Label>
            <Input id="idea-title" name="title" maxLength={140} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="idea-image">{t.ideaViews.image}</Label>
            <Input id="idea-image" name="image" type="file" accept="image/jpeg,image/png,image/webp" />
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">{t.ideaViews.stores}</legend>
            {stores.map((s) => (
              <label key={s.id} className="flex min-h-6 items-center gap-2 text-sm">
                <Checkbox checked={checked.includes(s.id)} onCheckedChange={(v) => setChecked((c) => (v ? [...c, s.id] : c.filter((x) => x !== s.id)))} />
                {s.name}
              </label>
            ))}
          </fieldset>
          {error ? (
            <p role="alert" className="text-critical text-sm">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={pending || checked.length === 0}>
            {t.ideaViews.create}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
