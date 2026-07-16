import type { Metadata } from 'next';
import { unstable_setRequestLocale } from 'next-intl/server';
import { ForgotPasswordForm } from '../../../../components/auth/forgot-password-form';
import { AuroraAuthLayout } from '../../../../components/auth/aurora-auth-layout';

interface ForgotPasswordPageProps {
  params: { locale: string };
}

import React from 'react';

export function generateMetadata({
  params: { locale },
}: ForgotPasswordPageProps): Metadata {
  const title = "Parolni tiklash | Bilgim";
  const description =
    "Bilgim akkauntingiz uchun parolni tiklash havolasini email orqali oling.";
  return {
    title,
    description,
    alternates: { canonical: `/${locale}/forgot-password` },
    openGraph: {
      type: 'website',
      title,
      description,
      url: `/${locale}/forgot-password`,
      siteName: 'Bilgim',
    },
    twitter: { card: 'summary_large_image', title, description },
  };
}

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
