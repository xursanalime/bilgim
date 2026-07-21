import { unstable_setRequestLocale } from 'next-intl/server';

import { AssignmentsList } from '../../../../components/homework/assignments-list';
import { requireAuth } from '../../../../lib/auth-server';

interface AssignmentsPageProps {
  params: { locale: string };
}

export default function AssignmentsPage({
  params: { locale },
}: AssignmentsPageProps) {
  unstable_setRequestLocale(locale);
  // Both STUDENT and TEACHER can land here. The page itself is
  // student-facing (`/lessons/:id/assignments` calls succeed for
  // teachers as well, so a teacher would see assignments for the
  // groups they own).
  requireAuth({ locale });

  return <AssignmentsList locale={locale} />;
}
