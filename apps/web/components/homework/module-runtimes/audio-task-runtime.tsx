'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Mic,
  Square,
  Volume2,
  RotateCcw,
  Loader2,
  AlertCircle,
  CheckCircle2,
  UploadCloud,
} from 'lucide-react';

import { uploadFile } from '../../../lib/upload';
import { mediaApi } from '../../../lib/api/media';
import type { SubmissionStatus } from '../../../lib/api/homework';
import {
  useAudioRecorder,
  fileExtensionForMime,
  formatDuration,
} from '../../../lib/use-audio-recorder';
import { AudioAiStatus } from './audio-ai-status';

/**
 * Audio-task runtime for SPEAKING and PRONUNCIATION modules
 * (frontend-redesign Req 10.2 / 10.3 / 10.4, Tasks 6.2 + 6.3).
 *
 * Mirrors the teacher builder's `configJson`:
 *   SPEAKING       → { tasks: [{ id, prompt, targetText? }], showTargetText }
 *   PRONUNCIATION  → { tasks: [{ id, prompt, targetText }], targetText }
 *
 * ── Task 6.3 ─────────────────────────────────────────────────────
 * Each task now captures a real microphone recording via the native
 * `MediaRecorder` API (no new deps), offers instant local playback, and
 * uploads the captured blob to a **protected MediaAsset** through the
 * shared `uploadFile` helper (R2 multipart). The returned asset id is
 * stored as `audioMediaId` on the attempt so it persists via the parent
 * `AssignmentRunner`'s debounced autosave — the answer shape is unchanged:
 *   { attempts: [{ taskId, note?, audioMediaId? }] }
 *
 * Once submitted, AI scoring status (in-progress / score / AI-likelihood)
 * is surfaced from the submission via `AudioAiStatus`. Permission-denied
 * and unsupported-browser cases degrade gracefully to the note field.
 */

export interface AudioTask {
  id: string;
  prompt: string;
  targetText?: string | undefined;
  hint?: string | undefined;
}

export interface AudioTaskRuntimeConfig {
  tasks?: AudioTask[] | undefined;
  /** SPEAKING: whether the target text is revealed up front. */
  showTargetText?: boolean | undefined;
  /** PRONUNCIATION: fallback target text when tasks omit their own. */
  targetText?: string | undefined;
}

export interface AudioAttempt {
  taskId: string;
  /** Optional learner note (autosaved). */
  note?: string | undefined;
  /** Protected MediaAsset id for the uploaded recording (Task 6.3). */
  audioMediaId?: string | undefined;
}

export interface AudioTaskRuntimeAnswer {
  attempts: AudioAttempt[];
}

/**
 * AI-relevant slice of the learner's Submission, threaded down by the
 * runner so the audio module can reflect scoring status (Req 10.4).
 * Optional: when omitted (e.g. before any submission), no status is shown.
 */
export interface AudioSubmissionInfo {
  status: SubmissionStatus;
  aiFlagged: boolean;
  aiLikelihood: number | null;
  score: number | null;
  maxPoints?: number | undefined;
}

interface AudioTaskRuntimeProps {
  config: AudioTaskRuntimeConfig;
  initialAnswer: AudioTaskRuntimeAnswer | null;
  editable: boolean;
  onChange: (answer: AudioTaskRuntimeAnswer) => void;
  submission?: AudioSubmissionInfo | undefined;
}

