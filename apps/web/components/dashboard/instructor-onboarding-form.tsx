'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, GraduationCap, Globe, Sparkles } from 'lucide-react';

import {
  teacherApi,
  CEFR_LEVELS,
  ACCENT_COLORS,
  type CefrLevel,
  type AccentColor,
} from '../../lib/api/teacher';
import { ApiClientError } from '../../lib/api-client';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Card } from '../ui/card';

interface InstructorOnboardingFormProps {
  locale: string;
}

/** Lowercase, hyphenated, ASCII-only slug candidate from a display name. */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

/** First letters of up to two words — the monogram fallback avatar. */
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return (parts[0]!.charAt(0) || 'U').toUpperCase();
  return (
    (parts[0]!.charAt(0) || '') + (parts[parts.length - 1]!.charAt(0) || '')
  ).toUpperCase();
}

/** Static class strings (not template-built) so Tailwind's JIT scanner
 * picks them up. Each accent color's "tint" (background) + solid (text/ring)
 * pair, matching the design system's existing blue/green/purple/orange tokens. */
const ACCENT_STYLES: Record<AccentColor, { tint: string; solid: string; ring: string }> = {
  BLUE: { tint: 'bg-blue-tint', solid: 'text-blue', ring: 'ring-blue' },
  GREEN: { tint: 'bg-green-tint', solid: 'text-green', ring: 'ring-green' },
  PURPLE: { tint: 'bg-purple-tint', solid: 'text-purple', ring: 'ring-purple' },
  ORANGE: { tint: 'bg-orange-tint', solid: 'text-orange-600', ring: 'ring-orange' },
};

const ACCENT_LABELS: Record<AccentColor, string> = {
  BLUE: 'Ko‘k',
  GREEN: 'Yashil',
  PURPLE: 'Binafsha',
  ORANGE: 'Apelsin',
};

