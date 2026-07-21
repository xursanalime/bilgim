import { unstable_setRequestLocale } from 'next-intl/server';

import { StudentSchedule } from '../../../../components/student/student-schedule';
import { requireAuth } from '../../../../lib/auth-server';

interface SchedulePageProps {
  params: { locale: string };
}

export default function SchedulePage({
  params: { locale },
}: SchedulePageProps) {
  unstable_setRequestLocale(locale);
  // STUDENT-only — TEACHERs have a different schedule UI per group
  // (Task 25.2). Send teachers back to the dashboard rather than rendering
  // a half-built view.
  requireAuth({ locale, roles: ['STUDENT'] });
  return <StudentSchedule locale={locale} />;
}
