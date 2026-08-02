import { redirect } from 'next/navigation';

interface PageProps {
  params: { locale: string };
}

/**
 * Teacher onboarding is retired.
 *
 * Bilgim is an English-only platform, so there is no subject-classification
 * quiz: every teacher teaches English and is auto-assigned the English
 * specialty by the API. Any direct visit to this route is redirected to the
 * dashboard.
 */
export default function OnboardingPage({ params: { locale } }: PageProps) {
  redirect(`/${locale}/dashboard`);
}
