import { unstable_setRequestLocale } from 'next-intl/server';

import { EnrollmentRequests } from '../../../../components/dashboard/enrollment-requests';
import { requireAuth } from '../../../../lib/auth-server';

interface RequestsPageProps {
  params: { locale: string };
}

/**
 * Teacher enrollment-requests inbox. Lists PENDING_APPROVAL join requests
 * across the teacher's groups with approve/reject actions.
 */
export default function RequestsPage({
  params: { locale },
}: RequestsPageProps) {
  unstable_setRequestLocale(locale);
  requireAuth({ locale, roles: ['TEACHER', 'ADMIN'] });
  return <EnrollmentRequests />;
}
