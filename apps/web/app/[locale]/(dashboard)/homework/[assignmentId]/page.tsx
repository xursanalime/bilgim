import { unstable_setRequestLocale } from 'next-intl/server';

import { HomeworkAssignmentView } from '../../../../../components/homework/homework-assignment-view';
import { requireAuth } from '../../../../../lib/auth-server';

interface HomeworkAssignmentPageProps {
  params: { locale: string; assignmentId: string };
}

/**
 * `/[locale]/homework/[assignmentId]` — Assignment detail page.
 *
 * Renders the assignment metadata + ordered list of modules + a CTA to
 * the submission form (`/homework/:id/submit`). Teachers see a link
 * into the grading queue for the same assignment.
 */
export default function HomeworkAssignmentPage({
  params: { locale, assignmentId },
}: HomeworkAssignmentPageProps) {
  unstable_setRequestLocale(locale);
  const user = requireAuth({ locale });

  return (
    <HomeworkAssignmentView
      locale={locale}
      role={user.role}
      assignmentId={assignmentId}
    />
  );
}
