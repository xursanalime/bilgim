import Link from 'next/link';
import { notFound } from 'next/navigation';
import { unstable_setRequestLocale } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';

import { requireRole } from '../../../../../../../../../../lib/server-auth';
import {
  serverApi,
  ServerApiError,
} from '../../../../../../../../../../lib/server-api';
import type {
  Group,
  GroupModule,
} from '../../../../../../../../../../lib/api/catalog';
import { GroupModuleSettings } from '../../../../../../../../../../components/teacher/group-module-settings';

interface PageProps {
  params: { locale: string; courseId: string; groupId: string };
}

export default async function GroupModulesPage({
  params: { locale, courseId, groupId },
}: PageProps) {
  unstable_setRequestLocale(locale);
  requireRole(['TEACHER', 'ADMIN'], locale);

  let group: Group;
  let modules: GroupModule[] = [];
  try {
    [group, modules] = await Promise.all([
      serverApi.get<Group>(`/catalog/groups/${groupId}`),
      serverApi.get<GroupModule[]>(`/catalog/groups/${groupId}/modules`),
    ]);
  } catch (err) {
    if (err instanceof ServerApiError && (err.statusCode === 404 || err.statusCode === 403)) {
      notFound();
    }
    throw err;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-10 pb-12">
      <nav>
        <Link
          href={`/${locale}/dashboard/courses/${courseId}/groups/${groupId}`}
          className="group inline-flex items-center gap-2 text-sm font-bold text-ink-soft transition-colors hover:text-blue"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-tint group-hover:bg-blue/10">
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          </div>
          {group.name}
        </Link>
      </nav>

      <header className="group relative overflow-hidden rounded-[2.5rem] border border-rim bg-white p-8 shadow-soft sm:p-10 lg:p-12">
        {/* Aurora glow */}
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-blue/5 blur-[80px]" />
        
        <div className="relative z-10 space-y-4">
          <div className="flex items-center gap-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-blue">
            <span className="relative flex h-1.5 w-1.5 rounded-full bg-blue" />
            Tizim sozlamalari
          </div>
          
          <div className="space-y-2">
            <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink-strong sm:text-4xl">
              Guruh sozlamalari
            </h1>
            <p className="max-w-2xl text-sm leading-relaxed text-ink-soft opacity-90">
              Materiallarni yuklab olish ruxsatini va o&apos;quvchilar uchun qaysi
              til ko&apos;nikmasi vazifalari ruxsat etilganini boshqaring.
              O&apos;chirilgan modullar yangi vazifalarda ko&apos;rinmaydi, lekin
              mavjud ma&apos;lumotlar saqlanib qoladi.
            </p>
          </div>
        </div>
      </header>

      <div className="relative">
        {/* Subtle decorative glow */}
        <div className="pointer-events-none absolute -left-20 top-0 h-64 w-64 rounded-full bg-blue/5 blur-[100px]" />

        <GroupModuleSettings
          groupId={group.id}
          initialModules={modules}
          initialDownloadAllowed={group.downloadAllowed}
        />
      </div>
    </div>
  );
}
