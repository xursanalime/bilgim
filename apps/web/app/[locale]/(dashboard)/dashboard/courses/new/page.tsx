import Link from 'next/link';
import { unstable_setRequestLocale } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';

import { requireRole } from '../../../../../../lib/server-auth';
import { CourseForm } from '../../../../../../components/dashboard/course-form';

interface PageProps {
  params: { locale: string };
}

export default function NewCoursePage({ params: { locale } }: PageProps) {
  unstable_setRequestLocale(locale);
  requireRole(['TEACHER', 'ADMIN'], locale);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href={`/${locale}/dashboard/courses`}
        className="inline-flex items-center gap-1 text-sm font-medium text-ink-soft hover:text-ink-strong"
      >
        <ArrowLeft className="h-4 w-4" />
        Kurslar ro&apos;yxatiga qaytish
      </Link>

      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink-strong">
          Yangi kurs
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          Kurs ma&apos;lumotlarini kiriting. Keyin guruhlar va darslar
          qo&apos;shasiz.
        </p>
      </div>

      <CourseForm locale={locale} mode="create" />
    </div>
  );
}
