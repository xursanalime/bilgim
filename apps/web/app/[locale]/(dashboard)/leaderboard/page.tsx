import { unstable_setRequestLocale } from 'next-intl/server';
import { requireAuth } from '../../../../lib/auth-server';
import { LeaderboardDashboard } from '../../../../components/gamification/leaderboard-dashboard';

export default async function LeaderboardPage({
  params: { locale },
}: {
  params: { locale: string };
}) {
  unstable_setRequestLocale(locale);
  const user = requireAuth({ locale });

  return <LeaderboardDashboard locale={locale} userId={user.sub} />;
}
