import { unstable_setRequestLocale } from 'next-intl/server';

import { TeacherSubmissionReview } from '../../../../../../../../components/homework/teacher-submission-review';
import { requireAuth } from '../../../../../../../../lib/auth-server';

interface TeacherSubmissionReviewPageProps {
  params: { locale: string; id: string; submissionId: string };
}

export default function TeacherSubmissionReviewPage({
  params: { locale, id, submissionId },
}: TeacherSubmissionReviewPageProps) {
  unstable_setRequestLocale(locale);
  requireAuth({ locale, roles: ['TEACHER', 'ADMIN'] });

  return (
    <TeacherSubmissionReview
      locale={locale}
      assignmentId={id}
      submissionId={submissionId}
    />
  );
}
