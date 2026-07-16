import { unstable_setRequestLocale } from 'next-intl/server';
import { requireAuth } from '../../../../../lib/auth-server';
import { ProfileSettings } from '../../../../../components/settings/profile-settings';
import { LocaleSwitcher } from '../../../../../components/settings/locale-switcher';

interface SettingsProfilePageProps {
  params: { locale: string };
}

export default function SettingsProfilePage({
  params: { locale },
}: SettingsProfilePageProps) {
  unstable_setRequestLocale(locale);
  const user = requireAuth({ locale });
  return (
    <div className="space-y-6">
      <ProfileSettings email={user.email} role={user.role} />
      <LocaleSwitcher />
    </div>
  );
}
