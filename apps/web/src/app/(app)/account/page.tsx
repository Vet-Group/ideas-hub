import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { requireUser } from '@/lib/session';
import { t } from '@/lib/strings.vi';
import { ChangePasswordForm } from './change-password-form';

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ changed?: string }> }) {
  const user = await requireUser();
  const { changed } = await searchParams;
  return (
    <>
      <PageHeader title={t.account.title} />
      <p className="text-fg-2 mb-4 text-[13px]">
        {user.name} · {user.email}
      </p>
      <section aria-labelledby="change-password" className="max-w-sm">
        <h2 id="change-password" className="mb-1 text-[16px] font-semibold">
          {t.account.changePassword}
        </h2>
        <p className="text-fg-2 mb-3 text-[13px]">{t.account.hint}</p>
        {changed === '1' ? (
          <p role="status" className="bg-selected rounded-card mb-3 p-3 text-[13px]">
            {t.account.saved}
          </p>
        ) : null}
        <ChangePasswordForm />
      </section>
      <p className="mt-6 text-[13px]">
        <Link href="/account/tokens" className="underline">
          {t.account.tokensLink}
        </Link>
      </p>
    </>
  );
}
