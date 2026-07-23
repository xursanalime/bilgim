'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';

import { teacherApi } from '../../lib/api/teacher';
import { ApiClientError } from '../../lib/api-client';
import { cn } from '../../lib/utils';

interface OnboardingWizardProps {
  locale: string;
}

/**
 * Multi-step onboarding quiz.
 *
 * Flow:
 *  1. Fetch quiz questions from `/teacher/onboarding/questions`.
 *  2. Walk through one question per step; selecting an option auto-advances.
 *  3. On the final question, "Yakunlash" submits all answers via
 *     `/teacher/onboarding/answers` and redirects to the returned dashboard
 *     URL (specialty-specific path).
 *
 * The quiz state lives entirely in the component — there's no autosave (the
 * server only knows the final, validated answer set). Going back to a
 * previous question keeps the previously selected option highlighted.
 */
export function OnboardingWizard({ locale }: OnboardingWizardProps) {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const questionsQuery = useQuery({
    queryKey: ['onboarding-questions'],
    queryFn: () => teacherApi.getOnboardingQuestions(),
  });

  const submitMutation = useMutation({
    mutationFn: (
      payload: Array<{ questionId: string; selectedOptionId: string }>,
    ) => teacherApi.submitOnboardingAnswers({ answers: payload }),
    onSuccess: (result) => {
      // The API returns an internal path like `/dashboard/english`. We turn
      // it into the locale-prefixed marketing URL before redirecting; the
      // generic `/dashboard` is good enough until per-specialty pages
      // exist.
      router.push(`/${locale}/dashboard`);
      router.refresh();
      // Keep `result` for any future side effects (analytics, toast).
      void result;
    },
    onError: (err: unknown) => {
      if (err instanceof ApiClientError) {
        setServerError(err.message);
      } else {
        setServerError('Server bilan aloqa xatosi. Qayta urinib ko\u2018ring.');
      }
    },
  });

  const questions = questionsQuery.data ?? [];
  
  // After the first question (subject selection), determine which specialty
  // was chosen by matching the selected option's slug to specialty questions.
  // Bilgim is English-only — every onboarding question is universal
  // (specialtyId === null) and all option weights resolve to the single
  // "english" specialty. There is no per-subject branching anymore, so we
  // simply present every active question in order.
  const filteredQuestions = useMemo(
    () => questions.filter((q) => q.specialtyId === null),
    [questions],
  );

  const totalSteps = filteredQuestions.length;
  const currentQuestion = filteredQuestions[currentStep];
  const progress = totalSteps > 0 ? ((currentStep + 1) / totalSteps) * 100 : 0;

  const allAnswered = useMemo(
    () => filteredQuestions.length > 0 && filteredQuestions.every((q) => answers[q.id]),
    [filteredQuestions, answers],
  );

  function selectOption(questionId: string, optionId: string) {
    setAnswers((prev) => ({ ...prev, [questionId]: optionId }));
    setServerError(null);
    // Auto-advance to the next unanswered question for a "lean back" feel,
    // but stop at the final step so the user can review before submitting.
    if (currentStep < totalSteps - 1) {
      // Slight defer so the radio's selected animation can play.
      window.setTimeout(() => setCurrentStep((s) => s + 1), 220);
    }
  }

  function goBack() {
    setCurrentStep((s) => Math.max(0, s - 1));
  }

  function goNext() {
    if (currentQuestion && !answers[currentQuestion.id]) return;
    setCurrentStep((s) => Math.min(totalSteps - 1, s + 1));
  }

  function submit() {
    if (!allAnswered) return;
    setServerError(null);
    const payload = filteredQuestions.map((q) => ({
      questionId: q.id,
      selectedOptionId: answers[q.id]!,
    }));
    submitMutation.mutate(payload);
  }

  // ── Loading & error states ────────────────────────────────────────────

  if (questionsQuery.isLoading) {
    return (
      <div className="rounded-2xl border border-ink-line bg-ink-surface p-10 text-center">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-accent2-500" />
        <p className="mt-3 text-sm text-cream-dim">Savollar yuklanmoqda...</p>
      </div>
    );
  }

  if (questionsQuery.isError || totalSteps === 0) {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-300">
        Savollarni yuklab bo&apos;lmadi. Sahifani yangilab qayta urinib
        ko&apos;ring.
      </div>
    );
  }

  // ── Quiz UI ──────────────────────────────────────────────────────────

  if (!currentQuestion) return null;

  const selectedOptionId = answers[currentQuestion.id];

  return (
    <div className="space-y-6">
      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.12em] text-cream-dim">
          <span>
            {currentStep + 1} / {totalSteps}
          </span>
          <span>{Math.round(progress)}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="h-full rounded-full bg-accent2-500 transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Question card */}
      <div className="rounded-2xl border border-ink-line bg-ink-surface p-6 sm:p-8">
        <h2 className="text-xl font-bold text-cream">{currentQuestion.text}</h2>
        <div className="mt-6 space-y-3">
          {currentQuestion.options.map((option) => {
            const selected = selectedOptionId === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => selectOption(currentQuestion.id, option.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-2xl border p-4 text-left text-sm transition-colors',
                  selected
                    ? 'border-accent2-500 bg-accent2-500/10 text-cream'
                    : 'border-ink-line bg-white/[0.02] text-cream-dim hover:border-accent2-500/40 hover:bg-white/[0.04] hover:text-cream',
                )}
              >
                <span
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                    selected
                      ? 'border-accent2-500 bg-accent2-500'
                      : 'border-cream-dim/40',
                  )}
                >
                  {selected && (
                    <span className="h-2 w-2 rounded-full bg-ink" />
                  )}
                </span>
                <span className="font-medium">{option.text}</span>
              </button>
            );
          })}
        </div>
      </div>

      {serverError && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          {serverError}
        </div>
      )}

      {/* Footer nav */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={goBack}
          disabled={currentStep === 0}
          className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-cream-dim transition-colors hover:bg-white/[0.04] hover:text-cream disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ArrowLeft className="h-4 w-4" />
          Orqaga
        </button>

        {currentStep < totalSteps - 1 ? (
          <button
            type="button"
            onClick={goNext}
            disabled={!selectedOptionId}
            className="inline-flex items-center gap-1.5 rounded-2xl bg-blue px-5 py-2.5 text-sm font-bold text-white shadow-blue-soft transition-colors hover:bg-blue-600 disabled:bg-blue-300 disabled:opacity-60"
          >
            Keyingisi
            <ArrowRight className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={!allAnswered || submitMutation.isPending}
            className="inline-flex items-center gap-2 rounded-2xl bg-accent2-500 px-5 py-2.5 text-sm font-bold text-ink shadow-[0_8px_24px_-8px_rgba(0,232,122,0.6)] transition-colors hover:bg-accent2-400 disabled:bg-accent2-700 disabled:opacity-60"
          >
            {submitMutation.isPending && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            Yakunlash
          </button>
        )}
      </div>
    </div>
  );
}
