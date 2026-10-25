import { redirect } from 'next/navigation';
import { DEFAULT_PAGE } from '@/lib/callback';

/** The bare domain (typed, bookmarked, or the sign-in callback `/`) opens the briefing. */
export default function Home() {
  redirect(DEFAULT_PAGE);
}
