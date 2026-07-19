'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { HlsPlayer } from './hls-player';
import {
  studentApi,
  type LessonAttachment,
  type MediaPlaybackResponse,
} from '../../lib/api/student';
import { ApiClientError } from '../../lib/api-client';

interface LessonPlayerProps {
  locale: string;
  lessonId: string;
}

/**
 * Lesson player.
 *
 *  - Loads the lesson via `GET /catalog/lessons/:id` (server-side
 *    LessonAccessGuard already enforces enrollment).
 *  - Picks the first VIDEO attachment as the primary source. If no
 *    VIDEO is present, the page still renders text + non-video
 *    attachments.
 *  - Resolves the signed playback URL from `GET /media/assets/:id/url`.
 *    Works for both HLS-transcoded videos (master manifest) and
 *    non-transcoded source files.
 *  - Includes a "Mark as watched" button stored in localStorage so
 *    students can track their own progress until a server-side
 *    progress endpoint lands in a later task.
 */
export function LessonPlayer({ locale, lessonId }: LessonPlayerProps) {
  const lessonQuery = useQuery({
    queryKey: ['catalog', 'lesson', lessonId],
    queryFn: () => studentApi.getLesson(lessonId),
  });

  const lesson = lessonQuery.data;

  const primaryVideo = useMemo<LessonAttachment | null>(() => {
    if (!lesson?.attachments) return null;
    const sorted = [...lesson.attachments].sort(
      (a, b) => a.position - b.position,
    );
    return sorted.find((a) => a.kind === 'VIDEO') ?? null;
  }, [lesson]);

  const playbackQuery = useQuery({
    queryKey: ['media', 'playback', primaryVideo?.assetId],
    queryFn: () => studentApi.getMediaPlayback(primaryVideo!.assetId),
    enabled: Boolean(primaryVideo),
  });

  if (lessonQuery.isLoading) {
    return <PlayerSkeleton />;
  }
  if (lessonQuery.isError || !lesson) {
    return (
      <ErrorBanner
        message={
          lessonQuery.error instanceof ApiClientError
            ? lessonQuery.error.message
            : "Darsni yuklab bo'lmadi."
        }
      />
    );
  }

  const groupId = lesson.groupId;
  const isLive = lesson.type === 'LIVE';

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href={`/${locale}/groups/${groupId}`}
          className="font-mono text-[11px] uppercase tracking-[0.18em] text-cream-dim hover:text-accent2-500"
        >
          ← Guruh
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-extrabold tracking-tight text-cream sm:text-3xl">
            {lesson.title}
          </h1>
          {lesson.scheduledAt ? (
            <p className="mt-1 text-sm text-cream-dim">
              {formatDateTime(lesson.scheduledAt)}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-white/[0.06] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-cream-dim">
            {lesson.type}
          </span>
          {isLive ? (
            <Link
              href={`/${locale}/live/${lessonId}`}
              className="rounded-2xl bg-accent2-500 px-4 py-2 text-sm font-bold text-ink hover:bg-accent2-400"
            >
              Jonli efirga ulanish
            </Link>
          ) : null}
          <MarkWatchedButton lessonId={lessonId} />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <PlayerSurface
            playbackQuery={playbackQuery}
            hasVideo={Boolean(primaryVideo)}
            isLive={isLive}
            lessonId={lessonId}
            locale={locale}
          />

          {lesson.description ? (
            <article className="rounded-2xl border border-white/[0.07] bg-ink-surface p-6 text-sm leading-relaxed text-cream/90">
              {lesson.description.split(/\n+/).map((para, idx) => (
                <p key={idx} className="mb-3 last:mb-0">
                  {para}
                </p>
              ))}
            </article>
          ) : null}
        </div>

        <aside className="space-y-4">
          <AttachmentsPanel
            attachments={lesson.attachments ?? []}
            primaryVideoId={primaryVideo?.id ?? null}
          />
        </aside>
      </div>
    </div>
  );
}

interface PlayerSurfaceProps {
  playbackQuery: ReturnType<typeof useQuery<MediaPlaybackResponse>>;
  hasVideo: boolean;
  isLive: boolean;
  lessonId: string;
  locale: string;
}

function PlayerSurface({
  playbackQuery,
  hasVideo,
  isLive,
  lessonId,
  locale,
}: PlayerSurfaceProps) {
  if (isLive) {
    return (
      <div className="rounded-2xl border border-accent2-500/30 bg-ink-surface p-8 text-center">
        <p className="text-sm font-semibold text-cream">
          Bu dars jonli efir formatida.
        </p>
        <Link
          href={`/${locale}/live/${lessonId}`}
          className="mt-4 inline-flex items-center justify-center rounded-2xl bg-accent2-500 px-5 py-2.5 text-sm font-bold text-ink hover:bg-accent2-400"
        >
          Jonli efir sahifasiga o&apos;tish
        </Link>
      </div>
    );
  }

  if (!hasVideo) {
    return (
      <div className="rounded-2xl border border-white/[0.07] bg-ink-surface p-8 text-center text-sm text-cream-dim">
        Bu darsda video yo&apos;q. Quyida matn va biriktirilgan fayllarni
        ko&apos;rib chiqing.
      </div>
    );
  }

  if (playbackQuery.isLoading) {
    return (
      <div className="aspect-video animate-pulse rounded-2xl border border-white/[0.07] bg-ink-surface" />
    );
  }

  if (playbackQuery.isError || !playbackQuery.data) {
    return (
      <ErrorBanner
        message={
          playbackQuery.error instanceof ApiClientError
            ? playbackQuery.error.message
            : "Video manbasini yuklab bo'lmadi."
        }
      />
    );
  }

  const playback = playbackQuery.data;
  return (
    <HlsPlayer
      src={playback.url}
      type={playback.type}
      className="border border-white/[0.07]"
    />
  );
}

interface AttachmentsPanelProps {
  attachments: LessonAttachment[];
  primaryVideoId: string | null;
}

function AttachmentsPanel({
  attachments,
  primaryVideoId,
}: AttachmentsPanelProps) {
  const sorted = [...attachments].sort((a, b) => a.position - b.position);
  const supplementary = sorted.filter((a) => a.id !== primaryVideoId);

  return (
    <section className="rounded-2xl border border-white/[0.07] bg-ink-surface p-6">
      <h2 className="text-base font-bold tracking-tight text-cream">
        Materiallar
      </h2>
      {supplementary.length === 0 ? (
        <p className="mt-3 text-sm text-cream-dim">
          Qo&apos;shimcha materiallar mavjud emas.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {supplementary.map((att) => (
            <li key={att.id}>
              <AttachmentLink attachment={att} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AttachmentLink({ attachment }: { attachment: LessonAttachment }) {
  const playbackQuery = useQuery({
    queryKey: ['media', 'playback', attachment.assetId],
    queryFn: () => studentApi.getMediaPlayback(attachment.assetId),
    // Lazy: only resolve the signed URL when the user opens the panel.
    staleTime: 5 * 60_000,
  });

  const url = playbackQuery.data?.url;

  return (
    <a
      href={url ?? '#'}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex items-center justify-between gap-3 rounded-xl border border-white/[0.05] px-3 py-2 text-sm text-cream transition-colors ${
        url
          ? 'hover:border-accent2-500/40 hover:bg-white/[0.04]'
          : 'cursor-progress opacity-60'
      }`}
      onClick={(e) => {
        if (!url) e.preventDefault();
      }}
    >
      <span className="flex items-center gap-2 truncate">
        <span className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-cream-dim">
          {attachment.kind}
        </span>
        <span className="truncate">{attachment.role || 'Material'}</span>
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-cream-dim">
        {playbackQuery.isLoading ? '...' : 'Yuklash'}
      </span>
    </a>
  );
}

function MarkWatchedButton({ lessonId }: { lessonId: string }) {
  const queryClient = useQueryClient();
  const storageKey = `edubridge:watched:${lessonId}`;
  const [isWatched, setIsWatched] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return Boolean(window.localStorage.getItem(storageKey));
  });

  const mutation = useMutation({
    mutationFn: async () => {
      // No server-side progress endpoint yet — persist locally so the
      // UX is immediate. A follow-up task can swap the body for a real
      // POST `/lessons/:id/views` call without changing the UI.
      window.localStorage.setItem(storageKey, new Date().toISOString());
      setIsWatched(true);
      return true;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['student', 'enrollments'] });
    },
  });

  return (
    <button
      type="button"
      onClick={() => mutation.mutate()}
      disabled={isWatched || mutation.isPending}
      className={`rounded-2xl px-4 py-2 text-sm font-bold transition-all ${
        isWatched
          ? 'cursor-default border border-accent2-500/40 bg-accent2-500/10 text-accent2-500'
          : 'border border-white/[0.07] bg-white/[0.04] text-cream hover:border-accent2-500/40 hover:text-accent2-500'
      }`}
      aria-pressed={isWatched}
    >
      {isWatched ? "Ko'rib bo'lindi ✓" : "Ko'rib bo'ldim deb belgilash"}
    </button>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
      {message}
    </div>
  );
}

function PlayerSkeleton() {
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="h-8 w-1/2 animate-pulse rounded-full bg-white/[0.06]" />
      <div className="aspect-video animate-pulse rounded-2xl border border-white/[0.07] bg-ink-surface" />
    </div>
  );
}

function formatDateTime(input: string): string {
  try {
    return new Date(input).toLocaleString('uz-UZ', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return input;
  }
}
