'use client';

import { useQueryClient, useMutation } from '@tanstack/react-query';
import { AlertTriangle, RotateCcw, Sparkles, Wand2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import { ApiClientError } from '../../lib/api-client';
import {
  homeworkApi,
  type AiGradePrecheckResult,
  type FeedbackEntry,
  type GradePayload,
  type Submission,
} from '../../lib/api/homework';
import { Button } from '../ui/button';
import { Textarea } from '../ui/input';
import { cn } from '../../lib/utils';
import { homeworkQueryKeys } from './grading-query-keys';

interface SubmissionGradingPanelProps {
  submission: Submission;
  assignmentId: string;
  totalPoints: number;
  /** Called after a successful grade or return so the parent can collapse. */
  onDone?: (() => void) | undefined;
}

/**
 * SubmissionGradingPanel — the per-submission adjust / finalize surface
 * used inside the teacher grading queue (frontend-redesign Task 6.4,
 * Req 10.5).
 *
 * Flow:
 *   1. Optionally fetch an AI-draft grade (`POST /ai/grade/precheck`)
 *      which seeds the score + feedback fields.
 *   2. The teacher adjusts the score / feedback.
 *   3. "Finalize" (`POST /submissions/:id/grade`) → GRADED.
 *      "Return to student" (`POST /submissions/:id/return`) → RETURNED.
 *
 * All mutations invalidate the assignment submission list so the queue
 * rows + status badges refresh.
 */
export function SubmissionGradingPanel({
  submission,
  assignmentId,
  totalPoints,
  onDone,
}: SubmissionGradingPanelProps) {
  const queryClient = useQueryClient();

  const [score, setScore] = useState<string>(
    submission.score !== null ? String(submission.score) : '',
  );
  const [feedback, setFeedback] = useState('');
  const [returnComment, setReturnComment] = useState('');
  const [aiDraft, setAiDraft] = useState<AiGradePrecheckResult | null>(null);

  const submissionText = useMemo(
    () => deriveSubmissionText(submission.answersJson),
    [submission.answersJson],
  );

  const canGrade =
    submission.status === 'SUBMITTED' || submission.status === 'IN_REVIEW';
  const canReturn =
    submission.status === 'IN_REVIEW' || submission.status === 'GRADED';

  const isScoreValid = useMemo(() => {
    if (score.trim() === '') return false;
    const n = Number(score);
    return Number.isInteger(n) && n >= 0 && n <= totalPoints;
  }, [score, totalPoints]);

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: homeworkQueryKeys.assignmentSubmissions(assignmentId),
    });
    void queryClient.invalidateQueries({
      queryKey: homeworkQueryKeys.submission(submission.id),
    });
  };

  const aiMutation = useMutation({
    mutationFn: () =>
      homeworkApi.gradePrecheck({
        submissionId: submission.id,
        text: submissionText,
      }),
    onSuccess: (result) => {
      setAiDraft(result);
      const suggested = Math.round(result.score * totalPoints);
      setScore(String(Math.min(totalPoints, Math.max(0, suggested))));
      if (!feedback.trim() && result.summary.trim()) {
        setFeedback(buildAiFeedback(result));
      }
      // The precheck moves SUBMITTED → IN_REVIEW server-side; refresh.
      invalidate();
    },
  });

  const gradeMutation = useMutation({
    mutationFn: () => {
      const payload: GradePayload = { score: Number(score) };
      const trimmed = feedback.trim();
      if (trimmed) {
        const entry: FeedbackEntry = { comment: trimmed };
        payload.feedback = [entry];
      }
      return homeworkApi.grade(submission.id, payload);
    },
    onSuccess: () => {
      invalidate();
      onDone?.();
    },
  });

  const returnMutation = useMutation({
    mutationFn: () => {
      const trimmed = returnComment.trim();
      return homeworkApi.returnToStudent(
        submission.id,
        trimmed ? { comment: trimmed } : {},
      );
    },
    onSuccess: () => {
      invalidate();
      onDone?.();
    },
  });

  const aiScorePreview =
    aiDraft !== null ? Math.round(aiDraft.score * totalPoints) : null;

  return (
    <div className="space-y-5 rounded-2xl border border-rim bg-tint/30 p-5">
      {/* ── AI draft ──────────────────────────────────────────── */}
      <section className="rounded-2xl border border-purple/20 bg-purple-tint/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple/10 text-purple">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-bold text-ink-strong">AI qoralama</p>
              <p className="text-[11px] text-ink-soft">
                AI taklif qilgan ball va izoh
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={aiMutation.isPending}
            disabled={!submissionText.trim() || aiMutation.isPending}
            leftIcon={<Wand2 className="h-3.5 w-3.5" />}
            onClick={() => aiMutation.mutate()}
          >
            {aiDraft ? 'Qayta baholash' : 'AI bilan baholash'}
          </Button>
        </div>

        {!submissionText.trim() ? (
          <p className="mt-3 text-xs text-ink-soft">
            Bu topshiriqda matnli javob yoʻq, shuning uchun AI qoralamasi
            mavjud emas.
          </p>
        ) : null}

        {aiMutation.isError ? (
          <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-red">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            {errorMessage(aiMutation.error, 'AI baholash amalga oshmadi.')}
          </p>
        ) : null}

        {aiDraft ? (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-rim bg-canvas p-3 text-center">
                <p className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                  AI ball
                </p>
                <p className="text-xl font-black text-ink-strong">
                  {aiScorePreview}
                  <span className="text-sm font-medium text-ink-faint">
                    /{totalPoints}
                  </span>
                </p>
              </div>
              <div className="rounded-xl border border-rim bg-canvas p-3 text-center">
                <p className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                  AI ehtimoli
                </p>
                <p
                  className={cn(
                    'text-xl font-black',
                    aiDraft.aiFlagged ? 'text-red' : 'text-green',
                  )}
                >
                  {Math.round(aiDraft.aiLikelihood * 100)}%
                </p>
              </div>
            </div>
            {aiDraft.summary ? (
              <p className="rounded-xl border border-rim bg-canvas p-3 text-xs leading-relaxed text-ink-soft">
                {aiDraft.summary}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* ── Adjust + finalize ─────────────────────────────────── */}
      <section className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[140px,1fr]">
          <div className="space-y-1.5">
            <label
              htmlFor={`score-${submission.id}`}
              className="text-[11px] font-bold uppercase tracking-wider text-ink-faint"
            >
              Ball (0-{totalPoints})
            </label>
            <input
              id={`score-${submission.id}`}
              type="number"
              inputMode="numeric"
              min={0}
              max={totalPoints}
              value={score}
              disabled={!canGrade}
              onChange={(e) => setScore(e.target.value)}
              placeholder={`0-${totalPoints}`}
              aria-invalid={score.trim() !== '' && !isScoreValid}
              className="w-full rounded-2xl border border-rim bg-tint px-4 py-3 text-base font-bold text-ink-strong outline-none transition-all focus:border-blue/60 focus:bg-canvas focus:ring-4 focus:ring-blue/10 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor={`feedback-${submission.id}`}
              className="text-[11px] font-bold uppercase tracking-wider text-ink-faint"
            >
              Izoh
            </label>
            <Textarea
              id={`feedback-${submission.id}`}
              rows={3}
              value={feedback}
              disabled={!canGrade}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Talabaga fikr-mulohaza..."
            />
          </div>
        </div>

        {gradeMutation.isError ? (
          <p className="flex items-center gap-1.5 text-xs font-medium text-red">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            {errorMessage(gradeMutation.error, 'Bahoni saqlab boʻlmadi.')}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="primary"
            loading={gradeMutation.isPending}
            disabled={!canGrade || !isScoreValid || gradeMutation.isPending}
            onClick={() => gradeMutation.mutate()}
          >
            Bahoni yakunlash
          </Button>
          {!canGrade ? (
            <span className="text-xs text-ink-soft">
              Faqat YUBORILGAN yoki TEKSHIRILMOQDA holatida baholash mumkin.
            </span>
          ) : null}
        </div>
      </section>

      {/* ── Return to student ─────────────────────────────────── */}
      <section className="space-y-3 border-t border-rim pt-4">
        <label
          htmlFor={`return-${submission.id}`}
          className="text-[11px] font-bold uppercase tracking-wider text-ink-faint"
        >
          Talabaga qaytarish
        </label>
        <Textarea
          id={`return-${submission.id}`}
          rows={2}
          value={returnComment}
          disabled={!canReturn}
          onChange={(e) => setReturnComment(e.target.value)}
          placeholder="Nimani tuzatish kerakligini yozing (ixtiyoriy)..."
        />
        {returnMutation.isError ? (
          <p className="flex items-center gap-1.5 text-xs font-medium text-red">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            {errorMessage(returnMutation.error, 'Talabaga qaytarib boʻlmadi.')}
          </p>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          loading={returnMutation.isPending}
          disabled={!canReturn || returnMutation.isPending}
          leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
          onClick={() => returnMutation.mutate()}
        >
          Talabaga qaytarish
        </Button>
      </section>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Flatten a submission's `answersJson` into a single plain-text blob the
 * AI grader can score. Handles the common answer shapes produced by the
 * skill module runtimes (raw strings, `{ text }`, `{ content }`, and
 * `{ responses: { id: { value } } }`).
 */
export function deriveSubmissionText(
  answersJson: Record<string, unknown> | null,
): string {
  if (!answersJson) return '';
  const parts: string[] = [];

  for (const value of Object.values(answersJson)) {
    parts.push(...extractStrings(value));
  }

  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join('\n\n');
}

function extractStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value === null || typeof value !== 'object') return [];

  const obj = value as Record<string, unknown>;
  const out: string[] = [];

  if (typeof obj.text === 'string') out.push(obj.text);
  if (typeof obj.content === 'string') out.push(obj.content);
  if (typeof obj.value === 'string') out.push(obj.value);

  if (obj.responses && typeof obj.responses === 'object') {
    for (const r of Object.values(obj.responses as Record<string, unknown>)) {
      out.push(...extractStrings(r));
    }
  }

  return out;
}

function buildAiFeedback(result: AiGradePrecheckResult): string {
  const lines = [result.summary.trim()];
  const notable = result.highlights.filter((h) => h.severity !== 'info');
  if (notable.length > 0) {
    lines.push('', 'Muhim nuqtalar:');
    for (const h of notable) lines.push(`• ${h.reason}`);
  }
  return lines.join('\n');
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback;
}
