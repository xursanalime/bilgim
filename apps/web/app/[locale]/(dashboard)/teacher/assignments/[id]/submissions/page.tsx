import { unstable_setRequestLocale } from 'next-intl/server';

import { TeacherSubmissionsList } from '../../../../../../../components/homework/teacher-submissions-list';
import { requireAuth } from '../../../../../../../lib/auth-server';

interface TeacherSubmissionsPageProps {
  params: { locale: string; id: string };
}

export default function TeacherSubmissionsPage({
  params: { locale, id },
}: TeacherSubmissionsPageProps) {
  unstable_setRequestLocale(locale);
  // Teacher-facing page. Server-side guard restricts access to
  // TEACHER / ADMIN; the API layer additionally enforces
  // lesson-ownership (NOT_OWNING_TEACHER) for the per-assignment list.
  requireAuth({ locale, roles: ['TEACHER', 'ADMIN'] });

  return <TeacherSubmissionsList locale={locale} assignmentId={id} />;
}
