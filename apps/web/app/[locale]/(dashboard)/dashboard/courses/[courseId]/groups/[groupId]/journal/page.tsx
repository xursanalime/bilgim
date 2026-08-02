import { notFound } from 'next/navigation';
import { unstable_setRequestLocale } from 'next-intl/server';

import { requireRole } from '../../../../../../../../../lib/server-auth';
import { serverApi, ServerApiError } from '../../../../../../../../../lib/server-api';
import type { Group } from '../../../../../../../../../lib/api/catalog';
import { GroupJournal } from '../../../../../../../../../components/dashboard/group-journal';

interface PageProps {
  params: { locale: string; courseId: string; groupId: string };
}

export default async function GroupJournalPage({
  params: { locale, courseId, groupId },
}: PageProps) {
  unstable_setRequestLocale(locale);
  requireRole(['TEACHER', 'ADMIN'], locale);

  let group: Group;
  try {
    group = await serverApi.get<Group>(`/catalog/groups/${groupId}`);
  } catch (err) {
    if (err instanceof ServerApiError && (err.statusCode === 404 || err.statusCode === 403)) {
      notFound();
    }
    throw err;
  }

  return (
    <GroupJournal
      locale={locale}
      courseId={courseId}
      groupId={groupId}
      groupName={group.name}
      priceUzs={group.priceUzs}
      capacity={group.capacity}
    />
  );
}
