import Link from 'next/link';
import { notFound } from 'next/navigation';
import { unstable_setRequestLocale } from 'next-intl/server';
import { ArrowLeft, Pencil } from 'lucide-react';

import { requireRole } from '../../../../../../../../../../lib/server-auth';
import {
  serverApi,
  ServerApiError,
} from '../../../../../../../../../../lib/server-api';
import type { Lesson } from '../../../../../../../../../../lib/api/catalog';
import { LessonPublishButton } from '../../../../../../../../../../components/dashboard/lesson-publish-button';
import { LessonMaterials } from '../../../../../../../../../../components/dashboard/lesson-materials';

interface PageProps {
  params: {
    locale: string;
    courseId: string;
    groupId: string;
    lessonId: string;
  };
}

const LESSON_STATUS_LABEL: Record<Lesson['status'], string> = {
  DRAFT: 'Qoralama',
  READY: 'Nashrda',
  ARCHIVED: 'Arxivda',
};

const LESSON_TYPE_LABEL: Record<Lesson['type'], string> = {
  RECORDED: 'Yozib olingan',
  LIVE: 'Jonli efir',
  HYBRID: 'Aralash',
  TEXT_ONLY: 'Matn',
};

export default async function LessonDetailPage({
  params: { locale, courseId, groupId, lessonId },
}: PageProps) {
  unstable_setRequestLocale(locale);
  requireRole(['TEACHER', 'ADMIN'], locale);

  let lesson: Lesson;
  try {
    lesson = await serverApi.get<Lesson>(`/catalog/lessons/${lessonId}`);
  } catch (err) {
    if (err instanceof ServerApiError && (err.statusCode === 404 || err.statusCode === 403)) {
      notFound();
    }
    throw err;
  }

  return (
    <div className="space-y-8">
      <Link
        href={`/${locale}/dashboard/courses/${courseId}/groups/${groupId}`}
        className="inline-flex items-center gap-1 text-sm font-medium text-ink-soft hover:text-ink-strong"
      >
        <ArrowLeft className="h-4 w-4" />
        Guruhga qaytish
      </Link>

      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={
                'rounded-full px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wide ' +
                (lesson.status === 'READY'
                  ? 'bg-green-tint text-green'
                  : lesson.status === 'ARCHIVED'
                    ? 'bg-red-tint text-red'
                    : 'bg-soft text-ink-soft')
              }
            >
              {LESSON_STATUS_LABEL[lesson.status]}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wide text-ink-soft">
              {LESSON_TYPE_LABEL[lesson.type]}
            </span>
            {lesson.scheduledAt && (
              <span className="font-mono text-[10px] uppercase tracking-wide text-ink-soft">
                {new Date(lesson.scheduledAt).toLocaleString('uz-UZ')}
              </span>
            )}
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink-strong sm:text-3xl">
            {lesson.title}
          </h1>
          {lesson.description && (
            <p className="max-w-2xl text-sm text-ink-soft">
              {lesson.description}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href={`/${locale}/dashboard/courses/${courseId}/groups/${groupId}/lessons/${lesson.id}/edit`}
            className="inline-flex items-center gap-1.5 rounded-xl border border-rim bg-canvas px-3 py-2 text-sm font-medium text-ink-strong shadow-soft hover:bg-soft"
          >
            <Pencil className="h-4 w-4" />
            Tahrirlash
          </Link>
          <LessonPublishButton lessonId={lesson.id} status={lesson.status} />
        </div>
      </header>

      <LessonMaterials lessonId={lesson.id} />
    </div>
  );
}
