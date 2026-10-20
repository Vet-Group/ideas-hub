import { KeywordReport } from '@/components/keyword-report';

/** The keyword report for a past date. */
export default async function KeywordDatePage({ params }: { params: Promise<{ id: string; date: string }> }) {
  const { id, date } = await params;
  return <KeywordReport id={id} date={date} />;
}
