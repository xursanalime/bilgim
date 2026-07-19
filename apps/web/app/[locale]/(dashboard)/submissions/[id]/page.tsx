import { unstable_setRequestLocale } from 'next-intl/server';

import { SubmissionEditor } from '../../../../../components/homework/submission-editor';
import { requireAuth } from '../../../../../lib/auth-server';

interface SubmissionEditorPageProps {
  params: { locale: string; id: string };
}

/**
 * Submission editor route — `/[locale]/submissions/:id`.
 *
 * The API enforces ownership (the calling student must own the row) /
 * lesson teacher / admin gating server-side via the same guards used
 * by `/v1/submissions/:id` and `/v1/submissions/:id/submit`. The page
 * itself is reachable for STUDENT, TEACHER and ADMIN; per-role
 * affordances live in the client component (writing autosave, submit
 * button only when DRAFT/RETURNED, etc.).
 */
export default function SubmissionEditorPage({
  params: { locale, id },
}: SubmissionEditorPageProps) {
  unstable_setRequestLocale(locale);
  requireAuth({ locale });

  return <SubmissionEditor locale={locale} submissionId={id} />;
}
