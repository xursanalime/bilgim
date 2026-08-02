'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Globe,
  Loader2,
  Save,
  Upload,
  X,
} from 'lucide-react';

import { teacherApi, type SlugAvailability } from '../../lib/api/teacher';
import { ApiClientError } from '../../lib/api-client';
import { uploadFile, getPublicImageUrl } from '../../lib/upload';
import { buildTenantUrl, ROOT_DOMAIN } from '../../lib/tenant';
import { cn } from '../../lib/utils';

interface TeacherPublicProfileProps {
  locale: string;
}

const SLUG_INPUT_PATTERN = /^[a-z0-9-]*$/;
const SLUG_CHECK_DEBOUNCE_MS = 400;

const SLUG_UNAVAILABLE_MESSAGE: Record<Exclude<SlugAvailability, { available: true }>['reason'], string> = {
  invalid: "Slug 3-32 belgi, faqat lotin harflari/raqamlar/'-' bo'lishi kerak",
  reserved: 'Bu nom tizim uchun band qilingan',
  taken: 'Bu nom allaqachon band',
};

/**
 * "Mening maktabim" — the settings panel for a teacher's own subdomain
 * ("{slug}.bilgim.uz"): discovery visibility, subdomain slug (with a
 * debounced availability check), cover image, headline, and brand color.
 * All fields share the single `PATCH /teacher/profile/public` write path
 * (Task 5/6) — `TeacherProfile.publicSlug` has no other writer in the app.
 */
