import { AD_FORMATS, AD_PLATFORMS, type AdFilters } from '@ideas-hub/db/queries';
import { SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { FilterToggle } from './filter-toggle';
import { t } from '@/lib/strings.vi';

const selectClass = 'border-input bg-surface h-9 w-full rounded-md border px-2 text-sm focus:ring-ring/50 focus:border-ring outline-none focus:ring-[3px]';

/** The 200 px filter rail: a GET form, so the filters land in the URL query. */
export function FilterRail({ f, keywords, countries }: { f: AdFilters; keywords: { id: string; text: string }[]; countries: readonly string[] }) {
  const active = [f.status && f.status !== 'running', f.keywordId, f.country, f.minDays, f.minScore, f.domain, f.title, f.platform, f.format, f.dedupe, f.proven].filter(Boolean).length;
  return (
    <form action="/ads" method="get" className="grid content-start gap-3" aria-label={t.ads.filters}>
      {/* Below xl the fields fold behind this toggle so the ads come first (3 columns at 1024 px); a checkbox needs no script. */}
      <FilterToggle />
      <label
        htmlFor="f-toggle"
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'peer-focus-visible:ring-ring/50 justify-self-start peer-focus-visible:ring-[3px] xl:hidden')}
      >
        <SlidersHorizontal aria-hidden />
        {t.ads.filters}
        {active ? <span className="font-mono tabular-nums">{` · ${active}`}</span> : null}
      </label>
      <div id="f-fields" className="hidden content-start gap-3 peer-checked:grid sm:grid-cols-2 xl:grid xl:grid-cols-1">
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
          <Label htmlFor="f-platform">{t.ads.platform}</Label>
          <select id="f-platform" name="platform" defaultValue={f.platform ?? ''} className={selectClass}>
            <option value="">{t.ads.any}</option>
            {AD_PLATFORMS.map((v) => (
              <option key={v} value={v}>
                {t.ads.platforms[v]}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="f-format">{t.ads.format}</Label>
          <select id="f-format" name="format" defaultValue={f.format ?? ''} className={selectClass}>
            <option value="">{t.ads.any}</option>
            {AD_FORMATS.map((v) => (
              <option key={v} value={v}>
                {t.ads.formats[v]}
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
          <Label htmlFor="f-title">{t.ads.titleHas}</Label>
          <Input id="f-title" name="title" defaultValue={f.title ?? ''} />
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="f-dedupe" name="dedupe" value="1" defaultChecked={f.dedupe} className="size-6" />
          <Label htmlFor="f-dedupe">{t.ads.dedupe}</Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="f-proven" name="proven" value="1" defaultChecked={f.proven} className="size-6" />
          <Label htmlFor="f-proven">{t.ads.provenOnly}</Label>
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
      </div>
    </form>
  );
}
