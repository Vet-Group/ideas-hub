import { PageHeader } from '@/components/page-header';
import { t } from '@/lib/strings.vi';

// Placeholder until Step 7 builds the briefing; sign-in lands here.
export default function BriefingPage() {
  return (
    <>
      <PageHeader title={t.briefing.title} />
      <div className="bg-surface border-line rounded-card text-fg-2 border p-3">{t.briefing.placeholder}</div>
    </>
  );
}
