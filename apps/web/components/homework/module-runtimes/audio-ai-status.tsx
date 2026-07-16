'use client';

import { Loader2, Sparkles, CheckCircle2, AlertTriangle } from 'lucide-react';

import type { SubmissionStatus } from '../../../lib/api/homework';

/**
 * AudioAiStatus — surfaces the AI scoring lifecycle for a submitted audio
 * answer (frontend-redesign Req 10.4, Task 6.3).
 *
 * The backend scores SPEAKING / PRONUNCIATION audio asynchronously after a
 * submission is made and writes the outcome back onto the Submission
 * (`status`, `score`, `aiFlagged`, `aiLikelihood`). This component reads
 * those fields and reflects the current state:
 *
 *   • SUBMITTED / IN_REVIEW  → "AI baholamoqda…" (scoring in progress)
 *   • GRADED / RETURNED      → draft score + AI-likelihood flag when present
 *
 * Backend assumption: AI scoring populates `score` (0–maxPoints) and, when
 * the answer looks AI-generated, sets `aiFlagged=true` with `aiLikelihood`
 * in [0,1]. While DRAFT, nothing is shown (learner is still working).
 */

export interface AudioAiStatusProps {
  status: SubmissionStatus;
  aiFlagged: boolean;
  aiLikelihood: number | null;
  score: number | null;
  maxPoints?: number | undefined;
}

export function AudioAiStatus({
  status,
  aiFlagged,
  aiLikelihood,
  score,
  maxPoints,
}: AudioAiStatusProps) {
  // Still editable / not yet submitted — nothing to score.
  if (status === 'DRAFT') return null;

  const pending = status === 'SUBMITTED' || status === 'IN_REVIEW';
  const likelihoodPct =
    aiLikelihood !== null ? Math.round(aiLikelihood * 100) : null;

  if (pending) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-accent2-500/25 bg-accent2-500/10 px-4 py-3">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent2-500" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-cream">AI baholamoqda…</p>
          <p className="text-xs text-cream-dim">
            Ovozli javobingiz tahlil qilinmoqda. Natija tez orada paydo
            boʻladi.
          </p>
        </div>
      </div>
    );
  }

  // GRADED / RETURNED — show the resolved score and any AI-likelihood flag.
  return (
    <div className="space-y-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3">
      <div className="flex items-center gap-2">
        {score !== null ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-green" />
        ) : (
          <Sparkles className="h-4 w-4 shrink-0 text-accent2-500" />
        )}
        <p className="text-sm font-semibold text-cream">
          {score !== null
            ? `Baho: ${score}${maxPoints ? ` / ${maxPoints}` : ''}`
            : 'AI tahlili yakunlandi'}
        </p>
      </div>

      {aiFlagged ? (
        <div className="flex items-start gap-2 text-xs text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            AI yordamida yaratilgan boʻlishi mumkin
            {likelihoodPct !== null ? ` (~${likelihoodPct}% ehtimol)` : ''}.
            Oʻqituvchi yakuniy bahoni qoʻyadi.
          </span>
        </div>
      ) : null}
    </div>
  );
}
