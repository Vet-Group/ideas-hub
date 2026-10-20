import { KeywordReport } from '@/components/keyword-report';

export default async function KeywordPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ date?: string }> }) {
  const date = (await searchParams).date;
  return <KeywordReport id={(await params).id} date={date || undefined} />;
}
