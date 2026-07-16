import { redirect } from 'next/navigation';
import { unstable_setRequestLocale } from 'next-intl/server';

import { InstructorOnboardingForm } from '../../../../components/dashboard/instructor-onboarding-form';
import { requireAuth } from '../../../../lib/auth-server';

interface PageProps {
  params: { locale: string };
}

/**
 * `/[locale]/onboarding` — English-focused instructor onboarding (Req 16.2).
 *
 * Bilgim is an English-only platform: instructors declare the CEFR levels and
 * exam-track focus they teach (no generic specialty quiz) and are routed to the
 * dashboard on completion. Non-instructors have no onboarding step and are sent
 * straight to the dashboard.
 */
export default function OnboardingPage({ params: { locale } }: PageProps) {
  unstable_setRequestLocale(locale);
  const user = requireAuth({ locale });

  if (user.role !== 'TEACHER') {
    redirect(`/${locale}/dashboard`);
  }

  return (
    <div className="py-6 sm:py-10">
      <InstructorOnboardingForm locale={locale} />
    </div>
  );
}
