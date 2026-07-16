import Link from 'next/link';
import { notFound } from 'next/navigation';
import { unstable_setRequestLocale } from 'next-intl/server';
import { ArrowLeft, Pencil, Radio } from 'lucide-react';

import { requireRole } from '../../../../../../../../../../lib/server-auth';
import {
  serverApi,
  ServerApiError,
} from '../../../../../../../../../../lib/server-api';
import type { Lesson } from '../../../../../../../../../../lib/api/catalog';
import { LessonPublishButton } from '../../../../../../../../../../components/dashboard/lesson-publish-button';
import { LessonMaterials } from '../../../../../../../../../../components/dashboard/lesson-materials';
import { MultiVideoUploader } from '../../../../../../../../../../components/teacher/multi-video-uploader';

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
    <div className="mx-auto max-w-7xl space-y-10 pb-12">
      {/* Navigation */}
      <nav>
        <Link
          href={`/${locale}/dashboard/courses/${courseId}/groups/${groupId}`}
          className="group inline-flex items-center gap-2 text-sm font-bold text-ink-soft transition-colors hover:text-blue"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-tint group-hover:bg-blue/10">
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          </div>
          Guruhga qaytish
        </Link>
      </nav>

      {/* Hero Header */}
      <header className="group relative rounded-[2.5rem] border border-rim/50 bg-white/60 p-8 shadow-xl backdrop-blur-xl sm:p-10 lg:p-12">
        {/* Isolated background layer for clipped auroras */}
        <div className="absolute inset-0 overflow-hidden rounded-[2.5rem] pointer-events-none">
          <div className="absolute -right-20 -top-20 h-96 w-96 rounded-full bg-gradient-to-br from-purple/10 to-blue/10 blur-[80px]" />
          <div className="absolute -left-20 -bottom-20 h-96 w-96 rounded-full bg-gradient-to-tr from-pink/5 to-orange/5 blur-[80px]" />
        </div>

        <div className="relative z-10 flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={
                  'rounded-full px-2.5 py-0.5 text-[10px] font-mono font-extrabold uppercase tracking-wide ' +
                  (lesson.status === 'READY'
                    ? 'bg-teal/10 text-teal'
                    : lesson.status === 'ARCHIVED'
                      ? 'bg-red/10 text-red'
                      : 'bg-black/5 text-ink-soft')
                }
              >
                {LESSON_STATUS_LABEL[lesson.status]}
              </span>
              <span className="rounded-full bg-purple/10 text-purple px-2.5 py-0.5 font-mono text-[10px] font-extrabold uppercase tracking-wide">
                {LESSON_TYPE_LABEL[lesson.type]}
              </span>
              {lesson.scheduledAt && (
                <span className="rounded-full bg-orange/10 text-orange px-2.5 py-0.5 font-mono text-[10px] font-extrabold uppercase tracking-wide">
                  {new Date(lesson.scheduledAt).toLocaleString('uz-UZ')}
                </span>
              )}
            </div>

            <div className="space-y-3">
              <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink-strong sm:text-4xl">
                {lesson.title}
              </h1>
              {lesson.description && (
                <p className="max-w-xl text-sm leading-relaxed text-ink-soft opacity-80 italic">
                  {lesson.description}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 relative z-20">
            <Link
              href={`/${locale}/dashboard/courses/${courseId}/groups/${groupId}/lessons/${lesson.id}/edit`}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-white/60 bg-white/80 px-5 text-sm font-bold text-ink-strong shadow-sm backdrop-blur-md transition-all hover:bg-white hover:scale-[1.02] active:scale-[0.98]"
            >
              <Pencil className="h-4 w-4 text-blue" />
              Tahrirlash
            </Link>
            <LessonPublishButton lessonId={lesson.id} status={lesson.status} />
          </div>
        </div>
      </header>

      {(lesson.type === 'HYBRID' || lesson.type === 'LIVE') && (
        <section className="rounded-[2.5rem] border border-rim/50 bg-white/60 p-8 shadow-xl backdrop-blur-xl sm:p-10 lg:p-12">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-ink-strong">
                <Radio className="h-5 w-5 text-red" aria-hidden="true" />
                Jonli efir
              </h2>
              <p className="mt-1 text-sm text-ink-soft">
                Jonli efir xonasini oching va darsni boshlang. O&apos;quvchilar efir
                boshlanganda avtomatik qo&apos;shiladi.
              </p>
            </div>
            <Link
              href={`/${locale}/live/${lesson.id}`}
              className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-2xl bg-red px-6 text-sm font-bold text-white shadow-sm outline-none transition-all hover:bg-red/90 hover:scale-[1.02] focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 active:scale-[0.98]"
            >
              <Radio className="h-4 w-4" aria-hidden="true" />
              Efirni boshlash
            </Link>
          </div>
        </section>
      )}

      <section className="rounded-[2.5rem] border border-rim/50 bg-white/60 p-8 shadow-xl backdrop-blur-xl sm:p-10 lg:p-12">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-extrabold tracking-tight text-ink-strong">
            Video / Resumable upload
          </h2>
          <span className="rounded-full bg-blue/10 px-3 py-1 text-xs font-extrabold uppercase tracking-wider text-blue">
            Chunked
          </span>
        </div>
        <p className="mt-1 text-sm text-ink-soft">
          Large files upload in resumable chunks with pause, resume, and
          per-part retry. Up to 10 videos can be attached to this lesson and
          each one attaches automatically when finished.
        </p>
        <div className="mt-6">
          <MultiVideoUploader lessonId={lesson.id} accept="video/*" />
        </div>
      </section>

      <LessonMaterials lessonId={lesson.id} />
    </div>
  );
}
