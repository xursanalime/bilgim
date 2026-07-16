import { unstable_setRequestLocale } from 'next-intl/server';

import { LessonPlayer } from '../../../../../components/lesson/lesson-player';
import { requireAuth } from '../../../../../lib/auth-server';

interface LessonPageProps {
  params: { locale: string; id: string };
}

export default function LessonPage({
  params: { locale, id },
}: LessonPageProps) {
  unstable_setRequestLocale(locale);
  // The API enforces the LessonAccessGuard (Req 6.1 – 6.6) on
  // `/catalog/lessons/:id`, so we only need a coarse "any authenticated
  // user" check here. STUDENT, TEACHER and ADMIN can all reach this UI.
  requireAuth({ locale });

  return (
    <div data-content-protected="true">
      <LessonPlayer locale={locale} lessonId={id} />
    </div>
  );
}
