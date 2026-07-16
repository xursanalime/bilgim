import { unstable_setRequestLocale } from 'next-intl/server';

import { requireRole } from '../../../../../lib/server-auth';
import { EnglishModulesTable } from '../../../../../components/admin/tables/english-modules-table';
import { ExamTracksTable } from '../../../../../components/admin/tables/exam-tracks-table';

interface AdminEnglishCatalogPageProps {
  params: { locale: string };
}

/**
 * Admin English module catalog + Exam_Track management (task 13.2,
 * Req 17.2/17.3).
 *
 * Server component: enforces ADMIN access, then renders the fixed eight
 * English skills catalog (enable/disable, confirm-destructive) and the
 * Exam_Track CRUD table (delete confirmed). Bilgim is English-only, so this
 * replaces the legacy specialty catalog.
 */
export default function AdminEnglishCatalogPage({
  params: { locale },
}: AdminEnglishCatalogPageProps) {
  unstable_setRequestLocale(locale);
  requireRole(['ADMIN'], locale);

  return (
    <div className="space-y-12">
      <header>
        <h1 className="text-3xl font-black tracking-tight text-ink-strong">
          Ingliz tili moduli
        </h1>
        <p className="mt-1.5 text-ink-soft">
          Sakkizta ingliz tili skill moduli va Exam_Track yo&apos;nalishlarini
          boshqarish.
        </p>
      </header>

      <section className="space-y-4">
        <h2 className="text-lg font-bold text-ink-strong">Modul katalogi</h2>
        <EnglishModulesTable />
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-bold text-ink-strong">Exam_Track yo&apos;nalishlari</h2>
        <ExamTracksTable />
      </section>
    </div>
  );
}
