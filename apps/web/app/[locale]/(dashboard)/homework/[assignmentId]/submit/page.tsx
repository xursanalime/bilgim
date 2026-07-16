import { unstable_setRequestLocale } from 'next-intl/server';

import { AssignmentRunner } from '../../../../../../components/homework/assignment-runner';
import { requireAuth } from '../../../../../../lib/auth-server';

interface HomeworkSubmitPageProps {
  params: { locale: string; assignmentId: string };
}

/**
 * `/[locale]/homework/[assignmentId]/submit` — Student submission form
 * (Task 25.4, Req 12.1).
 *
 * Behaviour:
 *   - Lazily creates / loads the student's DRAFT submission via
 *     POST /assignments/:id/submissions.
 *   - Renders one input per AssignmentModule (writing, reading, …).
 *   - Autosaves the merged answers every 10 seconds and on unmount.
 *   - "Yuborish" → POST /submissions/:id/submit then redirects back to
 *     the assignment view.
 *
 * Server-side guard restricts the page to STUDENT (the API enforces
 * the same constraint, this is just a coarse 403-avoidance check). An
 * ADMIN can visit it for moderation.
 */
export default function HomeworkSubmitPage({
  params: { locale, assignmentId },
}: HomeworkSubmitPageProps) {
  unstable_setRequestLocale(locale);
  requireAuth({ locale, roles: ['STUDENT', 'ADMIN'] });

  return (
    <AssignmentRunner locale={locale} assignmentId={assignmentId} />
  );
}
