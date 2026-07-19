import Link from 'next/link';
import { notFound } from 'next/navigation';
import { unstable_setRequestLocale } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';

import { requireRole } from '../../../../../../../lib/server-auth';
import {
  serverApi,
  ServerApiError,
} from '../../../../../../../lib/server-api';
import type { Course } from '../../../../../../../lib/api/catalog';
import { CourseForm } from '../../../../../../../components/dashboard/course-form';
import { CourseDeleteButton } from '../../../../../../../components/dashboard/course-delete-button';

interface PageProps {
  params: { locale: string; courseId: string };
}

export default async function EditCoursePage({
  params: { locale, courseId },
}: PageProps) {
  unstable_setRequestLocale(locale);
  requireRole(['TEACHER', 'ADMIN'], locale);

  let course: Course;
  try {
    course = await serverApi.get<Course>(`/catalog/courses/${courseId}`);
  } catch (err) {
    if (err instanceof ServerApiError && (err.statusCode === 404 || err.statusCode === 403)) {
      notFound();
    }
    throw err;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href={`/${locale}/dashboard/courses/${courseId}`}
        className="inline-flex items-center gap-1 text-sm font-medium text-cream-dim hover:text-cream"
      >
        <ArrowLeft className="h-4 w-4" />
        Kursga qaytish
      </Link>

      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-cream">
          Kursni tahrirlash
        </h1>
        <p className="mt-1 text-sm text-cream-dim">
          Kurs ma&apos;lumotlarini yangilang.
        </p>
      </div>

      <CourseForm
        locale={locale}
        mode="edit"
        initialData={{
          id: course.id,
          title: course.title,
          description: course.description,
          level: course.level,
          fromPriceUzs: course.fromPriceUzs,
        }}
      />

      <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-5">
        <h3 className="font-semibold text-red-300">Xavfli zona</h3>
        <p className="mt-1 text-xs text-cream-dim">
          Kursni o&apos;chirish ortga qaytarib bo&apos;lmaydi. Barcha guruhlar
          va darslar ham o&apos;chiriladi.
        </p>
        <CourseDeleteButton courseId={course.id} locale={locale} />
      </div>
    </div>
  );
}
