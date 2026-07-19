import { unstable_setRequestLocale } from 'next-intl/server';
import { requireRole } from '../../../../lib/server-auth';
import { StudentList } from '../../../../components/dashboard/student-list';

interface PageProps {
  params: { locale: string };
}

export default function StudentsPage({ params: { locale } }: PageProps) {
  unstable_setRequestLocale(locale);
  requireRole(['TEACHER', 'ADMIN'], locale);

  return <StudentList locale={locale} />;
}
