import { unstable_setRequestLocale } from 'next-intl/server';

import { GroupDetail } from '../../../../../components/student/group-detail';
import { requireAuth } from '../../../../../lib/auth-server';

interface GroupPageProps {
  params: { locale: string; id: string };
}

export default function GroupDetailPage({
  params: { locale, id },
}: GroupPageProps) {
  unstable_setRequestLocale(locale);
  // Both STUDENT and TEACHER can land here. Per-user authorization is
  // enforced by the API endpoints (`/catalog/groups/:id`,
  // `/catalog/groups/:id/lessons`, `/schedule/groups/:id/events`) which
  // already differentiate between owning teacher and APPROVED student.
  requireAuth({ locale });

  return <GroupDetail locale={locale} groupId={id} />;
}
