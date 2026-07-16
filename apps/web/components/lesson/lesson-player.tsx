'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Eye,
  FileText,
  Lock,
  Paperclip,
  Radio,
  Video,
} from 'lucide-react';

import { ProtectedFileViewer } from '../media/protected-file-viewer';
import { LessonVideoPlayer } from './lesson-video-player';
import { LessonNav } from './lesson-nav';
import { Badge, StatusPill } from '../ui/badge';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { EmptyState, ErrorState, LoadingState } from '../states';
import { studentApi, type LessonAttachment } from '../../lib/api/student';
import { liveApi } from '../../lib/api/live';
import { lessonProgressApi } from '../../lib/lesson-api';
import { ApiClientError } from '../../lib/api-client';
import { getUserRole } from '../../lib/auth';

interface LessonPlayerProps {
  locale: string;
  lessonId: string;
}

/**
 * Lesson player — unified light design system (frontend-redesign §5, §6).
 *
 *  - Loads the lesson via `GET /catalog/lessons/:id` (server-side
 *    LessonAccessGuard already enforces enrollment).
 *  - Picks the first VIDEO attachment as the primary source and renders it
 *    through `ProtectedVideoPlayer` (protected variant) so playback is
 *    DRM-gated, forensically watermarked, and fails closed — it never falls
 *    back to an unprotected `<video src>` (Req 6.1, Req 1).
 *  - Supplementary attachments are streamed through `ProtectedFileViewer`
 *    (same-origin BFF → blob:), so a raw / signed storage URL never reaches
 *    the DOM and download gating stays server-authoritative (Req 6.5, Req 2).
 *  - "Mark as watched" persists completion through the server-side progress
 *    endpoint (`lessonProgressApi`, Req 6.6) — replacing the old localStorage
 *    stopgap — and renders lesson navigation (prev/next + group lesson list +
 *    lock state) via `LessonNav` (Req 6.4) (task 2.3).
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

  if (lessonQuery.isLoading) {
    return (
      <div className="mx-auto max-w-7xl">
        <LoadingState variant="page" label="Dars yuklanmoqda…" />
      </div>
    );
  }

  if (lessonQuery.isError || !lesson) {
    return (
      <div className="mx-auto max-w-7xl">
        <ErrorState
          title="Darsni yuklab bo'lmadi"
          message={
            lessonQuery.error instanceof ApiClientError
              ? lessonQuery.error.message
              : 'Iltimos, sahifani qaytadan yuklang yoki keyinroq urinib ko\'ring.'
          }
          retryLabel="Qayta urinish"
          onRetry={() => void lessonQuery.refetch()}
        />
      </div>
    );
  }

  const groupId = lesson.groupId;
  const isLive = lesson.type === 'LIVE';
  // HYBRID lessons support BOTH a recorded video and a live broadcast, so they
  // must also offer the "join live" path to students (previously only pure LIVE
  // lessons did, leaving HYBRID students with no way to join the efir).
  const canGoLive = lesson.type === 'LIVE' || lesson.type === 'HYBRID';

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href={`/${locale}/groups/${groupId}`}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft transition-colors hover:text-blue"
        >
          <ArrowLeft className="h-4 w-4" />
          Guruh
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {isLive ? (
              <StatusPill variant="red" pulse>
                Jonli
              </StatusPill>
            ) : (
              <Badge variant="blue">{lesson.type}</Badge>
            )}
          </div>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-ink-strong sm:text-3xl">
            {lesson.title}
          </h1>
          {lesson.scheduledAt ? (
            <p className="mt-1 text-sm text-ink-soft">
              {formatDateTime(lesson.scheduledAt)}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canGoLive ? (
            <Button
              asChild
              variant="primary"
              leftIcon={<Radio className="h-4 w-4" />}
            >
              <Link href={`/${locale}/live/${lessonId}`}>
                Jonli efirga ulanish
              </Link>
            </Button>
          ) : null}
          <MarkWatchedButton lessonId={lessonId} groupId={groupId} />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <PlayerSurface
            primaryVideoAssetId={primaryVideo?.assetId ?? null}
            isLive={canGoLive}
            lessonId={lessonId}
            locale={locale}
          />

          {lesson.description ? (
            <Card padding="lg">
              <article className="text-sm leading-relaxed text-ink-soft">
                {lesson.description.split(/\n+/).map((para, idx) => (
                  <p key={idx} className="mb-3 last:mb-0">
                    {para}
                  </p>
                ))}
              </article>
            </Card>
          ) : null}
        </div>

        <aside className="space-y-4">
          <LessonNav
            locale={locale}
            groupId={groupId}
            currentLessonId={lessonId}
          />
          <AttachmentsPanel
            attachments={lesson.attachments ?? []}
            primaryVideoId={primaryVideo?.id ?? null}
            groupId={groupId}
          />
        </aside>
      </div>
    </div>
  );
}

interface PlayerSurfaceProps {
  primaryVideoAssetId: string | null;
  isLive: boolean;
  lessonId: string;
  locale: string;
}

function PlayerSurface({
  primaryVideoAssetId,
  isLive,
  lessonId,
  locale,
}: PlayerSurfaceProps) {
  // For a LIVE lesson, the live-session state decides what the main stage
  // shows. The "join live" call-to-action is only useful WHILE the broadcast
  // is on; once it ENDs you can't join, so we feature the recording big in the
  // main stage instead (falling back to a pending/ended notice).
  const liveStatusQuery = useQuery({
    queryKey: ['live-session-status', lessonId],
    queryFn: () => liveApi.getOne(lessonId),
    enabled: isLive,
    retry: false,
    refetchInterval: isLive ? 20_000 : false,
  });

  const recordingsQuery = useQuery({
    queryKey: ['live', 'lesson', lessonId, 'recordings'],
    queryFn: () => liveApi.listRecordings(lessonId),
    enabled: isLive,
    retry: false,
    refetchInterval: isLive ? 30_000 : false,
  });

  if (isLive) {
    const status = liveStatusQuery.data?.session?.status;
    const isLiveNow = status === 'LIVE' || status === 'STARTING';

    // Newest READY recording → featured big in the main stage.
    const recs = [...(recordingsQuery.data ?? [])].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    const readyRecording = recs.find((r) => r.status === 'READY' && r.assetId);
    const finalizing = recs.some((r) => r.status === 'RECORDING');

    // 1) Broadcast is ON → invite the viewer to join.
    if (isLiveNow) {
      return (
        <Card padding="lg" className="flex flex-col items-center text-center">
          <span
            className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-tint text-red"
            aria-hidden="true"
          >
            <Radio className="h-6 w-6" />
          </span>
          <p className="text-sm font-semibold text-ink-strong">
            Bu dars hozir jonli efirda.
          </p>
          <p className="mt-1 text-sm text-ink-soft">
            Jonli efir sahifasida darsga qo&apos;shiling.
          </p>
          <Button
            asChild
            variant="primary"
            className="mt-5"
            leftIcon={<Radio className="h-4 w-4" />}
          >
            <Link href={`/${locale}/live/${lessonId}`}>
              Jonli efirga qo&apos;shilish
            </Link>
          </Button>
        </Card>
      );
    }

    // 2) Broadcast ENDED + a recording is ready → feature it big.
    if (readyRecording?.assetId) {
      return (
        <LessonVideoPlayer
          assetId={readyRecording.assetId}
          lessonId={lessonId}
        />
      );
    }

    // 3) Not live now. HYBRID lessons carry an uploaded recorded video —
    // feature it so the lesson is still watchable between broadcasts.
    if (primaryVideoAssetId) {
      return (
        <LessonVideoPlayer
          assetId={primaryVideoAssetId}
          lessonId={lessonId}
        />
      );
    }

    // 4) Broadcast ENDED, recording still finalizing (or none yet).
    return (
      <Card padding="lg" className="flex flex-col items-center text-center">
        <span
          className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-soft text-ink-soft"
          aria-hidden="true"
        >
          <Video className="h-6 w-6" />
        </span>
        <p className="text-sm font-semibold text-ink-strong">
          {finalizing ? 'Dars yozuvi tayyorlanmoqda' : 'Jonli efir yakunlandi'}
        </p>
        <p className="mt-1 text-sm text-ink-soft">
          {finalizing
            ? "Yozuv tez orada shu yerda paydo bo'ladi."
            : "Bu dars uchun hozircha tayyor yozuv mavjud emas."}
        </p>
      </Card>
    );
  }

  if (!primaryVideoAssetId) {
    return (
      <EmptyState
        icon={<Video className="h-10 w-10" />}
        title="Bu darsda video yo'q"
        description="Quyida matn va biriktirilgan materiallarni ko'rib chiqing."
      />
    );
  }

  // On-demand lesson video — streamed through the same-origin media proxy
  // (entitlement-gated, signed bytes, watermark, no-download).
  return (
    <LessonVideoPlayer assetId={primaryVideoAssetId} lessonId={lessonId} />
  );
}

interface AttachmentsPanelProps {
  attachments: LessonAttachment[];
  primaryVideoId: string | null;
  groupId: string;
}

interface PreviewState {
  assetId: string;
  kind: string;
  name: string;
  downloadAllowed: boolean;
}

/**
 * Resolve the effective Download_Permission for a single attachment.
 *
 * The group-level `downloadAllowed` (server-authoritative, task 4.6 /
 * Req 2.2/6.5) is the primary gate. We combine it with the per-attachment
 * `restrict` caption heuristic so the **most restrictive** wins: a download is
 * only revealed when the group allows downloads AND the attachment isn't
 * individually restricted. The group flag is fail-closed (a missing/loading
 * value resolves to `false`). Non-student previewers (teacher/ADMIN managing
 * their own content) are unaffected by the student gate.
 */
