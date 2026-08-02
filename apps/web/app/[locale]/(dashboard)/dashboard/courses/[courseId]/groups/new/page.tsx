import Link from 'next/link';
import { notFound } from 'next/navigation';
import { unstable_setRequestLocale } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';

import { requireRole } from '../../../../../../../../lib/server-auth';
import {
  serverApi,
  ServerApiError,
} from '../../../../../../../../lib/server-api';
import type { Course } from '../../../../../../../../lib/api/catalog';
import { GroupForm } from '../../../../../../../../components/dashboard/group-form';

interface PageProps {
  params: { locale: string; courseId: string };
}

export default async function NewGroupPage({
  params: { locale, courseId },
}: PageProps) {
  unstable_setRequestLocale(locale);
  requireRole(['TEACHER', 'ADMIN'], locale);

  // Confirm the course exists + belongs to the teacher before showing the form.
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
        className="inline-flex items-center gap-1 text-sm font-medium text-ink-soft hover:text-ink-strong"
      >
        <ArrowLeft className="h-4 w-4" />
        {course.title}
      </Link>

      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink-strong">
          Yangi guruh
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          Bu guruh <span className="font-semibold text-ink-strong">{course.title}</span> kursi
          ichida yaratiladi.
        </p>
      </div>

      <GroupForm locale={locale} mode="create" courseId={courseId} />
    </div>
  );
}
