import { unstable_setRequestLocale } from 'next-intl/server';

import { BillingSettings } from '../../../../../components/settings/billing-settings';
import { requireAuth } from '../../../../../lib/auth-server';

interface SettingsBillingPageProps {
  params: { locale: string };
}

/**
 * `/[locale]/settings/billing` — invoice history. `BillingController` only
 * accepts STUDENT/TEACHER (Requirement per billing.controller.ts), so ADMIN
 * is redirected away here instead of landing on a guaranteed 403 error card.
 */
export default function SettingsBillingPage({
  params: { locale },
}: SettingsBillingPageProps) {
  unstable_setRequestLocale(locale);
  requireAuth({ locale, roles: ['STUDENT', 'TEACHER'] });
  return <BillingSettings />;
}
