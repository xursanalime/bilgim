import { unstable_setRequestLocale } from 'next-intl/server';

import { TeacherAnalyticsPage } from '../../../../../components/dashboard/teacher-analytics';
import { requireAuth } from '../../../../../lib/auth-server';

interface AnalyticsPageProps {
  params: { locale: string };
}

/**
 * `/[locale]/teacher/analytics` — Task 23.2.
 *
 * Server component. Runs `requireAuth` so unauthenticated visitors
 * bounce to login, and pins the page to the TEACHER + ADMIN role set —
 * keeping access aligned with the API's `@Roles('TEACHER', 'ADMIN')`.
 *
 * The actual rendering happens in the `<TeacherAnalyticsPage>` client
 * component which fans out the three `/teacher/analytics/*` reads via
 * React Query.
 */
export default function AnalyticsPage({
  params: { locale },
}: AnalyticsPageProps) {
  unstable_setRequestLocale(locale);
  requireAuth({ locale, roles: ['TEACHER', 'ADMIN'] });

  return <TeacherAnalyticsPage locale={locale} />;
}
