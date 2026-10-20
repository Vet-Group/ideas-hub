import { TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { crawlerAttention } from '@/lib/attention';
import { t } from '@/lib/strings.vi';

/** Admins only (spec §6 "Crawler attention"): `blocked_until` in the future or an Alert not resolved. */
export async function AttentionBar() {
  const a = await crawlerAttention();
  if (!a.blockedUntil && a.openAlerts === 0) return null;
  return (
    <div role="status" className="bg-warn-bg text-warn border-warn-line mx-[var(--vet-main-pad-x)] mb-3 flex items-center gap-2 rounded-card border px-3 py-2 text-[13px]">
      <TriangleAlert className="size-4 shrink-0" aria-hidden />
      <span className="flex-1">
        {a.blockedUntil ? `${t.attention.blockedUntil(a.blockedUntil)} ` : null}
        {a.openAlerts > 0 ? t.attention.openAlerts(a.openAlerts) : null}
      </span>
      <Link href="/admin/alerts" className="font-semibold underline underline-offset-2">
        {t.attention.link}
      </Link>
    </div>
  );
}
