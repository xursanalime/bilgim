import { unstable_setRequestLocale } from 'next-intl/server';
import { ResetPasswordForm } from '../../../../components/auth/reset-password-form';
import { AuroraAuthLayout } from '../../../../components/auth/aurora-auth-layout';

interface ResetPasswordPageProps {
  params: { locale: string };
  searchParams?: { token?: string };
}

export default function ResetPasswordPage({
  params: { locale },
  searchParams,
}: ResetPasswordPageProps) {
  unstable_setRequestLocale(locale);

  return (
    <AuroraAuthLayout locale={locale} footer="login">
      <div className="space-y-2">
        <h1
          className="text-3xl font-extrabold tracking-tight text-ink-strong"
          style={{ letterSpacing: '-0.035em' }}
        >
          Yangi parol
        </h1>
        <p className="text-ink-soft">
          Yangi parolingizni kiriting va akkauntingizga kirishni davom ettiring
        </p>
      </div>
      <div className="mt-7">
        <ResetPasswordForm locale={locale} token={searchParams?.token} />
      </div>
    </AuroraAuthLayout>
  );
}
