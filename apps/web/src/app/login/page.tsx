import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session';
import { safeCallback } from '@/lib/callback';
import { t } from '@/lib/strings.vi';
import { LoginForm } from './login-form';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ callbackURL?: string }> }) {
  const { callbackURL } = await searchParams;
  const origin = new URL(process.env.APP_URL ?? 'http://localhost:3300').origin;
  const next = safeCallback(callbackURL, origin);
  if (await currentUser()) redirect(next);
  return (
    <main id="main" className="grid min-h-screen place-items-center px-4">
      <div className="bg-surface border-line rounded-card w-full max-w-sm border p-6 shadow-card">
        <p className="text-brand mb-1 text-[13px] font-semibold tracking-wide">{t.app.name}</p>
        <h1 className="mb-5 text-[length:var(--vet-text-h1)] font-semibold">{t.login.title}</h1>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