/**
 * English-focused instructor onboarding (Req 16.2) — now a two-step wizard.
 *
 * Bilgim is an English-only platform, so there is no generic specialty quiz.
 * Step 1: the instructor declares taught CEFR levels + exam-track focus.
 * Step 2: the instructor claims their PUBLIC PROFILE — the `publicSlug`,
 * headline, and bio that make `bilgim.uz/teachers/:publicSlug` a real,
 * discoverable "website" for them (Requirement: every first-time teacher
 * login must be walked through what's needed to launch their site).
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
  const [step, setStep] = useState<1 | 2>(1);
  const [taughtCefrLevels, setTaughtCefrLevels] = useState<CefrLevel[]>([]);
  const [examTrackFocus, setExamTrackFocus] = useState<string[]>([]);
  const [publicSlug, setPublicSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [headline, setHeadline] = useState('');
  const [bio, setBio] = useState('');
  const [yearsOfExperience, setYearsOfExperience] = useState('');
  const [schoolName, setSchoolName] = useState('');
  const [accentColor, setAccentColor] = useState<AccentColor>('BLUE');
  const [serverError, setServerError] = useState<string | null>(null);
  const [slugError, setSlugError] = useState<string | null>(null);

  // Pre-fill from the existing profile — this same wizard is reachable both
  // on first login (empty profile) and later, when a teacher revisits
  // `/onboarding` to finish or edit their public profile.
  const profileQuery = useQuery({
    queryKey: ['teacher', 'profile', 'me'],
    queryFn: () => teacherApi.getMyProfile(),
  });

  useEffect(() => {
    const profile = profileQuery.data?.teacherProfile;
    if (!profile) return;
    if (profile.taughtCefrLevels.length > 0) {
      setTaughtCefrLevels(profile.taughtCefrLevels);
    }
    if (profile.examTrackFocus.length > 0) {
      setExamTrackFocus(profile.examTrackFocus);
    }
    if (profile.publicSlug) {
      setPublicSlug(profile.publicSlug);
      setSlugTouched(true);
    }
    if (profile.headline) setHeadline(profile.headline);
    if (profile.bio) setBio(profile.bio);
    if (profile.yearsOfExperience !== null) {
      setYearsOfExperience(String(profile.yearsOfExperience));
    }
    if (profile.schoolName) setSchoolName(profile.schoolName);
    if (profile.accentColor) setAccentColor(profile.accentColor);
  }, [profileQuery.data]);

  // Auto-suggest a slug from the teacher's name until they edit it themselves.
  useEffect(() => {
    if (slugTouched) return;
    const fullName = profileQuery.data?.fullName;
    if (!fullName) return;
    setPublicSlug(slugify(fullName));
  }, [profileQuery.data?.fullName, slugTouched]);

  const submitMutation = useMutation({
    mutationFn: () =>
      teacherApi.completeOnboarding({
        taughtCefrLevels,
        examTrackFocus,
        publicSlug,
        headline: headline.trim() || null,
        bio: bio.trim() || null,
        yearsOfExperience: yearsOfExperience.trim()
          ? Number(yearsOfExperience)
          : null,
        schoolName: schoolName.trim() || null,
        accentColor,
      }),
    onSuccess: (result) => {
      const target = result.dashboardUrl.startsWith('/')
        ? `/${locale}${result.dashboardUrl}`
        : `/${locale}/dashboard`;
      router.push(target);
      router.refresh();
    },
    onError: (err: unknown) => {
      if (err instanceof ApiClientError) {
        const code = (err.details as { code?: string } | undefined)?.code;
        if (code === 'PUBLIC_SLUG_TAKEN') {
          setSlugError('Bu havola band, boshqa nom tanlang.');
          return;
        }
        setServerError(err.message);
      } else {
        setServerError('Server bilan aloqa xatosi. Qayta urinib ko‘ring.');
      }
    },
  });

  const canContinueStep1 = taughtCefrLevels.length > 0;
  const slugFormatValid = useMemo(
    () => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(publicSlug) && publicSlug.length >= 3,
    [publicSlug],
  );
  const canSubmit = slugFormatValid && !submitMutation.isPending;

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

  function handleContinue(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canContinueStep1) {
      setServerError(
        'Kamida bitta CEFR darajasini tanlang, keyin davom eting.',
      );
      return;
    }
    setServerError(null);
    setStep(2);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSlugError(null);
    if (!slugFormatValid) {
      setSlugError(
        'Kamida 3 ta belgi: faqat kichik lotin harflari, raqamlar va bitta chiziqcha (-).',
      );
      return;
    }
    setServerError(null);
    submitMutation.mutate();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      {/* Header */}
      <div className="space-y-2 text-center">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-tint text-blue">
          {step === 1 ? (
            <GraduationCap className="h-6 w-6" aria-hidden="true" />
          ) : (
            <Globe className="h-6 w-6" aria-hidden="true" />
          )}
        </span>
        <h1 className="text-2xl font-black tracking-tight text-ink-strong sm:text-3xl">
          {step === 1
            ? "Ingliz tili o'qituvchisi profili"
            : 'Maktabingizni yarating'}
        </h1>
        <p className="text-ink-soft">
          {step === 1
            ? "Qaysi darajalarni va imtihon yo'nalishlarini o'qitishingizni tanlang. Bu talabalarga sizni topishda yordam beradi."
            : 'Talabalar sizni shu manzil orqali topishadi va profilingizni ko‘rishadi.'}
        </p>
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
          Qadam {step}/2
        </p>
      </div>

      {/* Trial reminder (trial is created server-side at verification) */}
      <div className="flex items-center justify-center gap-2 rounded-2xl bg-green-tint px-4 py-2.5 text-sm font-semibold text-green">
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        14 kunlik bepul sinov faol · Karta talab qilinmaydi
      </div>

      {step === 1 ? (
        <form onSubmit={handleContinue} className="space-y-8">
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
            <Button type="submit" size="lg" fullWidth disabled={!canContinueStep1}>
              Davom etish
            </Button>
          </div>
        </form>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-8">
          <Card padding="lg" className="space-y-5">
            <div className="flex items-start gap-4">
              <div
                className={cn(
                  'flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl text-xl font-extrabold',
                  ACCENT_STYLES[accentColor].tint,
                  ACCENT_STYLES[accentColor].solid,
                )}
              >
                {getInitials(schoolName || profileQuery.data?.fullName || 'Ustoz')}
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <label htmlFor="schoolName" className="block text-sm font-bold text-ink-strong">
                  Maktab nomi <span className="font-normal text-ink-soft">(ixtiyoriy)</span>
                </label>
                <input
                  id="schoolName"
                  name="schoolName"
                  type="text"
                  value={schoolName}
                  onChange={(e) => setSchoolName(e.target.value.slice(0, 60))}
                  placeholder="Masalan: Nodira's English Academy"
                  className="w-full rounded-2xl border border-rim bg-canvas px-3.5 py-2.5 text-sm text-ink-strong outline-none focus:border-blue"
                />
                <p className="text-xs text-ink-soft">
                  Bo&apos;sh qoldirsangiz, profilingizda shaxsiy ismingiz ko&apos;rinadi.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <span className="block text-sm font-bold text-ink-strong">Rang</span>
              <div className="flex gap-3">
                {ACCENT_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setAccentColor(color)}
                    aria-pressed={accentColor === color}
                    aria-label={ACCENT_LABELS[color]}
                    className={cn(
                      'h-9 w-9 rounded-full ring-2 ring-offset-2 ring-offset-canvas transition-transform',
                      ACCENT_STYLES[color].tint,
                      accentColor === color
                        ? ACCENT_STYLES[color].ring
                        : 'ring-transparent hover:scale-105',
                    )}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <label htmlFor="publicSlug" className="block text-base font-bold text-ink-strong">
                Profil manzili
              </label>
              <p className="text-sm text-ink-soft">
                Talabalar sizni shu havola orqali topadi.
              </p>
            </div>
            <div>
              <div className="flex items-stretch overflow-hidden rounded-2xl border border-rim focus-within:border-blue">
                <span className="flex items-center bg-tint px-3 text-sm text-ink-faint">
                  bilgim.uz/teachers/
                </span>
                <input
                  id="publicSlug"
                  name="publicSlug"
                  type="text"
                  value={publicSlug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlugError(null);
                    setPublicSlug(slugify(e.target.value));
                  }}
                  placeholder="ustoz-ismi"
                  className="min-w-0 flex-1 bg-canvas px-3 py-2.5 text-sm font-semibold text-ink-strong outline-none"
                  aria-invalid={slugError ? true : undefined}
                  aria-describedby={slugError ? 'publicSlug-error' : undefined}
                />
              </div>
              {slugError && (
                <p id="publicSlug-error" role="alert" className="mt-2 text-sm font-medium text-red">
                  {slugError}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="headline" className="block text-sm font-bold text-ink-strong">
                Sarlavha <span className="font-normal text-ink-soft">(ixtiyoriy)</span>
              </label>
              <input
                id="headline"
                name="headline"
                type="text"
                value={headline}
                onChange={(e) => setHeadline(e.target.value.slice(0, 120))}
                placeholder="Masalan: IELTS 8.0 | 7 yillik tajriba"
                className="w-full rounded-2xl border border-rim bg-canvas px-3.5 py-2.5 text-sm text-ink-strong outline-none focus:border-blue"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="yearsOfExperience" className="block text-sm font-bold text-ink-strong">
                Tajriba (yil) <span className="font-normal text-ink-soft">(ixtiyoriy)</span>
              </label>
              <input
                id="yearsOfExperience"
                name="yearsOfExperience"
                type="number"
                inputMode="numeric"
                min={0}
                max={60}
                value={yearsOfExperience}
                onChange={(e) => setYearsOfExperience(e.target.value)}
                placeholder="Masalan: 5"
                className="w-32 rounded-2xl border border-rim bg-canvas px-3.5 py-2.5 text-sm text-ink-strong outline-none focus:border-blue"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="bio" className="block text-sm font-bold text-ink-strong">
                Bio <span className="font-normal text-ink-soft">(ixtiyoriy)</span>
              </label>
              <textarea
                id="bio"
                name="bio"
                value={bio}
                onChange={(e) => setBio(e.target.value.slice(0, 2000))}
                rows={4}
                placeholder="O'zingiz va o'qitish uslubingiz haqida qisqacha yozing."
                className="w-full resize-none rounded-2xl border border-rim bg-canvas px-3.5 py-2.5 text-sm text-ink-strong outline-none focus:border-blue"
              />
            </div>

            {publicSlug && slugFormatValid && (
              <p className="text-sm text-ink-soft">
                Sizning saytingiz:{' '}
                <span className="font-semibold text-blue">
                  bilgim.uz/teachers/{publicSlug}
                </span>
              </p>
            )}
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
            <div className="flex w-full gap-3">
              <Button
                type="button"
                variant="secondary"
                size="lg"
                onClick={() => setStep(1)}
                disabled={submitMutation.isPending}
              >
                Orqaga
              </Button>
              <Button
                type="submit"
                size="lg"
                fullWidth
                loading={submitMutation.isPending}
                disabled={!canSubmit}
              >
                Saytimni yaratish
              </Button>
            </div>
            <p className="text-center text-xs text-ink-soft">
              Bu ma&apos;lumotlarni keyinroq ham to&apos;ldirishingiz yoki
              o&apos;zgartirishingiz mumkin.
            </p>
          </div>
        </form>
      )}
    </div>
  );
}

/**
 * Common English exam-track options. Each `slug` must match an active row in
 * the admin-managed `ExamTrack` catalog for server-side validation to accept
 * it (seeded by `packages/db/prisma/seed.ts`) — keep this list and that seed
 * in sync. `general` also matches the slug the public `/search` exam-track
 * filter recognises (`components/discovery/facets.ts`), so a teacher who
 * picks "General English" here stays filterable there.
 */
const EXAM_TRACKS: ReadonlyArray<{ slug: string; label: string }> = [
  { slug: 'ielts', label: 'IELTS' },
  { slug: 'toefl', label: 'TOEFL' },
  { slug: 'general', label: 'General English' },
  { slug: 'cambridge', label: 'Cambridge' },
  { slug: 'pte', label: 'PTE' },
  { slug: 'business-english', label: 'Business English' },
];