function resolveDownloadAllowed(
  att: LessonAttachment,
  isStudent: boolean,
  groupDownloadAllowed: boolean,
): boolean {
  if (!isStudent) return true;
  const restrictedByCaption = att.caption === 'restrict';
  return groupDownloadAllowed && !restrictedByCaption;
}

function AttachmentsPanel({
  attachments,
  primaryVideoId,
  groupId,
}: AttachmentsPanelProps) {
  const sorted = [...attachments].sort((a, b) => a.position - b.position);
  const supplementary = sorted.filter((a) => a.id !== primaryVideoId);

  const [preview, setPreview] = useState<PreviewState | null>(null);

  const role = getUserRole();
  const isStudent = role === 'STUDENT';

  // Server-authoritative group Download_Permission (task 4.6, Req 2.2/6.5).
  // Reuses the shared `['catalog','group',groupId]` query the rest of the
  // dashboard reads, so the value stays in sync and is cached. Fail-closed:
  // until it resolves (or if the column is absent) downloads stay disabled.
  const groupQuery = useQuery({
    queryKey: ['catalog', 'group', groupId],
    queryFn: () => studentApi.getGroup(groupId),
    enabled: Boolean(groupId),
  });
  const groupDownloadAllowed = groupQuery.data?.downloadAllowed ?? false;

  // No signed/raw storage URL is resolved here. Opening a preview only records
  // the assetId + gating flag; the bytes are streamed through the same-origin
  // BFF inside `ProtectedFileViewer`, so a raw R2 URL never reaches the DOM
  // (Req 2.1/2.4). Download_Permission is server-authoritative; the resolved
  // flag (group gate ∧ not per-attachment restricted) is a display-only mirror.
  const openPreview = useCallback(
    (att: LessonAttachment, downloadAllowed: boolean) => {
      setPreview({
        assetId: att.assetId,
        kind: att.kind,
        name: fileName(att),
        downloadAllowed,
      });
    },
    [],
  );

  return (
    <>
      <Card padding="lg">
        <div className="flex items-center gap-2">
          <Paperclip className="h-4 w-4 text-ink-soft" aria-hidden="true" />
          <h2 className="text-base font-bold tracking-tight text-ink-strong">
            Materiallar
          </h2>
        </div>
        {supplementary.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">
            Qo&apos;shimcha materiallar mavjud emas.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {supplementary.map((att) => {
              const downloadAllowed = resolveDownloadAllowed(
                att,
                isStudent,
                groupDownloadAllowed,
              );
              return (
                <li key={att.id}>
                  <AttachmentLink
                    attachment={att}
                    downloadAllowed={downloadAllowed}
                    onPreview={openPreview}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Preview modal — bytes are streamed through the same-origin BFF inside
          ProtectedFileViewer (fetch → blob: URL), so NO signed / raw storage
          URL ever lands in the DOM (Req 2.1/2.4). The viewer owns
          download/print/selection gating off `downloadAllowed` (Req 2.2/2.3/2.5). */}
      <Dialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      >
        {preview ? (
          <DialogContent size="xl" className="gap-0">
            <DialogHeader className="pb-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="neutral" size="sm">
                  {preview.kind}
                </Badge>
                {preview.downloadAllowed ? (
                  <Badge variant="green" size="sm">
                    <Eye className="h-3 w-3" />
                    Ko&apos;rish va yuklash ochiq
                  </Badge>
                ) : (
                  <Badge variant="orange" size="sm">
                    <Lock className="h-3 w-3" />
                    Yuklab olish cheklangan
                  </Badge>
                )}
              </div>
              <DialogTitle className="mt-1 truncate text-base">
                {preview.name}
              </DialogTitle>
            </DialogHeader>

            <div className="min-h-[350px]">
              <ProtectedFileViewer
                assetId={preview.assetId}
                kind={preview.kind}
                downloadAllowed={preview.downloadAllowed}
                fileName={preview.name}
              />
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}

function AttachmentLink({
  attachment,
  downloadAllowed,
  onPreview,
}: {
  attachment: LessonAttachment;
  downloadAllowed: boolean;
  onPreview: (att: LessonAttachment, downloadAllowed: boolean) => void;
}) {
  // Lock affordance mirrors the resolved gate (group Download_Permission ∧ not
  // per-attachment restricted). Display-only — the BFF enforces the real gate.
  const isRestricted = !downloadAllowed;

  return (
    <button
      type="button"
      onClick={() => onPreview(attachment, downloadAllowed)}
      className="flex w-full items-center justify-between gap-3 rounded-2xl border border-rim bg-canvas px-3 py-2.5 text-left text-sm text-ink-strong transition-all hover:border-blue/40 hover:bg-blue-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue active:scale-[0.99]"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-soft text-ink-soft"
          aria-hidden="true"
        >
          <FileText className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="block truncate font-medium text-ink-strong">
            {attachment.role || 'Material'}
          </span>
          <span className="block text-[11px] uppercase tracking-wide text-ink-faint">
            {attachment.kind}
          </span>
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-ink-soft">
        Ko&apos;rish
        {isRestricted ? (
          <Lock className="h-3.5 w-3.5 text-orange" />
        ) : (
          <Eye className="h-3.5 w-3.5" />
        )}
      </span>
    </button>
  );
}

function fileName(att: LessonAttachment): string {
  const meta = att.asset?.metadata;
  if (meta && typeof meta === 'object' && 'fileName' in meta) {
    return String((meta as Record<string, unknown>).fileName);
  }
  return `${att.kind}-${att.id.slice(0, 8)}`;
}

function MarkWatchedButton({
  lessonId,
  groupId,
}: {
  lessonId: string;
  groupId: string;
}) {
  const queryClient = useQueryClient();
  const progressKey = ['catalog', 'group', groupId, 'progress'] as const;

  // Reuse the same progress query the lesson navigation reads, so completion
  // state stays in sync across the page (server-side source of truth, Req 6.6).
  const progressQuery = useQuery({
    queryKey: progressKey,
    queryFn: () => lessonProgressApi.listGroupProgress(groupId),
  });

  const isWatched = (progressQuery.data ?? []).some(
    (entry) => entry.lessonId === lessonId && entry.completed,
  );

  const mutation = useMutation({
    mutationFn: () => lessonProgressApi.markLessonComplete(lessonId, true),
    onSuccess: () => {
      // Refresh progress (drives nav checkmarks) + enrollment summaries.
      void queryClient.invalidateQueries({ queryKey: progressKey });
      void queryClient.invalidateQueries({
        queryKey: ['student', 'enrollments'],
      });
    },
  });

  const disabled =
    isWatched || mutation.isPending || progressQuery.isLoading;

  return (
    <Button
      type="button"
      variant={isWatched ? 'secondary' : 'outline'}
      onClick={() => mutation.mutate()}
      disabled={disabled}
      loading={mutation.isPending}
      aria-pressed={isWatched}
      {...(isWatched ? { leftIcon: <Check className="h-4 w-4" /> } : {})}
    >
      {isWatched ? "Ko'rib bo'lindi" : "Ko'rib bo'ldim deb belgilash"}
    </Button>
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