export function TeacherPublicProfile({ locale }: TeacherPublicProfileProps) {
  const queryClient = useQueryClient();
  const [headline, setHeadline] = useState('');
  const [slugInput, setSlugInput] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [themeColor, setThemeColor] = useState('#2563eb');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const statusQuery = useQuery({
    queryKey: ['teacher', 'publicProfile'],
    queryFn: () => teacherApi.getPublicProfile(),
  });

  useEffect(() => {
    if (!statusQuery.data) return;
    setHeadline(statusQuery.data.headline ?? '');
    setSlugInput(statusQuery.data.publicSlug ?? '');
    setCoverUrl(statusQuery.data.coverUrl ?? '');
    setThemeColor(statusQuery.data.themeColor ?? '#2563eb');
  }, [statusQuery.data]);

  // --- Debounced slug availability check ---------------------------------
  const [slugAvailability, setSlugAvailability] = useState<SlugAvailability | null>(null);
  const [slugChecking, setSlugChecking] = useState(false);
  const persistedSlug = statusQuery.data?.publicSlug ?? null;

  useEffect(() => {
    const normalized = slugInput.trim().toLowerCase();
    if (!normalized || normalized === persistedSlug) {
      setSlugAvailability(null);
      setSlugChecking(false);
      return;
    }

    setSlugChecking(true);
    const timer = setTimeout(() => {
      teacherApi
        .checkPublicSlug(normalized)
        .then((result) => setSlugAvailability(result))
        .catch(() => setSlugAvailability(null))
        .finally(() => setSlugChecking(false));
    }, SLUG_CHECK_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [slugInput, persistedSlug]);

  const mutation = useMutation({
    mutationFn: (isPublic: boolean) =>
      teacherApi.updatePublicProfile({
        isPublic,
        headline: headline.trim(),
        ...(slugInput.trim() && { publicSlug: slugInput.trim().toLowerCase() }),
        // Always explicit (never omitted) — an empty string is how the
        // "remove image" button signals "clear the cover", and omitting
        // the field entirely would instead mean "leave unchanged".
        coverUrl,
        themeColor,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['teacher', 'publicProfile'], data);
      setError(null);
      setSuccessMsg('Saqlandi — subdomain darhol jonli!');
      setTimeout(() => setSuccessMsg(null), 3000);
    },
    onError: (err) => {
      setError(err instanceof ApiClientError ? err.message : 'Xatolik yuz berdi.');
    },
  });

  const previewMutation = useMutation({
    mutationFn: () =>
      teacherApi.createPreviewToken({
        slug: slugInput.trim().toLowerCase(),
        ...(headline.trim() && { headline: headline.trim() }),
        // Always explicit, same reasoning as the save mutation above —
        // '' reflects a pending "O'chirish" click in the preview too.
        coverUrl,
        themeColor,
      }),
    onSuccess: (result) => {
      setPreviewError(null);
      const url = buildTenantUrl(
        window.location.host,
        slugInput.trim().toLowerCase(),
        `/?preview=${encodeURIComponent(result.previewToken)}`,
      );
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    onError: (err) => {
      setPreviewError(err instanceof ApiClientError ? err.message : "Ko'rib chiqib bo'lmadi.");
    },
  });

  async function handleCoverSelected(file: File) {
    setUploadProgress(0);
    setError(null);
    try {
      const assetId = await uploadFile(file, 'IMAGE', setUploadProgress);
      // `uploadFile` resolves to a MediaAsset id, not a URL — resolve it
      // to the stable public-image proxy URL before storing/previewing it.
      setCoverUrl(getPublicImageUrl(assetId));
    } catch {
      setError("Rasm yuklab bo'lmadi. Qayta urinib ko'ring.");
    } finally {
      setUploadProgress(null);
    }
  }

  if (statusQuery.isLoading) {
    return <div className="h-56 animate-pulse rounded-[2rem] bg-soft/60 sm:rounded-[2.5rem]" />;
  }

  if (statusQuery.isError || !statusQuery.data) {
    return (
      <div className="flex items-center gap-3 rounded-[2rem] border border-red/15 bg-red-tint p-6 text-sm font-bold text-red sm:rounded-[2.5rem]">
        <AlertCircle className="h-5 w-5 shrink-0" />
        Ochiq profil holatini yuklab bo'lmadi.
      </div>
    );
  }

  const status = statusQuery.data;
  const hasDiscoverableCourse = status.discoverableCourseCount > 0;
  const normalizedSlug = slugInput.trim().toLowerCase();
  const slugChanged = normalizedSlug !== '' && normalizedSlug !== persistedSlug;
  const slugBlocksSave = slugChanged && slugAvailability?.available === false;

  return (
    <section className="overflow-hidden rounded-[2rem] border border-rim bg-white shadow-soft sm:rounded-[2.5rem]">
      <div className="border-b border-rim bg-tint/30 px-6 py-4 sm:px-8 sm:py-5">
        <h3 className="font-display text-base font-extrabold text-ink-strong">Mening maktabim</h3>
        <p className="text-xs text-ink-faint">
          Shaxsiy onlayn maktab sahifangiz — subdomain, qopqoq rasm, sarlavha va rang.
        </p>
      </div>

      <div className="space-y-6 p-6 sm:p-8">
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-rim bg-tint/30 p-4">
          <div className="flex items-center gap-3">
            <div className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
              status.isPublic ? 'bg-blue-tint text-blue' : 'bg-soft text-ink-faint',
            )}>
              <Globe className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-ink-strong">Maktab sahifasi yoqilgan</p>
              <p className="text-xs text-ink-faint">
                {status.isPublic
                  ? 'Talabalar qidiruvda va subdomaningizda sizni topa oladi.'
                  : "Hozircha qidiruvda va subdomaningizda ko'rinmaysiz."}
              </p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={status.isPublic}
            disabled={mutation.isPending}
            onClick={() => mutation.mutate(!status.isPublic)}
            className={cn(
              'flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition-colors disabled:opacity-50',
              status.isPublic ? 'justify-end bg-blue' : 'justify-start bg-soft',
            )}
          >
            <span className="h-6 w-6 rounded-full bg-white shadow-sm" />
          </button>
        </div>

        {!hasDiscoverableCourse && (
          <div className="flex items-start gap-2.5 rounded-2xl border border-orange/15 bg-orange-tint px-4 py-3 text-xs font-semibold text-orange">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            Sizda hozircha nashr etilgan ochiq kurs yo'q — maktab sahifasi ochiq bo'lsa ham,
            "O'qituvchilarni qidirish" ro'yxatida kamida bitta ochiq kurs bo'lmaguncha chiqmaysiz.
          </div>
        )}

        {/* Subdomain slug */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-ink-strong uppercase tracking-wider">
            Manzil (subdomain)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={slugInput}
              onChange={(e) => {
                const next = e.target.value.toLowerCase();
                if (SLUG_INPUT_PATTERN.test(next)) setSlugInput(next);
              }}
              placeholder="aziz-teacher"
              maxLength={32}
              className="flex-1 rounded-2xl border border-rim bg-tint/30 py-3 px-4 text-sm font-medium text-ink-strong outline-none transition-all focus:border-blue/30 focus:bg-white focus:ring-4 focus:ring-blue/5"
            />
            <span className="whitespace-nowrap text-xs font-bold text-ink-faint">.{ROOT_DOMAIN}</span>
          </div>

          {slugChanged && (
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              {slugChecking ? (
                <span className="flex items-center gap-1.5 text-ink-faint">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Tekshirilmoqda…
                </span>
              ) : slugAvailability?.available ? (
                <span className="flex items-center gap-1.5 text-teal">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Band emas
                </span>
              ) : slugAvailability && !slugAvailability.available ? (
                <span className="flex items-center gap-1.5 text-red">
                  <AlertCircle className="h-3.5 w-3.5" /> {SLUG_UNAVAILABLE_MESSAGE[slugAvailability.reason]}
                </span>
              ) : null}
            </div>
          )}
          <p className="text-[10px] text-ink-faint">
            Talabalaringiz shaxsiy maktab sahifangizga shu manzil orqali kiradi.
          </p>
        </div>

        {/* Cover image */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-ink-strong uppercase tracking-wider">
            Qopqoq rasm
          </label>
          <div className="flex items-center gap-4">
            <div className="group relative flex h-16 w-28 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-rim bg-tint/30">
              {coverUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={coverUrl} alt="Qopqoq" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setCoverUrl('')}
                    aria-label="Rasmni o'chirish"
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-tint-strong/70 text-white opacity-0 transition-opacity hover:bg-red group-hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </>
              ) : (
                <span className="text-[10px] text-ink-faint">Rasm yo'q</span>
              )}
            </div>
            <div className="flex-1 space-y-1">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleCoverSelected(file);
                  e.target.value = '';
                }}
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadProgress !== null}
                  className="flex items-center gap-1.5 rounded-xl border border-rim bg-tint px-4 py-2 text-xs font-bold text-ink-soft transition-all hover:border-blue/20 hover:text-blue disabled:opacity-50"
                >
                  {uploadProgress !== null ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Yuklanmoqda {uploadProgress}%</>
                  ) : (
                    <><Upload className="h-3.5 w-3.5" /> {coverUrl ? 'Almashtirish' : 'Rasm tanlash'}</>
                  )}
                </button>
                {coverUrl && (
                  <button
                    type="button"
                    onClick={() => setCoverUrl('')}
                    className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-ink-faint transition-colors hover:text-red"
                  >
                    <X className="h-3.5 w-3.5" /> O'chirish
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Headline */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-ink-strong uppercase tracking-wider">
            Sarlavha / tavsif
          </label>
          <input
            type="text"
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            placeholder="Masalan: Sertifikatlangan IELTS instruktori"
            maxLength={200}
            className="w-full rounded-2xl border border-rim bg-tint/30 py-3 px-4 text-sm font-medium text-ink-strong outline-none transition-all focus:border-blue/30 focus:bg-white focus:ring-4 focus:ring-blue/5"
          />
          <p className="text-[10px] text-ink-faint">Maktab sahifangizda ism ostida ko'rsatiladi.</p>
        </div>

        {/* Theme color */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-ink-strong uppercase tracking-wider">
            Rang sxemasi
          </label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={themeColor}
              onChange={(e) => setThemeColor(e.target.value)}
              className="h-10 w-14 cursor-pointer rounded-lg border border-rim bg-transparent p-1"
            />
            <input
              type="text"
              value={themeColor}
              onChange={(e) => {
                const next = e.target.value;
                if (/^#[0-9a-fA-F]{0,6}$/.test(next)) setThemeColor(next);
              }}
              maxLength={7}
              className="w-28 rounded-xl border border-rim bg-tint/30 py-2 px-3 text-sm font-mono text-ink-strong outline-none focus:border-blue/30 focus:bg-white"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {status.isPublic && status.profileUrlPath && (
            <Link
              href={`/${locale}${status.profileUrlPath}`}
              target="_blank"
              className="inline-flex items-center gap-1.5 text-xs font-bold text-blue hover:underline"
            >
              Ochiq profilni ko'rish
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          )}

          {normalizedSlug.length >= 3 && (
            <button
              type="button"
              onClick={() => previewMutation.mutate()}
              disabled={previewMutation.isPending}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-ink-soft hover:text-blue disabled:opacity-50"
            >
              {previewMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ExternalLink className="h-3.5 w-3.5" />
              )}
              Ko'rib chiqish (saqlamasdan)
            </button>
          )}
        </div>
        {previewError && (
          <div className="flex items-center gap-2 text-sm font-medium text-red">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {previewError}
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-sm font-medium text-red">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}
        {successMsg && (
          <div className="flex items-center gap-2 text-sm font-medium text-teal">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {successMsg}
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => mutation.mutate(status.isPublic)}
            disabled={mutation.isPending || slugBlocksSave}
            className="flex items-center justify-center gap-2 rounded-2xl border border-rim bg-tint px-6 py-3 text-sm font-bold text-ink-soft transition-all hover:border-blue/20 hover:text-blue active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
          >
            {mutation.isPending ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Saqlanmoqda</>
            ) : (
              <><Save className="h-4 w-4" /> Saqlash</>
            )}
          </button>
        </div>
      </div>
    </section>
  );
}
