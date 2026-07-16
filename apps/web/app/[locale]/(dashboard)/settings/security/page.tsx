import { unstable_setRequestLocale } from 'next-intl/server';
import { requireAuth } from '../../../../../lib/auth-server';
import { SecuritySettings } from '../../../../../components/settings/security-settings';

interface SettingsSecurityPageProps {
  params: { locale: string };
}

export default function SettingsSecurityPage({
  params: { locale },
}: SettingsSecurityPageProps) {
  unstable_setRequestLocale(locale);
  const user = requireAuth({ locale });
  return <SecuritySettings locale={locale} role={user.role} />;
}
