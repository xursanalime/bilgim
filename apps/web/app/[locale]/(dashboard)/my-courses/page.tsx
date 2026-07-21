import { unstable_setRequestLocale } from 'next-intl/server';

import { StudentCourses } from '../../../../components/student/student-courses';
import { requireAuth } from '../../../../lib/auth-server';

interface MyCoursesPageProps {
  params: { locale: string };
}

export default function MyCoursesPage({
  params: { locale },
}: MyCoursesPageProps) {
  unstable_setRequestLocale(locale);
  // STUDENT-only — teachers have their own /courses surface.
  requireAuth({ locale, roles: ['STUDENT'] });
  return <StudentCourses locale={locale} />;
}
