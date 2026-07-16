import { unstable_setRequestLocale } from 'next-intl/server';

import { requireRole } from '../../../../../../lib/server-auth';
import { CmsPagesTable } from '../../../../../../components/admin/tables/cms-pages-table';

interface AdminCmsPagesPageProps {
  params: { locale: string };
}

/**
 * Admin CMS pages management table (task 13.2, Req 17.2/17.3).
 *
 * Server component: enforces ADMIN access, then renders the `CmsPagesTable`
 * (sort / filter / paginate + confirm-destructive delete). Backed by assumed
 * endpoints (see `lib/api/admin.ts`); degrades to an empty state until they
 * land. The marketing content editor remains on `/admin/cms`.
 */
export default function AdminCmsPagesPage({
  params: { locale },
}: AdminCmsPagesPageProps) {
  unstable_setRequestLocale(locale);
  requireRole(['ADMIN'], locale);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-black tracking-tight text-ink-strong">
          CMS sahifalari
        </h1>
        <p className="mt-1.5 text-ink-soft">
          Sayt sahifalarini ko&apos;rish va boshqarish.
        </p>
      </header>

      <CmsPagesTable />
    </div>
  );
}
