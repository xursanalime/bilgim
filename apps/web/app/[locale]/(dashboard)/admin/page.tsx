import { unstable_setRequestLocale } from 'next-intl/server';

import { requireRole } from '../../../../lib/server-auth';
import { AdminKpis } from '../../../../components/admin/admin-kpis';
import { AdminActivity } from '../../../../components/admin/admin-activity';

interface AdminDashboardPageProps {
  params: { locale: string };
}

/**
 * Admin dashboard overview (task 13.1, Req 17.1).
 *
 * Server component: enforces ADMIN access with `requireRole(['ADMIN'], locale)`
 * (defense-in-depth alongside the admin layout guard), then renders the KPI
 * stat cards and the recent-activity feed. The management tables live in
 * separate routes (task 13.2) and are intentionally out of scope here.
 */
export default function AdminDashboardPage({
  params: { locale },
}: AdminDashboardPageProps) {
  unstable_setRequestLocale(locale);
  requireRole(['ADMIN'], locale);

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-3xl font-black tracking-tight text-ink-strong">
          Boshqaruv paneli
        </h1>
        <p className="mt-1.5 text-ink-soft">
          Tizim ko'rsatkichlari va so'nggi harakatlar.
        </p>
      </header>

      <AdminKpis />

      <AdminActivity />
    </div>
  );
}
