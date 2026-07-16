import { unstable_setRequestLocale } from 'next-intl/server';
import { LiveSessionJoin } from '../../../../../components/live/live-session-join';
import { requireAuth } from '../../../../../lib/auth-server';

interface LivePageProps {
  params: { locale: string; id: string };
}

export default function LiveSessionPage({ params: { locale, id } }: LivePageProps) {
  unstable_setRequestLocale(locale);
  requireAuth({ locale });
  return (
    <div data-content-protected="true">
      <LiveSessionJoin locale={locale} lessonId={id} />
    </div>
  );
}
