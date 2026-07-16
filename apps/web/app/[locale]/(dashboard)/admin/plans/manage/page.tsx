import { unstable_setRequestLocale } from 'next-intl/server';

import { requireRole } from '../../../../../../lib/server-auth';
import { PlansTable } from '../../../../../../components/admin/tables/plans-table';

interface AdminPlansManagePageProps {
  params: { locale: string };
}

/**
 * Admin plans management table (task 13.2, Req 17.2/17.3).
 *
 * Server component: enforces ADMIN access, then renders the `PlansTable`
 * (sort / filter / paginate + confirm-destructive deactivate/delete). The
 * marketing pricing cards remain on `/admin/plans`.
 */
export default function AdminPlansManagePage({
  params: { locale },
}: AdminPlansManagePageProps) {
  unstable_setRequestLocale(locale);
  requireRole(['ADMIN'], locale);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-black tracking-tight text-ink-strong">
          Tariflarni boshqarish
        </h1>
        <p className="mt-1.5 text-ink-soft">
          Tarif rejalarini ko&apos;rish, faolsizlantirish va o&apos;chirish.
        </p>
      </header>

      <PlansTable />
    </div>
  );
}
