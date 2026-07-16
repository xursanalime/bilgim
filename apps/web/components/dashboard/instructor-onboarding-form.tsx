'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { Check, GraduationCap, Sparkles } from 'lucide-react';

import {
  teacherApi,
  CEFR_LEVELS,
  type CefrLevel,
} from '../../lib/api/teacher';
import { ApiClientError } from '../../lib/api-client';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Card } from '../ui/card';

interface InstructorOnboardingFormProps {
  locale: string;
}

/**
 * English-focused instructor onboarding (Req 16.2).
 *
 * Bilgim is an English-only platform, so there is no generic specialty quiz.
 * The instructor declares:
 *   1. The CEFR levels (A1–C2) they teach — multi-select.
 *   2. Their exam-track focus (e.g. IELTS) — optional multi-select.
 *
 * Submitting calls `POST /teacher/onboarding/complete`; on success we route to
 * the dashboard URL the API returns (always `/dashboard`). The 14-day trial is
 * provisioned server-side at email verification and is untouched here — we only
 * surface a reminder that it is active.
 */
export function InstructorOnboardingForm({
  locale,
}: InstructorOnboardingFormProps) {
  const router = useRouter();
  const [taughtCefrLevels, setTaughtCefrLevels] = useState<CefrLevel[]>([]);
  const [examTrackFocus, setExamTrackFocus] = useState<string[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);

  const submitMutation = useMutation({
    mutationFn: () =>
      teacherApi.completeOnboarding({ taughtCefrLevels, examTrackFocus }),
    onSuccess: (result) => {
      // The API returns an internal path (always `/dashboard`). Route to the
      // locale-prefixed version so the i18n routing stays consistent.
      const target = result.dashboardUrl.startsWith('/')
        ? `/${locale}${result.dashboardUrl}`
        : `/${locale}/dashboard`;
      router.push(target);
      router.refresh();
    },
    onError: (err: unknown) => {
      if (err instanceof ApiClientError) {
        setServerError(err.message);
      } else {
        setServerError('Server bilan aloqa xatosi. Qayta urinib ko\u2018ring.');
      }
    },
  });

  const canSubmit = useMemo(
    () => taughtCefrLevels.length > 0 && !submitMutation.isPending,
    [taughtCefrLevels.length, submitMutation.isPending],
  );

  function toggleLevel(level: CefrLevel) {
    setServerError(null);
    setTaughtCefrLevels((prev) =>
      prev.includes(level)
        ? prev.filter((l) => l !== level)
        : [...prev, level],
    );
  }

  function toggleTrack(slug: string) {
    setServerError(null);
    setExamTrackFocus((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug],
    );
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (taughtCefrLevels.length === 0) {
      setServerError(
        'Kamida bitta CEFR darajasini tanlang, keyin davom eting.',
      );
      return;
    }
    setServerError(null);
    submitMutation.mutate();
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-2xl space-y-8">
      {/* Header */}
      <div className="space-y-2 text-center">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-tint text-blue">
          <GraduationCap className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1 className="text-2xl font-black tracking-tight text-ink-strong sm:text-3xl">
          Ingliz tili o&apos;qituvchisi profili
        </h1>
        <p className="text-ink-soft">
          Qaysi darajalarni va imtihon yo&apos;nalishlarini o&apos;qitishingizni
          tanlang. Bu talabalarga sizni topishda yordam beradi.
        </p>
      </div>

      {/* Trial reminder (trial is created server-side at verification) */}
      <div className="flex items-center justify-center gap-2 rounded-2xl bg-green-tint px-4 py-2.5 text-sm font-semibold text-green">
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        14 kunlik bepul sinov faol · Karta talab qilinmaydi
      </div>

      {/* CEFR levels */}
      <Card padding="lg" className="space-y-4">
        <fieldset className="space-y-4">
          <legend className="space-y-1">
            <span className="block text-base font-bold text-ink-strong">
              O&apos;qitadigan CEFR darajalari
            </span>
            <span className="block text-sm text-ink-soft">
              Kamida bittasini tanlang. Bir nechtasini belgilashingiz mumkin.
            </span>
          </legend>

          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            {CEFR_LEVELS.map((level) => {
              const selected = taughtCefrLevels.includes(level);
              return (
                <label
                  key={level}
                  className={cn(
                    'relative flex cursor-pointer items-center justify-center rounded-2xl border px-3 py-3 text-sm font-bold transition-colors',
                    selected
                      ? 'border-blue bg-blue-tint text-blue'
                      : 'border-rim bg-canvas text-ink-soft hover:border-rim-2 hover:bg-tint',
                  )}
                >
                  <input
                    type="checkbox"
                    name="taughtCefrLevels"
                    value={level}
                    checked={selected}
                    onChange={() => toggleLevel(level)}
                    className="sr-only"
                  />
                  {selected && (
                    <Check
                      className="absolute right-1.5 top-1.5 h-3.5 w-3.5"
                      strokeWidth={3}
                      aria-hidden="true"
                    />
                  )}
                  {level}
                </label>
              );
            })}
          </div>
        </fieldset>
      </Card>

      {/* Exam-track focus */}
      <Card padding="lg" className="space-y-4">
        <fieldset className="space-y-4">
          <legend className="space-y-1">
            <span className="block text-base font-bold text-ink-strong">
              Imtihon yo&apos;nalishlari{' '}
              <span className="text-ink-soft">(ixtiyoriy)</span>
            </span>
            <span className="block text-sm text-ink-soft">
              Tayyorlaydigan imtihonlaringizni tanlang.
            </span>
          </legend>

          <div className="flex flex-wrap gap-2.5">
            {EXAM_TRACKS.map((track) => {
              const selected = examTrackFocus.includes(track.slug);
              return (
                <label
                  key={track.slug}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-colors',
                    selected
                      ? 'border-blue bg-blue-tint text-blue'
                      : 'border-rim bg-canvas text-ink-soft hover:border-rim-2 hover:bg-tint',
                  )}
                >
                  <input
                    type="checkbox"
                    name="examTrackFocus"
                    value={track.slug}
                    checked={selected}
                    onChange={() => toggleTrack(track.slug)}
                    className="sr-only"
                  />
                  {selected && (
                    <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
                  )}
                  {track.label}
                </label>
              );
            })}
          </div>
        </fieldset>
      </Card>

      {serverError && (
        <div
          role="alert"
          className="rounded-2xl border border-red/30 bg-red-tint px-4 py-3 text-sm font-medium text-red"
        >
          {serverError}
        </div>
      )}

      <div className="flex flex-col items-center gap-3">
        <Button
          type="submit"
          size="lg"
          fullWidth
          loading={submitMutation.isPending}
          disabled={!canSubmit}
        >
          Boshlash
        </Button>
        <p className="text-center text-xs text-ink-soft">
          Keyinroq sozlamalardan bu ma&apos;lumotlarni o&apos;zgartirishingiz
          mumkin.
        </p>
      </div>
    </form>
  );
}

/**
 * Common English exam-track options. Each `slug` must match an active row in
 * the admin-managed `ExamTrack` catalog for server-side validation to accept
 * it; otherwise the submission is rejected with a clear error. There is no
 * public/teacher endpoint to fetch the live catalog yet (see cross-cutting
 * note in the task report), so these are a curated default set.
 */
const EXAM_TRACKS: ReadonlyArray<{ slug: string; label: string }> = [
  { slug: 'ielts', label: 'IELTS' },
  { slug: 'toefl', label: 'TOEFL' },
  { slug: 'general-english', label: 'General English' },
  { slug: 'cambridge', label: 'Cambridge' },
  { slug: 'pte', label: 'PTE' },
  { slug: 'business-english', label: 'Business English' },
];
