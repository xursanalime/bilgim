import { unstable_setRequestLocale } from 'next-intl/server';

import { TeacherGradingQueue } from '../../../../../components/homework/teacher-grading-queue';
import { requireAuth } from '../../../../../lib/auth-server';

interface GradingQueuePageProps {
  params: { locale: string };
}

/**
 * `/[locale]/homework/grading` — Teacher grading queue (Task 25.4).
 *
 * Lists every SUBMITTED / IN_REVIEW submission across the teacher's
 * own assignments, with AI-flag pills and quick links into the per-
 * submission grading view.
 */
export default function GradingQueuePage({
  params: { locale },
}: GradingQueuePageProps) {
  unstable_setRequestLocale(locale);
  requireAuth({ locale, roles: ['TEACHER', 'ADMIN'] });

  return <TeacherGradingQueue locale={locale} />;
}
