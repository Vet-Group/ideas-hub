'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { StatusMenu, type Status } from '@/components/ideas/status-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { t } from '@/lib/strings.vi';
import { setStatusAction, updateIdeaAction } from '../actions';

/** Status, notes, tags and assignee, editable with `save` on the idea's store; read-only otherwise. */
export function IdeaDetailsForm(p: {
  id: string;
  title: string;
  status: Status;
  notes: string;
  tags: string[];
  assigneeId: string | null;
  assigneeName: string | null;
  members: { id: string; name: string }[];
  canSave: boolean;
}) {
  const [status, setStatus] = useState(p.status);
  const [pending, start] = useTransition();
  if (!p.canSave) {
    return (
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-fg-2">{t.ideaViews.columns.status}</dt>
        <dd>{t.ideaViews.statuses[p.status]}</dd>
        <dt className="text-fg-2">{t.ideaViews.assignee}</dt>
        <dd>{p.assigneeName ?? t.ideaViews.nobody}</dd>
        <dt className="text-fg-2">{t.ideaViews.notes}</dt>
        <dd className="whitespace-pre-line">{p.notes || t.common.none}</dd>
        <dt className="text-fg-2">{t.ideaViews.tag}</dt>
        <dd>{p.tags.join(', ') || t.common.none}</dd>
      </dl>
    );
  }
  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-fg-2">{t.ideaViews.columns.status}</span>
        <StatusMenu
          title={p.title}
          status={status}
          onChange={(s) =>
            start(async () => {
              if (await setStatusAction(p.id, s)) {
                setStatus(s);
                toast.success(t.ideaViews.moved(t.ideaViews.statuses[s]!));
              } else toast.error(t.ideaViews.moveFailed);
            })
          }
        />
      </div>
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const assignee = String(f.get('assignee') ?? '');
          start(async () => {
            const ok = await updateIdeaAction(p.id, {
              notes: String(f.get('notes') ?? '') || null,
              tags: String(f.get('tags') ?? '')
                .split(',')
                .map((x) => x.trim())
                .filter(Boolean),
              assigneeId: assignee || null,
            });
            if (ok) toast.success(t.ideaViews.detailsSaved);
            else toast.error(t.save.failed);
          });
        }}
      >
        <div className="grid gap-1">
          <Label htmlFor="d-assignee">{t.ideaViews.assignee}</Label>
          <select
            id="d-assignee"
            name="assignee"
            defaultValue={p.assigneeId ?? ''}
            className="border-input bg-surface h-9 rounded-md border px-2 text-sm outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/50"
          >
            <option value="">{t.ideaViews.nobody}</option>
            {p.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="d-notes">{t.ideaViews.notes}</Label>
          <Textarea id="d-notes" name="notes" defaultValue={p.notes} rows={4} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="d-tags">{t.ideaViews.tags}</Label>
          <Input id="d-tags" name="tags" defaultValue={p.tags.join(', ')} />
        </div>
        <Button type="submit" size="sm" disabled={pending} className="justify-self-start">
          {t.ideaViews.saveDetails}
        </Button>
      </form>
    </div>
  );
}
