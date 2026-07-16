import { unstable_setRequestLocale } from 'next-intl/server';

import { GradingQueue } from '../../../../../../components/homework/grading-queue';
import { requireAuth } from '../../../../../../lib/auth-server';

interface AssignmentGradingPageProps {
  params: { locale: string; assignmentId: string };
}

/**
 * `/[locale]/homework/[assignmentId]/grading` — teacher grading queue
 * scoped to a single assignment (frontend-redesign Task 6.4, Req 10.5).
 *
 * Lists every submission for the assignment with status filters and
 * AI-likelihood badges, and exposes the inline adjust / finalize /
 * return-to-student controls.
 */
export default function AssignmentGradingPage({
  params: { locale, assignmentId },
}: AssignmentGradingPageProps) {
  unstable_setRequestLocale(locale);
  requireAuth({ locale, roles: ['TEACHER', 'ADMIN'] });

  return <GradingQueue locale={locale} assignmentId={assignmentId} />;
}
