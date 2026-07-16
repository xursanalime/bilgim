import Link from 'next/link';
import { unstable_setRequestLocale } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';

import { requireRole } from '../../../../../../lib/server-auth';
import { CourseForm } from '../../../../../../components/teacher/course-form';
import { CourseSetupGuide } from '../../../../../../components/dashboard/course-setup-guide';

interface PageProps {
  params: { locale: string };
}

export default function NewCoursePage({ params: { locale } }: PageProps) {
  unstable_setRequestLocale(locale);
  requireRole(['TEACHER', 'ADMIN'], locale);

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <Link
        href={`/${locale}/dashboard/courses`}
        className="inline-flex items-center gap-1 text-sm font-medium text-ink-soft hover:text-ink-strong"
      >
        <ArrowLeft className="h-4 w-4" />
        Kurslar ro&apos;yxatiga qaytish
      </Link>

      <CourseSetupGuide locale={locale} />

      <div className="mt-8 pt-8 border-t border-rim">
        <div className="mb-6">
          <h2 className="text-xl font-extrabold tracking-tight text-ink-strong">
            1-qadam: Asosiy ma'lumotlar
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            Kurs ma'lumotlarini kiriting va uni yarating.
          </p>
        </div>
        <CourseForm locale={locale} mode="create" />
      </div>
    </div>
  );
}
