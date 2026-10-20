import { AdsView } from '@/components/ads/ads-view';
import { type SearchParams } from '@/components/ads/params';

export default async function AdsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <AdsView params={await searchParams} selectedId={null} />;
}
