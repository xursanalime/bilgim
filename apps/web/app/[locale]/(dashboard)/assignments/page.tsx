import { redirect } from 'next/navigation';

interface AssignmentsPageProps {
  params: { locale: string };
}

/**
 * Legacy alias for `/[locale]/homework`.
 *
 * `/assignments` and `/homework` had grown into two parallel homework lists
 * with separate components. `/homework` is the canonical one: it is what the
 * sidebar links to, it is role-aware, and it is backed by the single-query
 * `GET /homework/my-assignments`. This route stays only so older links and
 * bookmarks keep working.
 */
export default function AssignmentsRedirect({
  params: { locale },
}: AssignmentsPageProps) {
  redirect(`/${locale}/homework`);
}
