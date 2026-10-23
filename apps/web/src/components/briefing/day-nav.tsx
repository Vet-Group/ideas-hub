import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { addDays } from '@/lib/day';
import { t } from '@/lib/strings.vi';

/**
 * Previous/next day links of a briefing page. `latest` is the newest day a link may reach: the next link is
 * hidden from it on, and the day before it links to `/briefing`, which is where that day lives.
 */
export function DayNav({ date, latest }: { date: string; latest: string }) {
  const next = addDays(date, 1);
  return (
    <nav aria-label={t.briefing.dayNav} className="mb-3 flex gap-2">
      <Button asChild size="sm" variant="outline">
        <Link href={`/briefing/${addDays(date, -1)}`}>{t.briefing.prevDay}</Link>
      </Button>
      {date < latest ? (
        <Button asChild size="sm" variant="outline">
          <Link href={next >= latest ? '/briefing' : `/briefing/${next}`}>{t.briefing.nextDay}</Link>
        </Button>
      ) : null}
    </nav>
  );
}
