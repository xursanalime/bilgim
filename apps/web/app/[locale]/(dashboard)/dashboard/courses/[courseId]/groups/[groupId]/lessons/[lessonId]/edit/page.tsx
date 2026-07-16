import Link from 'next/link';
import { notFound } from 'next/navigation';
import { unstable_setRequestLocale } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';

import { requireRole } from '../../../../../../../../../../../lib/server-auth';
import {
  serverApi,
  ServerApiError,
} from '../../../../../../../../../../../lib/server-api';
import type { Lesson } from '../../../../../../../../../../../lib/api/catalog';
import { LessonForm } from '../../../../../../../../../../../components/teacher/lesson-form';
import { LessonDeleteButton } from '../../../../../../../../../../../components/dashboard/lesson-delete-button';

interface PageProps {
  params: {
    locale: string;
    courseId: string;
    groupId: string;
    lessonId: string;
  };
}

export default async function EditLessonPage({
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
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href={`/${locale}/dashboard/courses/${courseId}/groups/${groupId}/lessons/${lessonId}`}
        className="inline-flex items-center gap-1 text-sm font-medium text-cream-dim hover:text-cream"
      >
        <ArrowLeft className="h-4 w-4" />
        {lesson.title}
      </Link>

      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-cream">
          Darsni tahrirlash
        </h1>
        <p className="mt-1 text-sm text-cream-dim">
          Dars ma&apos;lumotlarini yangilang. Holat (status) o&apos;zgartirilmaydi.
        </p>
      </div>

      <LessonForm
        locale={locale}
        mode="edit"
        courseId={courseId}
        groupId={groupId}
        initialData={{
          id: lesson.id,
          title: lesson.title,
          description: lesson.description,
          type: lesson.type,
          position: lesson.position,
          scheduledAt: lesson.scheduledAt,
        }}
      />

      <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-5">
        <h3 className="font-semibold text-red-300">Xavfli zona</h3>
        <p className="mt-1 text-xs text-cream-dim">
          Darsni o&apos;chirish ortga qaytarib bo&apos;lmaydi.
        </p>
        <LessonDeleteButton
          lessonId={lesson.id}
          locale={locale}
          courseId={courseId}
          groupId={groupId}
        />
      </div>
    </div>
  );
}
