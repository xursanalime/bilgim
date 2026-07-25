'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { ArrowLeft, Radio, FileText, Eye, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';

import { HlsPlayer } from './hls-player';
import { AttachmentPreviewModal, type AttachmentPreviewState } from './attachment-preview-modal';
import { KIND_COLOR, kindIcon, attachmentFileName, formatBytes } from '../../lib/attachment-display';
import {
  studentApi,
  type LessonAttachment,
  type MediaPlaybackResponse,
} from '../../lib/api/student';
import { ApiClientError } from '../../lib/api-client';
import { cn } from '../../lib/utils';

interface LessonPlayerProps {
  locale: string;
  lessonId: string;
}

const LESSON_TYPE_LABEL: Record<string, string> = {
  RECORDED: 'Yozib olingan',
  LIVE: 'Jonli efir',
  HYBRID: 'Aralash',
  TEXT_ONLY: 'Matn',
};

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

  const [preview, setPreview] = useState<AttachmentPreviewState | null>(null);
  const [loadingAttachmentId, setLoadingAttachmentId] = useState<string | null>(null);

  const openAttachment = useCallback(async (att: LessonAttachment) => {
    setLoadingAttachmentId(att.id);
    try {
      const res = await studentApi.getMediaPlayback(att.assetId);
      setPreview({
        url: res.url,
        type: res.type,
        kind: att.kind,
        name: attachmentFileName(att),
      });
    } finally {
      setLoadingAttachmentId(null);
    }
  }, []);

  if (lessonQuery.isLoading) {
    return <PlayerSkeleton />;
  }
  if (lessonQuery.isError || !lesson) {
    return (
      <div className="mx-auto max-w-7xl">
        <ErrorBanner
          message={
            lessonQuery.error instanceof ApiClientError
              ? lessonQuery.error.message
              : "Darsni yuklab bo'lmadi."
          }
        />
      </div>
    );
  }

  const groupId = lesson.groupId;
  const isLive = lesson.type === 'LIVE';

  return (
    <div className="mx-auto max-w-7xl space-y-8 pb-12">
      <Link
        href={`/${locale}/groups/${groupId}`}
        className="group inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-ink-faint transition-colors hover:text-blue"
      >
        <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
        Guruh
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-1.5">
          <h1 className="text-2xl font-black tracking-tight text-ink-strong sm:text-3xl">
            {lesson.title}
          </h1>
          {lesson.scheduledAt ? (
            <p className="text-sm text-ink-soft">{formatDateTime(lesson.scheduledAt)}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-rim bg-tint px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-ink-soft">
            {LESSON_TYPE_LABEL[lesson.type] ?? lesson.type}
          </span>
          {isLive ? (
            <Link
              href={`/${locale}/live/${lessonId}?groupId=${groupId}`}
              className="inline-flex items-center gap-2 rounded-2xl bg-blue/10 px-4 py-2 text-sm font-bold text-blue transition-all hover:bg-blue/20 active:scale-[0.98]"
            >
              <Radio className="h-4 w-4" />
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
            groupId={groupId}
          />

          {lesson.description ? (
            <article className="rounded-3xl border border-rim bg-white p-6 text-sm leading-relaxed text-ink shadow-soft">
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
            loadingAttachmentId={loadingAttachmentId}
            onOpen={openAttachment}
          />
        </aside>
      </div>

      <AttachmentPreviewModal preview={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

interface PlayerSurfaceProps {
  playbackQuery: ReturnType<typeof useQuery<MediaPlaybackResponse>>;
  hasVideo: boolean;
  isLive: boolean;
  lessonId: string;
  locale: string;
  groupId: string;
}

function PlayerSurface({
  playbackQuery,
  hasVideo,
  isLive,
  lessonId,
  locale,
  groupId,
}: PlayerSurfaceProps) {
  if (isLive) {
    return (
      <div className="rounded-3xl border border-rim bg-blue-tint p-10 text-center shadow-soft">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-soft">
          <Radio className="h-6 w-6 text-blue" />
        </div>
        <p className="text-sm font-semibold text-ink-strong">
          Bu dars jonli efir formatida.
        </p>
        <Link
          href={`/${locale}/live/${lessonId}?groupId=${groupId}`}
          className="mt-5 inline-flex items-center justify-center gap-2 rounded-2xl bg-blue px-5 py-2.5 text-sm font-bold text-white shadow-[0_8px_24px_-6px_rgba(0,113,227,0.4)] transition-all hover:bg-blue-600 active:scale-[0.98]"
        >
          <Radio className="h-4 w-4" />
          Jonli efir sahifasiga o&apos;tish
        </Link>
      </div>
    );
  }

  if (!hasVideo) {
    return (
      <div className="rounded-3xl border border-rim bg-white p-10 text-center text-sm text-ink-soft shadow-soft">
        Bu darsda video yo&apos;q. Quyida matn va biriktirilgan fayllarni
        ko&apos;rib chiqing.
      </div>
    );
  }

  if (playbackQuery.isLoading) {
    return (
      <div className="aspect-video animate-pulse rounded-3xl border border-rim bg-tint" />
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
      className="border border-rim shadow-soft"
    />
  );
}

interface AttachmentsPanelProps {
  attachments: LessonAttachment[];
  primaryVideoId: string | null;
  loadingAttachmentId: string | null;
  onOpen: (attachment: LessonAttachment) => void;
}

function AttachmentsPanel({
  attachments,
  primaryVideoId,
  loadingAttachmentId,
  onOpen,
}: AttachmentsPanelProps) {
  const sorted = [...attachments].sort((a, b) => a.position - b.position);
  const supplementary = sorted.filter((a) => a.id !== primaryVideoId);

  return (
    <section className="rounded-3xl border border-rim bg-white p-6 shadow-soft">
      <h2 className="flex items-center gap-2 text-base font-bold tracking-tight text-ink-strong">
        <FileText className="h-4 w-4 text-ink-faint" />
        Materiallar
      </h2>
      {supplementary.length === 0 ? (
        <p className="mt-3 text-sm text-ink-faint">
          Qo&apos;shimcha materiallar mavjud emas.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {supplementary.map((att) => (
            <li key={att.id}>
              <AttachmentLink
                attachment={att}
                isLoading={loadingAttachmentId === att.id}
                onOpen={() => onOpen(att)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AttachmentLink({
  attachment,
  isLoading,
  onOpen,
}: {
  attachment: LessonAttachment;
  isLoading: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={isLoading}
      className="group flex w-full items-center gap-3 rounded-2xl border border-rim bg-tint px-3.5 py-2.5 text-left text-sm text-ink-strong transition-all hover:border-blue/20 hover:bg-blue-tint active:scale-[0.98] disabled:cursor-progress disabled:opacity-70"
    >
      <span
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
          KIND_COLOR[attachment.kind],
        )}
      >
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : kindIcon(attachment.kind)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{attachmentFileName(attachment)}</span>
        <span className="block text-xs text-ink-soft">{formatBytes(attachment.asset.bytes)}</span>
      </span>
      <Eye className="h-3.5 w-3.5 shrink-0 text-ink-faint opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
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
      className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-bold transition-all active:scale-[0.98] ${
        isWatched
          ? 'cursor-default border border-green/20 bg-green-tint text-green'
          : 'border border-rim bg-white text-ink-strong hover:border-blue/30 hover:bg-tint'
      }`}
      aria-pressed={isWatched}
    >
      {isWatched ? (
        <>
          <CheckCircle2 className="h-4 w-4" /> Ko&apos;rib bo&apos;lindi
        </>
      ) : (
        "Ko'rib bo'ldim deb belgilash"
      )}
    </button>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-red/20 bg-red-tint p-4 text-sm font-medium text-red">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      {message}
    </div>
  );
}

function PlayerSkeleton() {
  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <div className="h-4 w-16 animate-pulse rounded-full bg-tint" />
      <div className="h-8 w-1/2 animate-pulse rounded-full bg-tint" />
      <div className="aspect-video animate-pulse rounded-3xl border border-rim bg-tint" />
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
