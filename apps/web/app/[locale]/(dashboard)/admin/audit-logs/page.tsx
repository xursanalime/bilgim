import { unstable_setRequestLocale } from 'next-intl/server';

import { requireRole } from '../../../../../lib/server-auth';
import { AuditLogTable } from '../../../../../components/admin/tables/audit-log-table';

interface AdminAuditLogsPageProps {
  params: { locale: string };
}

/**
 * Admin audit log (task 13.2, Req 17.3/17.4).
 *
 * Server component: enforces ADMIN access, then renders the read-only
 * `AuditLogTable` (sort / filter / paginate). Reflects that administrative
 * changes are audit-logged (Req 17.4).
 */
export default function AdminAuditLogsPage({
  params: { locale },
}: AdminAuditLogsPageProps) {
  unstable_setRequestLocale(locale);
  requireRole(['ADMIN'], locale);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-black tracking-tight text-ink-strong">
          Audit loglar
        </h1>
        <p className="mt-1.5 text-ink-soft">
          Tizimdagi barcha ma&apos;muriy harakatlar xronologiyasi.
        </p>
      </header>

      <AuditLogTable />
    </div>
  );
}
