'use client';

import { Play } from 'lucide-react';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/strings.vi';
import { runNowAction } from './actions';

/** Visible to those who may use it; disabled with its reason when a run would be refused (spec §6). */
export function RunNowButton({ keywordId, blocker }: { keywordId: string; blocker: string | null }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        disabled={!!blocker || pending}
        aria-describedby={blocker ? 'run-now-reason' : undefined}
        onClick={() =>
          start(async () => {
            const r = await runNowAction(keywordId);
            if (r.ok) toast.success(t.runNow.started);
            else toast.error(r.error);
          })
        }
      >
        <Play aria-hidden />
        {t.runNow.button}
      </Button>
      {blocker ? (
        <span id="run-now-reason" className="text-fg-2 text-sm">
          {blocker}
        </span>
      ) : null}
    </div>
  );
}
