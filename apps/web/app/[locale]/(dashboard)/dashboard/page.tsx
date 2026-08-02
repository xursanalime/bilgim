import { unstable_setRequestLocale } from 'next-intl/server';

import { StudentDashboard } from '../../../../components/student/student-dashboard';
import { TeacherDashboard } from '../../../../components/dashboard/teacher-dashboard';
import { requireAuth } from '../../../../lib/auth-server';

interface DashboardPageProps {
  params: { locale: string };
}

/**
 * `/[locale]/dashboard` — role-aware home dashboard.
 *
 * - STUDENT: renders the per-enrollment progress dashboard.
 * - TEACHER / ADMIN: renders the analytics dashboard.
 *
 * Bilgim is English-only, so teachers no longer go through a subject
 * onboarding quiz. The teacher profile (with the English specialty) is
 * provisioned lazily by the API on first access, so the dashboard renders
 * directly.
 */
export default async function DashboardPage({
  params: { locale },
}: DashboardPageProps) {
  unstable_setRequestLocale(locale);
  const user = requireAuth({ locale });

  if (user.role === 'STUDENT') {
    return <StudentDashboard locale={locale} />;
  }

  return <TeacherDashboard locale={locale} />;
}
