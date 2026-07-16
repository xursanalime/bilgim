import { unstable_setRequestLocale } from 'next-intl/server';

import { ChannelPreferences } from '../../../../../components/settings/channel-preferences';
import { NotificationPreferences } from '../../../../../components/notifications/notification-preferences';
import { requireAuth } from '../../../../../lib/auth-server';

interface SettingsNotificationsPageProps {
  params: { locale: string };
}

/**
 * `/[locale]/settings/notifications` — preferences page (Task 25.6 /
 * Task 10.2). Shows channel-level master toggles (in-app / email /
 * Telegram) above the detailed per-kind × channel matrix.
 *
 * Per the API contract, only STUDENT and TEACHER can edit preferences;
 * ADMIN preferences are managed at the platform level.
 */
export default function SettingsNotificationsPage({
  params: { locale },
}: SettingsNotificationsPageProps) {
  unstable_setRequestLocale(locale);
  requireAuth({ locale, roles: ['STUDENT', 'TEACHER'] });
  return (
    <div className="mx-auto max-w-4xl space-y-10 pb-12">
      <ChannelPreferences />
      <NotificationPreferences />
    </div>
  );
}
