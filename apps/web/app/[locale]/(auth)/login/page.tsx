import { Suspense } from 'react';
import type { Metadata } from 'next';
import { unstable_setRequestLocale } from 'next-intl/server';
import { LoginForm } from '../../../../components/auth/login-form';
import { AuroraAuthLayout } from '../../../../components/auth/aurora-auth-layout';

interface LoginPageProps {
  params: { locale: string };
}

export function generateMetadata({
  params: { locale },
}: LoginPageProps): Metadata {
  const title = "Kirish | Bilgim";
  const description =
    "Bilgim akkauntingizga kiring — kurslaringiz, jonli darslar va uy vazifalariga davom eting.";
  return {
    title,
    description,
    alternates: { canonical: `/${locale}/login` },
    openGraph: {
      type: 'website',
      title,
      description,
      url: `/${locale}/login`,
      siteName: 'Bilgim',
    },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default function LoginPage({ params: { locale } }: LoginPageProps) {
  unstable_setRequestLocale(locale);

  return (
    <AuroraAuthLayout locale={locale} footer="signup">
      <div className="space-y-2">
        <h1
          className="text-3xl font-extrabold tracking-tight text-ink-strong"
          style={{ letterSpacing: '-0.035em' }}
        >
          Xush kelibsiz
        </h1>
        <p className="text-ink-soft">
          Akkauntingizga kirish uchun ma&apos;lumotlarni kiriting
        </p>
      </div>

      <div className="mt-7">
        {/* `LoginForm` reads `useSearchParams()` for the `callbackUrl`
         * query param, which forces a CSR bailout during prerender. The
         * Suspense boundary lets Next.js render a placeholder during
         * SSG and hydrate the real form on the client. */}
        <Suspense fallback={null}>
          <LoginForm locale={locale} />
        </Suspense>
      </div>
    </AuroraAuthLayout>
  );
}
