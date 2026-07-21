import { unstable_setRequestLocale } from 'next-intl/server';
import { requireAuth } from '../../../../../lib/auth-server';
import { ProfileSettings } from '../../../../../components/settings/profile-settings';

interface SettingsProfilePageProps {
  params: { locale: string };
}

export default function SettingsProfilePage({
  params: { locale },
}: SettingsProfilePageProps) {
  unstable_setRequestLocale(locale);
  const user = requireAuth({ locale });
  return <ProfileSettings email={user.email} role={user.role} />;
}
