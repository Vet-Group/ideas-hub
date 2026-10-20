import { type AdFilters } from '@ideas-hub/db/queries';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { t } from '@/lib/strings.vi';

const selectClass = 'border-input bg-surface h-9 w-full rounded-md border px-2 text-sm focus:ring-ring/50 focus:border-ring outline-none focus:ring-[3px]';

/** The 200 px filter rail: a GET form, so the filters land in the URL query. */
export function FilterRail({ f, keywords, countries }: { f: AdFilters; keywords: { id: string; text: string }[]; countries: readonly string[] }) {
  return (
    <form action="/ads" method="get" className="grid content-start gap-3" aria-label={t.ads.filters}>
      <div className="grid gap-1">
        <Label htmlFor="f-status">{t.ads.status}</Label>
        <select id="f-status" name="status" defaultValue={f.status ?? 'running'} className={selectClass}>
          <option value="running">{t.states.adStatus.running}</option>
          <option value="out_of_top">{t.states.adStatus.out_of_top}</option>
          <option value="stopped_or_unknown">{t.states.adStatus.stopped_or_unknown}</option>
          <option value="all">{t.ads.statusAll}</option>
        </select>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="f-kw">{t.ads.keyword}</Label>
        <select id="f-kw" name="kw" defaultValue={f.keywordId ?? ''} className={selectClass}>
          <option value="">{t.ads.any}</option>
          {keywords.map((k) => (
            <option key={k.id} value={k.id}>
              {k.text}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="f-country">{t.ads.country}</Label>
        <select id="f-country" name="country" defaultValue={f.country ?? ''} className={selectClass}>
          <option value="">{t.ads.any}</option>
          {countries.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="f-days">{t.ads.minDays}</Label>
        <Input id="f-days" name="days" type="number" min={0} inputMode="numeric" defaultValue={f.minDays ?? ''} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="f-score">{t.ads.minScore}</Label>
        <Input id="f-score" name="score" type="number" min={0} inputMode="numeric" defaultValue={f.minScore ?? ''} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="f-domain">{t.ads.domain}</Label>
        <Input id="f-domain" name="domain" defaultValue={f.domain ?? ''} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="f-sort">{t.ads.sort}</Label>
        <select id="f-sort" name="sort" defaultValue={f.sort ?? 'score'} className={selectClass}>
          {Object.entries(t.ads.sorts).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm">
          {t.ads.apply}
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Link href="/ads">{t.ads.reset}</Link>
        </Button>
      </div>
    </form>
  );
}
