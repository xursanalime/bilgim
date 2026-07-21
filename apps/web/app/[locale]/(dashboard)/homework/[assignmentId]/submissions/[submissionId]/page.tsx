import { unstable_setRequestLocale } from 'next-intl/server';

import { TeacherGradingDetail } from '../../../../../../../components/homework/teacher-grading-detail';
import { requireAuth } from '../../../../../../../lib/auth-server';

interface AssignmentSubmissionPageProps {
  params: { locale: string; assignmentId: string; submissionId: string };
}

/**
 * `/[locale]/homework/[assignmentId]/submissions/[submissionId]` —
 * teacher grading view scoped to a specific assignment (Task 25.4).
 *
 * Same component as the global `/homework/grading/[submissionId]`
 * route, but passes the surrounding `assignmentId` so the back-link
 * routes back to the assignment detail. The student also has read-only
 * access (same submission, editable=false) when navigating from their
 * own assignment view.
 */
export default function AssignmentSubmissionPage({
  params: { locale, assignmentId, submissionId },
}: AssignmentSubmissionPageProps) {
  unstable_setRequestLocale(locale);
  requireAuth({ locale });

  return (
    <TeacherGradingDetail
      locale={locale}
      assignmentId={assignmentId}
      submissionId={submissionId}
    />
  );
}
