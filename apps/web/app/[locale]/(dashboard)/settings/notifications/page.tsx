import { unstable_setRequestLocale } from 'next-intl/server';

import { NotificationPreferences } from '../../../../../components/notifications/notification-preferences';
import { requireAuth } from '../../../../../lib/auth-server';

interface SettingsNotificationsPageProps {
  params: { locale: string };
}

/**
 * `/[locale]/settings/notifications` — preferences page (Task 25.6).
 *
 * Per the API contract, only STUDENT and TEACHER can edit preferences;
 * ADMIN preferences are managed at the platform level.
 */
export default function SettingsNotificationsPage({
  params: { locale },
}: SettingsNotificationsPageProps) {
  unstable_setRequestLocale(locale);
  requireAuth({ locale, roles: ['STUDENT', 'TEACHER'] });
  return <NotificationPreferences />;
}
