import { unstable_setRequestLocale } from 'next-intl/server';
import { requireAuth } from '../../../../lib/auth-server';
import { AchievementsDashboard } from '../../../../components/gamification/achievements-dashboard';
import { GamificationOnboarding } from '../../../../components/gamification/gamification-onboarding';

export default async function AchievementsPage({
  params: { locale },
}: {
  params: { locale: string };
}) {
  unstable_setRequestLocale(locale);
  // Gamification is disabled for teachers.
  const user = requireAuth({ locale, roles: ['STUDENT', 'ADMIN'] });

  return (
    <>
      <GamificationOnboarding />
      <AchievementsDashboard locale={locale} role={user.role as 'STUDENT' | 'TEACHER'} />
    </>
  );
}
