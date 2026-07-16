import { unstable_setRequestLocale } from 'next-intl/server';
import { requireAuth } from '../../../../lib/auth-server';
import { RewardsDashboard } from '../../../../components/gamification/rewards-dashboard';

export default async function RewardsPage({
  params: { locale },
}: {
  params: { locale: string };
}) {
  unstable_setRequestLocale(locale);
  requireAuth({ locale });

  return <RewardsDashboard locale={locale} />;
}
