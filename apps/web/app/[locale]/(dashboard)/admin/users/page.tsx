import { unstable_setRequestLocale } from 'next-intl/server';

import { requireRole } from '../../../../../lib/server-auth';
import { UsersTable } from '../../../../../components/admin/tables/users-table';

interface AdminUsersPageProps {
  params: { locale: string };
}

/**
 * Admin users management (task 13.2, Req 17.2/17.3).
 *
 * Server component: enforces ADMIN access with `requireRole(['ADMIN'], locale)`
 * (defense-in-depth alongside the admin layout guard), then renders the
 * client-side `UsersTable` (sort / filter / paginate + confirm-destructive).
 */
export default function AdminUsersPage({
  params: { locale },
}: AdminUsersPageProps) {
  unstable_setRequestLocale(locale);
  requireRole(['ADMIN'], locale);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-black tracking-tight text-ink-strong">
          Foydalanuvchilar
        </h1>
        <p className="mt-1.5 text-ink-soft">
          Tizimdagi barcha talaba va o&apos;qituvchilarni boshqarish.
        </p>
      </header>

      <UsersTable />
    </div>
  );
}
