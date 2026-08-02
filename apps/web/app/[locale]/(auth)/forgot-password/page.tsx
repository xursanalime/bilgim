import { unstable_setRequestLocale } from 'next-intl/server';
import { ForgotPasswordForm } from '../../../../components/auth/forgot-password-form';
import { AuroraAuthLayout } from '../../../../components/auth/aurora-auth-layout';

interface ForgotPasswordPageProps {
  params: { locale: string };
}

import React from 'react';

export default function ForgotPasswordPage({
  params: { locale },
}: ForgotPasswordPageProps): React.JSX.Element {
  unstable_setRequestLocale(locale);

  return (
    <AuroraAuthLayout locale={locale} footer="login">
      <div className="space-y-2">
        <h1
          className="text-3xl font-extrabold tracking-tight text-ink-strong"
          style={{ letterSpacing: '-0.035em' }}
        >
          Parolni tiklash
        </h1>
        <p className="text-ink-soft">
          Email manzilingizni kiriting, sizga tiklash havolasini yuboramiz
        </p>
      </div>
      <div className="mt-7">
        <ForgotPasswordForm locale={locale} />
      </div>
    </AuroraAuthLayout>
  );
}
