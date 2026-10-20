import Link from 'next/link';
import { t } from '@/lib/strings.vi';

/** Also the "No permission" state: a page the user may not open looks missing (spec §6). */
export default function NotFound() {
  return (
    <main id="main" className="grid min-h-[60vh] place-items-center px-4 text-center">
      <div>
        <h1 className="mb-2 text-[length:var(--vet-text-h1)] font-semibold">{t.common.notFound}</h1>
        <p className="text-fg-2 mb-4">{t.common.notFoundBody}</p>
        <Link href="/briefing" className="text-ink font-semibold underline underline-offset-2">
          {t.common.backHome}
        </Link>
      </div>
    </main>
  );
}
