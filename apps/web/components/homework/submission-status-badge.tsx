import type { SubmissionStatus } from '../../lib/api/homework';

/**
 * Compact pill showing a Submission's lifecycle status (Req 12.7).
 * The wording is the Uzbek-language label seen across the homework UI.
 */
const STATUS_COPY: Record<
  SubmissionStatus,
  { label: string; tone: 'neutral' | 'pending' | 'success' | 'attention' }
> = {
  DRAFT: { label: 'Qoralama', tone: 'neutral' },
  SUBMITTED: { label: 'Yuborildi', tone: 'pending' },
  IN_REVIEW: { label: 'Tekshirilmoqda', tone: 'pending' },
  GRADED: { label: 'Baholandi', tone: 'success' },
  RETURNED: { label: 'Qaytarildi', tone: 'attention' },
};

const TONE_CLASSES: Record<string, string> = {
  neutral: 'bg-white/[0.06] text-cream-dim',
  pending: 'bg-amber-500/15 text-amber-300',
  success: 'bg-accent2-500/15 text-accent2-500',
  attention: 'bg-rose-500/15 text-rose-300',
};

export function SubmissionStatusBadge({
  status,
}: {
  status: SubmissionStatus;
}) {
  const copy = STATUS_COPY[status];
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] ${TONE_CLASSES[copy.tone]}`}
    >
      {copy.label}
    </span>
  );
}

export const SUBMISSION_STATUS_LABELS: Record<SubmissionStatus, string> =
  Object.fromEntries(
    Object.entries(STATUS_COPY).map(([status, info]) => [status, info.label]),
  ) as Record<SubmissionStatus, string>;
