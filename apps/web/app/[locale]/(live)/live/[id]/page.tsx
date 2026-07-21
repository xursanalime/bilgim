import { unstable_setRequestLocale } from 'next-intl/server';
import { LiveSessionJoin } from '../../../../../components/live/live-session-join';
import { requireAuth } from '../../../../../lib/auth-server';

interface LivePageProps {
  params: { locale: string; id: string };
  searchParams: { groupId?: string; courseId?: string };
}

export default function LiveSessionPage({ params: { locale, id }, searchParams }: LivePageProps) {
  unstable_setRequestLocale(locale);
  requireAuth({ locale });
  return (
    <LiveSessionJoin
      locale={locale}
      lessonId={id}
      groupId={searchParams.groupId}
      courseId={searchParams.courseId}
    />
  );
}
