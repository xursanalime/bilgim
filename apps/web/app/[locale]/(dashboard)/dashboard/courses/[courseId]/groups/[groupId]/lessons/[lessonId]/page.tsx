import Link from 'next/link';
import { notFound } from 'next/navigation';
import { unstable_setRequestLocale } from 'next-intl/server';
import {
  ArrowLeft,
  Pencil,
  Radio,
  Calendar,
  PlayCircle,
  Layers,
  FileText,
} from 'lucide-react';

import { requireRole } from '../../../../../../../../../../lib/server-auth';
import {
  serverApi,
  ServerApiError,
} from '../../../../../../../../../../lib/server-api';
import type { Lesson } from '../../../../../../../../../../lib/api/catalog';
import type { AssignmentWithModules } from '../../../../../../../../../../lib/api/homework';
import { LessonAssignments } from '../../../../../../../../../../components/dashboard/lesson-assignments';
import { cn } from '../../../../../../../../../../lib/utils';
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

const LESSON_STATUS_BADGE: Record<Lesson['status'], string> = {
  DRAFT: 'border-rim bg-tint text-ink-faint',
  READY: 'border-transparent bg-teal text-white',
  ARCHIVED: 'border-red/10 bg-red-tint text-red',
};

const LESSON_TYPE_LABEL: Record<Lesson['type'], string> = {
  RECORDED: 'Yozib olingan',
  LIVE: 'Jonli efir',
  HYBRID: 'Aralash',
  TEXT_ONLY: 'Matn',
};

const LESSON_TYPE_ICON: Record<Lesson['type'], typeof PlayCircle> = {
  RECORDED: PlayCircle,
  LIVE: Radio,
  HYBRID: Layers,
  TEXT_ONLY: FileText,
};

const LESSON_TYPE_COLOR: Record<Lesson['type'], string> = {
  RECORDED: 'bg-blue-tint text-blue',
  LIVE: 'bg-purple-tint text-purple',
  HYBRID: 'bg-orange-tint text-orange',
  TEXT_ONLY: 'bg-teal-tint text-teal',
};

const LESSON_TYPE_AURA: Record<Lesson['type'], string> = {
  RECORDED: 'bg-blue/5',
  LIVE: 'bg-purple/5',
  HYBRID: 'bg-orange/5',
  TEXT_ONLY: 'bg-teal/5',
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

  // Homework attached to this lesson. A failure here must not take the whole
  // lesson page down — the section renders its own error instead.
  let assignments: AssignmentWithModules[] = [];
  let assignmentsError: string | null = null;
  try {
    assignments = await serverApi.get<AssignmentWithModules[]>(
      `/lessons/${lessonId}/assignments`,
    );
  } catch (err) {
    if (!(err instanceof ServerApiError)) throw err;
    assignmentsError = err.message;
  }

  const TypeIcon = LESSON_TYPE_ICON[lesson.type];

  return (
    <div className="mx-auto max-w-5xl space-y-8 pb-12">
      <Link
        href={`/${locale}/dashboard/courses/${courseId}/groups/${groupId}`}
        className="group inline-flex items-center gap-2 text-sm font-bold text-ink-soft transition-colors hover:text-blue"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-tint group-hover:bg-blue/10">
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
        </div>
        Guruhga qaytish
      </Link>

      <header className="relative overflow-hidden rounded-[2.5rem] border border-rim bg-white p-8 shadow-soft sm:p-10">
        <div
          className={cn(
            'pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full blur-[80px]',
            LESSON_TYPE_AURA[lesson.type],
          )}
        />

        <div className="relative z-10 flex flex-col justify-between gap-8 lg:flex-row lg:items-start">
          <div className="flex min-w-0 flex-1 gap-5">
            <div
              className={cn(
                'flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl',
                LESSON_TYPE_COLOR[lesson.type],
              )}
            >
              <TypeIcon className="h-6 w-6" />
            </div>

            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <span
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                    LESSON_STATUS_BADGE[lesson.status],
                  )}
                >
                  {LESSON_STATUS_LABEL[lesson.status]}
                </span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-ink-faint">
                  {LESSON_TYPE_LABEL[lesson.type]}
                </span>
                {lesson.scheduledAt && (
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-ink-faint">
                    <Calendar className="h-3 w-3" />
                    {new Date(lesson.scheduledAt).toLocaleString('uz-UZ')}
                  </span>
                )}
              </div>

              <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink-strong sm:text-3xl">
                {lesson.title}
              </h1>

              {lesson.description && (
                <p className="max-w-2xl text-sm leading-relaxed text-ink-soft opacity-80">
                  {lesson.description}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* HYBRID is "recorded + live", so it needs the broadcast entry
                point just as much as LIVE does — gating on LIVE alone left
                every hybrid lesson with no way to go on air, even though the
                API never restricted the lesson type. */}
            {(lesson.type === 'LIVE' || lesson.type === 'HYBRID') && (
              <Link
                href={`/${locale}/live/${lesson.id}?groupId=${groupId}&courseId=${courseId}`}
                className="inline-flex h-11 items-center gap-2 rounded-2xl bg-purple-tint px-5 text-sm font-bold text-purple transition-all hover:bg-purple/20 active:scale-[0.98]"
              >
                <Radio className="h-4 w-4" />
                Efirga kirish
              </Link>
            )}
            <Link
              href={`/${locale}/dashboard/courses/${courseId}/groups/${groupId}/lessons/${lesson.id}/edit`}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-rim bg-white px-5 text-sm font-bold text-ink-strong shadow-sm transition-all hover:bg-tint hover:border-blue/20 active:scale-[0.98]"
            >
              <Pencil className="h-4 w-4" />
              Tahrirlash
            </Link>
            <LessonPublishButton lessonId={lesson.id} status={lesson.status} />
          </div>
        </div>
      </header>

      <LessonMaterials lessonId={lesson.id} />

      <LessonAssignments
        assignments={assignments}
        locale={locale}
        courseId={courseId}
        groupId={groupId}
        lessonId={lesson.id}
        loadError={assignmentsError}
      />
    </div>
  );
}
