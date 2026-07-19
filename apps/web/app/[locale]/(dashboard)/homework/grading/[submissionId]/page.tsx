import { unstable_setRequestLocale } from 'next-intl/server';

import { TeacherGradingDetail } from '../../../../../../components/homework/teacher-grading-detail';
import { requireAuth } from '../../../../../../lib/auth-server';

interface GradingDetailPageProps {
  params: { locale: string; submissionId: string };
}

/**
 * `/[locale]/homework/grading/[submissionId]` — Teacher grade view
 * (Task 25.4, Req 12.5).
 *
 * Renders the assignment modules in read-only mode populated with the
 * student's answers and exposes:
 *   - score input (validated against `assignment.totalPoints`)
 *   - rubric breakdown (per-criterion sub-scores, bubbled into
 *     `Feedback.payload`)
 *   - free-form feedback text
 *   - "Talabaga qaytarish" action (RETURNED).
 */
export default function GradingDetailPage({
  params: { locale, submissionId },
}: GradingDetailPageProps) {
  unstable_setRequestLocale(locale);
  requireAuth({ locale, roles: ['TEACHER', 'ADMIN'] });

  return (
    <TeacherGradingDetail locale={locale} submissionId={submissionId} />
  );
}
