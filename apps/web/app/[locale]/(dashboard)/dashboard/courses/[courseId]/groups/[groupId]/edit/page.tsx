import Link from 'next/link';
import { notFound } from 'next/navigation';
import { unstable_setRequestLocale } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';

import { requireRole } from '../../../../../../../../../lib/server-auth';
import {
  serverApi,
  ServerApiError,
} from '../../../../../../../../../lib/server-api';
import type { Group } from '../../../../../../../../../lib/api/catalog';
import { GroupForm } from '../../../../../../../../../components/dashboard/group-form';
import { GroupDeleteButton } from '../../../../../../../../../components/dashboard/group-delete-button';

interface PageProps {
  params: { locale: string; courseId: string; groupId: string };
}

export default async function EditGroupPage({
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
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href={`/${locale}/dashboard/courses/${courseId}/groups/${groupId}`}
        className="inline-flex items-center gap-1 text-sm font-medium text-ink-faint hover:text-ink-strong"
      >
        <ArrowLeft className="h-4 w-4" />
        {group.name}
      </Link>

      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink-strong">
          Guruhni tahrirlash
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          Guruh ma&apos;lumotlarini yangilang.
        </p>
      </div>

      <GroupForm
        locale={locale}
        mode="edit"
        courseId={courseId}
        initialData={{
          id: group.id,
          name: group.name,
          priceUzs: group.priceUzs,
          capacity: group.capacity,
          startsOn: group.startsOn,
          endsOn: group.endsOn,
        }}
      />

      <div className="rounded-2xl border border-red/15 bg-red-tint p-5">
        <h3 className="font-semibold text-red">Xavfli zona</h3>
        <p className="mt-1 text-xs text-ink-soft">
          Guruh va undagi barcha darslar o&apos;chiriladi. Talabalarning
          tasdiqlangan ro&apos;yxatlari saqlanmaydi.
        </p>
        <GroupDeleteButton
          groupId={group.id}
          locale={locale}
          courseId={courseId}
        />
      </div>
    </div>
  );
}
