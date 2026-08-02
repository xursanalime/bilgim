import { unstable_setRequestLocale } from 'next-intl/server';

import { AssignmentBuilder } from '../../../../../components/homework/assignment-builder';
import { requireAuth } from '../../../../../lib/auth-server';

interface NewHomeworkPageProps {
  params: { locale: string };
}

/**
 * `/[locale]/homework/new` — Teacher-only AssignmentBuilder
 * (Task 25.4, Req 11.5, 11.8).
 *
 * Renders the multi-step builder: Course → Group → Lesson → modules.
 * Available module types are read from the existing GroupModule toggle
 * endpoint so a teacher can only ship modules that are currently
 * enabled for the selected group (the API enforces the same constraint
 * server-side as a defence-in-depth check).
 */
export default function NewHomeworkPage({
  params: { locale },
}: NewHomeworkPageProps) {
  unstable_setRequestLocale(locale);
  requireAuth({ locale, roles: ['TEACHER', 'ADMIN'] });

  return <AssignmentBuilder locale={locale} />;
}
