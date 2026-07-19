import { unstable_setRequestLocale } from 'next-intl/server';

import { NotificationInbox } from '../../../../components/notifications/notification-inbox';
import { requireAuth } from '../../../../lib/auth-server';

interface NotificationsPageProps {
  params: { locale: string };
}

/**
 * `/[locale]/notifications` — full inbox page (Task 25.6 / Req 16.1).
 *
 * Server-side `requireAuth` enforces "any authenticated user" — the
 * notification feed is per-user and the API scopes results to the
 * caller's `userId`.
 */
export default function NotificationsPage({
  params: { locale },
}: NotificationsPageProps) {
  unstable_setRequestLocale(locale);
  requireAuth({ locale });
  return <NotificationInbox locale={locale} />;
}
