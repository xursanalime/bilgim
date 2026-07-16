import type { Metadata } from 'next';
import { unstable_setRequestLocale } from 'next-intl/server';
import { RegisterForm } from '../../../../components/auth/register-form';
import { AuroraAuthLayout } from '../../../../components/auth/aurora-auth-layout';

interface RegisterPageProps {
  params: { locale: string };
  searchParams: { role?: string; callbackUrl?: string };
}

export function generateMetadata({
  params: { locale },
}: RegisterPageProps): Metadata {
  const title = "Ro'yxatdan o'tish | Bilgim";
  const description =
    "Bilgim'da bepul ro'yxatdan o'ting — 14 kunlik sinov, karta talab qilinmaydi. O'qituvchi yoki talaba sifatida boshlang.";
  return {
    title,
    description,
    alternates: { canonical: `/${locale}/register` },
    openGraph: {
      type: 'website',
      title,
      description,
      url: `/${locale}/register`,
      siteName: 'Bilgim',
    },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default function RegisterPage({
  params: { locale },
  searchParams,
}: RegisterPageProps) {
  unstable_setRequestLocale(locale);

  // Default role from query param (?role=teacher or ?role=student)
  const initialRole =
    searchParams.role === 'teacher'
      ? 'TEACHER'
      : searchParams.role === 'student'
      ? 'STUDENT'
      : 'TEACHER';

  return (
    <AuroraAuthLayout locale={locale} footer="login">
      <div className="space-y-2">
        <h1
          className="text-3xl font-extrabold tracking-tight text-ink-strong"
          style={{ letterSpacing: '-0.035em' }}
        >
          Ro&apos;yxatdan o&apos;ting
        </h1>
        <p className="text-ink-soft">
          14 kunlik bepul sinov &nbsp;·&nbsp; Karta talab qilinmaydi
        </p>
      </div>

      <div className="mt-7">
        <RegisterForm locale={locale} initialRole={initialRole} {...(searchParams.callbackUrl ? { callbackUrl: searchParams.callbackUrl } : {})} />
      </div>
    </AuroraAuthLayout>
  );
}
