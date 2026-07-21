import { unstable_setRequestLocale } from 'next-intl/server';
import { VerifyEmailClient } from '../../../../components/auth/verify-email-client';
import { AuroraAuthLayout } from '../../../../components/auth/aurora-auth-layout';

interface VerifyEmailPageProps {
  params: { locale: string };
  searchParams: { token?: string };
}

export default function VerifyEmailPage({
  params: { locale },
  searchParams,
}: VerifyEmailPageProps) {
  unstable_setRequestLocale(locale);

  return (
    <AuroraAuthLayout locale={locale} footer="login">
      <VerifyEmailClient locale={locale} token={searchParams.token} />
    </AuroraAuthLayout>
  );
}
