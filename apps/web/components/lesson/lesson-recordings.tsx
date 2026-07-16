'use client';

import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { AlertTriangle, PlayCircle, Radio, Video } from 'lucide-react';

import { Badge } from '../ui/badge';
import { Card } from '../ui/card';
import { EmptyState, ErrorState, LoadingState } from '../states';
import { ApiClientError } from '../../lib/api-client';
import { liveApi, type LessonRecording } from '../../lib/api/live';
import { LessonVideoPlayer } from './lesson-video-player';

interface LessonRecordingsProps {
  lessonId: string;
}

/**
 * LessonRecordings — surfaces the recordings produced by a lesson's ENDED
 * live sessions for on-demand viewing inside the lesson (frontend-redesign
 * Req 6.2).
 *
 * Behaviour:
 *  - Lists the lesson's `Recording` rows via `liveApi.listRecordings`
 *    (BACKEND ASSUMPTION documented there: `GET /live/lessons/:id/recordings`).
 *  - READY recordings (those with an `assetId`) are played through the same
 *    DRM-gated, forensically-watermarked `ProtectedVideoPlayer` the primary
 *    lesson video uses — playback is opened lazily per recording so we only
 *    mint a playback ticket when a student actually presses play.
 *  - RECORDING (still finalizing) and FAILED (RECORDING_FAILED) states are
 *    surfaced inline instead of a broken player, so a missing/failed
 *    recording degrades gracefully.
 *
 * This is mounted ADDITIVELY by `LessonPlayer`; it owns none of the primary
 * video / nav / attachments surfaces (tasks 2.1 / 2.3). When a lesson has no
 * recordings the component renders nothing, so it stays invisible for plain
 * on-demand lessons that never went live.
 */
export function LessonRecordings({ lessonId }: LessonRecordingsProps) {
  const recordingsQuery = useQuery({
    queryKey: ['live', 'lesson', lessonId, 'recordings'],
    queryFn: () => liveApi.listRecordings(lessonId),
  });

  if (recordingsQuery.isLoading) {
    return (
      <Card padding="lg">
        <RecordingsHeader />
        <div className="mt-4">
          <LoadingState variant="list" count={2} label="Yozuvlar yuklanmoqda…" />
        </div>
      </Card>
    );
  }

  if (recordingsQuery.isError) {
    return (
      <Card padding="lg">
        <RecordingsHeader />
        <div className="mt-4">
          <ErrorState
            title="Yozuvlarni yuklab bo'lmadi"
            message={
              recordingsQuery.error instanceof ApiClientError
                ? recordingsQuery.error.message
                : "Jonli efir yozuvlarini yuklashda xatolik yuz berdi."
            }
            retryLabel="Qayta urinish"
            onRetry={() => void recordingsQuery.refetch()}
          />
        </div>
      </Card>
    );
  }

  const recordings = [...(recordingsQuery.data ?? [])].sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  // Stay invisible for lessons that never produced a recording — this keeps
  // the surface additive and out of the way for plain on-demand lessons.
  if (recordings.length === 0) {
    return null;
  }

  return (
    <Card padding="lg">
      <RecordingsHeader />
      <ul className="mt-4 space-y-4">
        {recordings.map((recording, index) => (
          <li key={recording.id}>
            <RecordingItem
              recording={recording}
              lessonId={lessonId}
              index={index}
              total={recordings.length}
            />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function RecordingsHeader() {
  return (
    <div className="flex items-center gap-2">
      <Radio className="h-4 w-4 text-ink-soft" aria-hidden="true" />
      <h2 className="text-base font-bold tracking-tight text-ink-strong">
        Jonli efir yozuvlari
      </h2>
    </div>
  );
}

interface RecordingItemProps {
  recording: LessonRecording;
  lessonId: string;
  index: number;
  total: number;
}

function RecordingItem({
  recording,
  lessonId,
  index,
  total,
}: RecordingItemProps) {
  const [isPlaying, setIsPlaying] = useState(false);

  // Newest recording is #1; label descending so the most recent session
  // reads as the latest take.
  const label = `Yozuv #${total - index}`;
  const meta = formatRecordingMeta(recording);

  // FAILED finalize (RECORDING_FAILED) — no playable asset. Surface a clear,
  // non-blocking notice instead of a broken player (Req 6.2).
  if (recording.status === 'FAILED' || (recording.status === 'READY' && !recording.assetId)) {
    return (
      <RecordingShell label={label} meta={meta}>
        <div className="flex items-start gap-2 rounded-2xl border border-orange/30 bg-orange/5 p-3 text-sm text-ink-soft">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-orange"
            aria-hidden="true"
          />
          <span>
            Bu jonli efir yozuvini tayyorlab bo&apos;lmadi. Iltimos,
            o&apos;qituvchingizga murojaat qiling.
          </span>
        </div>
      </RecordingShell>
    );
  }

  // RECORDING — still being finalized; not yet playable.
  if (recording.status === 'RECORDING' || !recording.assetId) {
    return (
      <RecordingShell label={label} meta={meta}>
        <div className="flex items-center gap-2 rounded-2xl border border-rim bg-soft p-3 text-sm text-ink-soft">
          <Video className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden="true" />
          <span>Yozuv tayyorlanmoqda. Tez orada ko&apos;rish mumkin bo&apos;ladi.</span>
        </div>
      </RecordingShell>
    );
  }

  const assetId = recording.assetId;

  return (
    <RecordingShell label={label} meta={meta} ready>
      {isPlaying ? (
        // Streamed through the same-origin media proxy (signed bytes, watermark).
        <LessonVideoPlayer assetId={assetId} lessonId={lessonId} />
      ) : (
        <button
          type="button"
          onClick={() => setIsPlaying(true)}
          className="group flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-2xl border border-rim bg-canvas text-ink-soft transition-all hover:border-blue/40 hover:bg-blue-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue active:scale-[0.99]"
          aria-label={`${label}ni ko'rish`}
        >
          <PlayCircle className="h-12 w-12 text-blue transition-transform group-hover:scale-105" />
          <span className="text-sm font-semibold text-ink-strong">
            Yozuvni ko&apos;rish
          </span>
        </button>
      )}
    </RecordingShell>
  );
}

function RecordingShell({
  label,
  meta,
  ready,
  children,
}: {
  label: string;
  meta: string | null;
  ready?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-rim p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ink-strong">{label}</span>
          {ready ? (
            <Badge variant="green" size="sm">
              Tayyor
            </Badge>
          ) : null}
        </div>
        {meta ? (
          <span className="text-xs text-ink-faint">{meta}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function formatRecordingMeta(recording: LessonRecording): string | null {
  const parts: string[] = [];
  const created = formatDate(recording.createdAt);
  if (created) parts.push(created);
  const duration = formatDuration(recording.durationMs);
  if (duration) parts.push(duration);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function formatDate(input: string): string | null {
  try {
    return new Date(input).toLocaleDateString('uz-UZ', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return null;
  }
}

function formatDuration(durationMs: number | null): string | null {
  if (!durationMs || durationMs <= 0) return null;
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
