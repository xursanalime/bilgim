import { unstable_setRequestLocale } from 'next-intl/server';

import { StudentAssignmentDetail } from '../../../../../components/homework/student-assignment-detail';
import { requireAuth } from '../../../../../lib/auth-server';

interface AssignmentDetailPageProps {
  params: { locale: string; id: string };
}

export default function AssignmentDetailPage({
  params: { locale, id },
}: AssignmentDetailPageProps) {
  unstable_setRequestLocale(locale);
  // The API enforces ownership / enrollment server-side
  // (`/assignments/:id` and `/submissions/me?assignmentId=...`). The
  // page is reachable for STUDENT, TEACHER and ADMIN; per-role
  // affordances live in the client component.
  requireAuth({ locale });

  return <StudentAssignmentDetail locale={locale} assignmentId={id} />;
}
