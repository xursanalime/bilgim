import { unstable_setRequestLocale } from 'next-intl/server';

import { HomeworkOverview } from '../../../../components/homework/homework-overview';
import { requireAuth } from '../../../../lib/auth-server';

interface HomeworkPageProps {
  params: { locale: string };
}

/**
 * `/[locale]/homework` — Homework hub (Task 25.4).
 *
 * Routes both STUDENT and TEACHER traffic into the same overview page.
 * The client component branches on the JWT role:
 *   - STUDENT: list of assigned homework with status badges
 *     (DRAFT / SUBMITTED / GRADED / RETURNED) grouped per group.
 *   - TEACHER: list of assignments they created with submission counts.
 */
export default function HomeworkPage({
  params: { locale },
}: HomeworkPageProps) {
  unstable_setRequestLocale(locale);
  const user = requireAuth({ locale });

  return <HomeworkOverview locale={locale} role={user.role} />;
}
