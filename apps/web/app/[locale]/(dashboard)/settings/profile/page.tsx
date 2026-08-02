import { unstable_setRequestLocale } from 'next-intl/server';
import { requireAuth } from '../../../../../lib/auth-server';
import { ProfileSettings } from '../../../../../components/settings/profile-settings';
import { TeacherPublicProfile } from '../../../../../components/settings/teacher-public-profile';

interface SettingsProfilePageProps {
  params: { locale: string };
}

export default function SettingsProfilePage({
  params: { locale },
}: SettingsProfilePageProps) {
  unstable_setRequestLocale(locale);
  const user = requireAuth({ locale });
  return (
    <div className="space-y-6 sm:space-y-8">
      <ProfileSettings email={user.email} role={user.role} />
      {user.role === 'TEACHER' && <TeacherPublicProfile locale={locale} />}
    </div>
  );
}
