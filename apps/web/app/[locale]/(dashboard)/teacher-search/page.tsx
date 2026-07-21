import { unstable_setRequestLocale } from 'next-intl/server';

import { TeacherSearch } from '../../../../components/student/teacher-search';
import { requireAuth } from '../../../../lib/auth-server';

interface TeachersPageProps {
  params: { locale: string };
}

export default function TeachersPage({
  params: { locale },
}: TeachersPageProps) {
  unstable_setRequestLocale(locale);
  // STUDENT-only — this is the authenticated "find a teacher and request
  // to join" flow, replacing the old public (marketing) /search page for
  // signed-in students so the dashboard shell (sidebar, session) never
  // unmounts while browsing.
  requireAuth({ locale, roles: ['STUDENT'] });
  return <TeacherSearch locale={locale} />;
}