export function AudioTaskRuntime({
  config,
  initialAnswer,
  editable,
  onChange,
  submission,
}: AudioTaskRuntimeProps) {
  const tasks = config.tasks ?? [];
  const [attempts, setAttempts] = useState<AudioAttempt[]>(
    () => initialAnswer?.attempts ?? [],
  );

  useEffect(() => {
    onChange({ attempts });
  }, [attempts, onChange]);

  /** Merge a partial patch into a task's attempt, preserving other fields. */
  const patchAttempt = useCallback(
    (taskId: string, patch: Partial<Omit<AudioAttempt, 'taskId'>>) => {
      setAttempts((prev) => {
        const existing = prev.find((a) => a.taskId === taskId);
        const merged: AudioAttempt = { taskId, ...existing, ...patch };
        const next = prev.filter((a) => a.taskId !== taskId);
        next.push(merged);
        return next;
      });
    },
    [],
  );

  if (tasks.length === 0) {
    return (
      <p className="text-sm text-cream-dim">
        Bu modulda hali topshiriq qo&apos;shilmagan.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {submission ? (
        <AudioAiStatus
          status={submission.status}
          aiFlagged={submission.aiFlagged}
          aiLikelihood={submission.aiLikelihood}
          score={submission.score}
          maxPoints={submission.maxPoints}
        />
      ) : null}

      {tasks.map((task) => {
        const attempt = attempts.find((a) => a.taskId === task.id);
        return (
          <AudioTaskCard
            key={task.id}
            task={task}
            config={config}
            editable={editable}
            note={attempt?.note ?? ''}
            audioMediaId={attempt?.audioMediaId}
            onNoteChange={(note) => patchAttempt(task.id, { note })}
            onAudioUploaded={(audioMediaId) =>
              patchAttempt(task.id, { audioMediaId })
            }
          />
        );
      })}
    </div>
  );
}

type UploadState = 'idle' | 'uploading' | 'uploaded' | 'error';

interface AudioTaskCardProps {
  task: AudioTask;
  config: AudioTaskRuntimeConfig;
  editable: boolean;
  note: string;
  audioMediaId: string | undefined;
  onNoteChange: (note: string) => void;
  onAudioUploaded: (mediaId: string) => void;
}

function AudioTaskCard({
  task,
  config,
  editable,
  note,
  audioMediaId,
  onNoteChange,
  onAudioUploaded,
}: AudioTaskCardProps) {
  const target = task.targetText ?? config.targetText ?? '';
  const showTarget = config.showTargetText ?? Boolean(target);

  const recorder = useAudioRecorder();
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Playback URL for a previously-saved recording (reopened draft / locked).
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const lastUploadedUrlRef = useRef<string | null>(null);

  const speak = useCallback((text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.8;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, []);

  // Resolve a signed playback URL for an already-uploaded asset when there
  // is no fresh local recording to play (e.g. learner reopened a draft).
  useEffect(() => {
    if (!audioMediaId || recorder.recording) {
      return;
    }
    let cancelled = false;
    mediaApi
      .getPlaybackUrl(audioMediaId)
      .then((res) => {
        if (!cancelled) setSavedUrl(res.url);
      })
      .catch(() => {
        if (!cancelled) setSavedUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [audioMediaId, recorder.recording]);

  const uploadAbortRef = useRef<{ cancelled: boolean } | null>(null);

  const startUpload = useCallback(
    (rec: { blob: Blob; mimeType: string }) => {
      // Cancel any prior in-flight upload callback before starting a new one.
      if (uploadAbortRef.current) uploadAbortRef.current.cancelled = true;
      const token = { cancelled: false };
      uploadAbortRef.current = token;

      const ext = fileExtensionForMime(rec.mimeType);
      const file = new File(
        [rec.blob],
        `speaking-${task.id}-${Date.now()}.${ext}`,
        { type: rec.mimeType },
      );

      setUploadState('uploading');
      setUploadProgress(0);
      setUploadError(null);

      uploadFile(file, 'AUDIO', (percent) => {
        if (!token.cancelled) setUploadProgress(percent);
      })
        .then((mediaId) => {
          if (token.cancelled) return;
          setUploadState('uploaded');
          onAudioUploaded(mediaId);
        })
        .catch(() => {
          if (token.cancelled) return;
          setUploadState('error');
          setUploadError('Yuklab boʻlmadi. Qayta urinib koʻring.');
        });
    },
    [task.id, onAudioUploaded],
  );

  // Auto-upload a finished recording exactly once, then store the asset id.
  useEffect(() => {
    const rec = recorder.recording;
    if (!rec) return;
    if (lastUploadedUrlRef.current === rec.url) return;
    lastUploadedUrlRef.current = rec.url;
    startUpload(rec);
  }, [recorder.recording, startUpload]);

  // Abort the in-flight upload callback on unmount.
  useEffect(() => {
    return () => {
      if (uploadAbortRef.current) uploadAbortRef.current.cancelled = true;
    };
  }, []);

  const retryUpload = useCallback(() => {
    const rec = recorder.recording;
    if (rec) startUpload(rec);
  }, [recorder.recording, startUpload]);

  const handleReRecord = useCallback(() => {
    lastUploadedUrlRef.current = null;
    setUploadState('idle');
    setUploadProgress(0);
    setUploadError(null);
    setSavedUrl(null);
    recorder.reset();
  }, [recorder]);

  const localUrl = recorder.recording?.url ?? null;
  const playbackUrl = localUrl ?? savedUrl;
  const hasAudio = Boolean(localUrl) || Boolean(audioMediaId);

  return (
    <div className="space-y-4 rounded-2xl border border-white/[0.07] bg-ink-surface p-4">
      <p className="text-sm font-semibold text-cream">{task.prompt}</p>

      {showTarget && target ? (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.04] px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cream-dim">
                Aytish kerak
              </p>
              <p className="mt-1 text-sm leading-relaxed text-cream">{target}</p>
            </div>
            <button
              type="button"
              onClick={() => speak(target)}
              aria-label="Namuna talaffuzni tinglash"
              className="shrink-0 rounded-xl border border-accent2-500/30 bg-accent2-500/10 p-2 text-accent2-500 transition-colors hover:bg-accent2-500/20"
            >
              <Volume2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}

      {task.hint ? (
        <p className="text-xs italic text-cream-dim">{task.hint}</p>
      ) : null}

      {/* ── Audio recorder (MediaRecorder + protected upload) ── */}
      <div className="space-y-3 rounded-xl border border-white/[0.1] bg-white/[0.02] px-4 py-3">
        {recorder.status === 'unsupported' ? (
          <div className="flex items-start gap-2 text-sm text-cream-dim">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            <span>
              Brauzeringiz ovoz yozishni qoʻllab-quvvatlamaydi. Iltimos, Chrome
              yoki Edge ishlating yoki quyida izoh qoldiring.
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            {editable && recorder.status !== 'recording' ? (
              <button
                type="button"
                onClick={() => void recorder.start()}
                disabled={recorder.status === 'requesting'}
                className="flex items-center gap-2 rounded-xl border border-accent2-500/30 bg-accent2-500/10 px-4 py-2 text-sm font-semibold text-accent2-500 transition-colors hover:bg-accent2-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {recorder.status === 'requesting' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
                {recorder.recording || audioMediaId
                  ? 'Qayta yozish'
                  : 'Ovoz yozish'}
              </button>
            ) : null}

            {editable && recorder.status === 'recording' ? (
              <button
                type="button"
                onClick={() => recorder.stop()}
                className="flex animate-pulse items-center gap-2 rounded-xl bg-red-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-500/90"
              >
                <Square className="h-4 w-4" /> Toʻxtatish
              </button>
            ) : null}

            {recorder.status === 'recording' ? (
              <span className="font-mono text-sm text-red-300">
                ● {formatDuration(recorder.elapsedMs)}
              </span>
            ) : null}

            {playbackUrl ? (
              <audio
                src={playbackUrl}
                controls
                controlsList="nodownload noremoteplayback"
                onContextMenu={(e) => e.preventDefault()}
                className="h-9 min-w-0 flex-1"
              />
            ) : null}

            {editable && recorder.recording ? (
              <button
                type="button"
                onClick={handleReRecord}
                aria-label="Yozuvni tozalash"
                className="rounded-xl border border-white/[0.08] p-2 text-cream-dim transition-colors hover:text-cream"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        )}

        {/* Upload status */}
        {uploadState === 'uploading' ? (
          <div className="flex items-center gap-2 text-xs text-cream-dim">
            <UploadCloud className="h-3.5 w-3.5 animate-pulse" />
            Yuklanmoqda… {uploadProgress}%
          </div>
        ) : null}
        {uploadState === 'uploaded' ? (
          <div className="flex items-center gap-2 text-xs text-green">
            <CheckCircle2 className="h-3.5 w-3.5" /> Ovoz saqlandi
          </div>
        ) : null}
        {uploadState === 'error' ? (
          <div className="flex items-center gap-2 text-xs text-red-300">
            <AlertCircle className="h-3.5 w-3.5" />
            {uploadError ?? 'Yuklab boʻlmadi.'}
            <button
              type="button"
              onClick={retryUpload}
              className="font-semibold text-accent2-500 underline-offset-2 hover:underline"
            >
              Qayta urinish
            </button>
          </div>
        ) : null}

        {/* Permission / device errors from the recorder */}
        {(recorder.status === 'denied' || recorder.status === 'error') &&
        recorder.errorMessage ? (
          <div className="flex items-start gap-2 text-xs text-red-300">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {recorder.errorMessage}
          </div>
        ) : null}

        {!editable && !hasAudio ? (
          <p className="text-xs text-cream-dim">Ovozli javob yuborilmagan.</p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-cream-dim">
          Eslatma (ixtiyoriy)
        </label>
        <textarea
          rows={2}
          value={note}
          disabled={!editable}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder="O'qituvchingiz uchun izoh qoldirishingiz mumkin..."
          className="w-full rounded-xl border border-ink-line bg-white/[0.04] px-4 py-2.5 text-sm text-cream placeholder-cream-dim/60 outline-none focus:border-accent2-500/60 focus:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-70"
        />
      </div>
    </div>
  );
}
