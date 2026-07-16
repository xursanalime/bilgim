'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  File as FileIcon,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  Pause,
  Play,
  RotateCcw,
  Upload,
  X,
} from 'lucide-react';

import {
  attachmentsApi,
  type Attachment,
  type AttachmentKind,
} from '../../lib/api/catalog';
import { ApiClientError } from '../../lib/api-client';
import {
  useResumableUpload,
  type PartState,
} from '../../lib/use-resumable-upload';
import { Button } from '../ui/button';
import { ProgressBar } from '../ui/progress-bar';
import { cn } from '../../lib/utils';

// ═════════════════════════════════════════════════════════════════
// ResumableUploader — chunked/resumable upload UX for lesson videos &
// attachments (Task 4.4, Req 8.4).
//
// Two pieces live here:
//   • ResumableUploadRow — the active upload+attach UI for ONE externally
//     provided File. It drives the useResumableUpload engine, renders
//     progress + pause/resume/retry/cancel, attaches the finished asset to
//     the lesson, and auto-starts on mount. This is reused both by the
//     single-file ResumableUploader and by MultiVideoUploader.
//   • ResumableUploader — the original single-file experience: a dropzone
//     that, once a file is chosen, renders one ResumableUploadRow.
//
// Per-file flow:
//   pick file → init multipart → PUT parts (concurrent, per-part progress)
//   → complete → attach the finished asset to the lesson.
//
// Supports pause/resume, per-part retry of failures, and aborts the
// server-side multipart upload on cancel/unmount via the hook.
//
// ── Backend assumptions (S3/R2 multipart) ──────────────────────────
//   1. `POST /media/uploads` returns one signed PUT URL per part plus the
//      authoritative `partSizeBytes`; `partsCount` in the request equals
//      `ceil(sizeBytes / partSizeBytes)` (both sides assume 5 MiB today).
//   2. The signed part URLs accept a raw `PUT` body with NO required
//      `Content-Type` (File.slice() blobs are sent without one).
//   3. The bucket CORS config exposes the `ETag` response header
//      (`Access-Control-Expose-Headers: ETag`) so the browser can read it
//      and pass it to `POST /media/uploads/:assetId/complete`.
//   4. `POST /media/uploads/:assetId/abort` releases an unfinished upload.
//   5. `POST /catalog/lessons/:lessonId/attachments` accepts
//      `{ assetId, kind }` and links the completed asset to the lesson.
// ═════════════════════════════════════════════════════════════════

type AttachState = 'idle' | 'attaching' | 'attached' | 'error';

// ─────────────────────────────────────────────────────────────────
// ResumableUploadRow — single-file upload engine + UI, externally driven.
// ─────────────────────────────────────────────────────────────────

interface ResumableUploadRowProps {
  /** The file to upload. Auto-starts on mount; treated as immutable. */
  file: File;
  lessonId: string;
  /** Attachment kind to record on the lesson. */
  kind: AttachmentKind;
  /** Called after the asset is uploaded AND attached to the lesson. */
  onAttached?: (attachment: Attachment) => void;
  /**
   * Called when the user dismisses this row (cancel or remove). The parent
   * decides what removal means (back to dropzone / drop from a list). When
   * omitted, the row hides itself.
   */
  onRemove?: () => void;
  /** Override the dismiss button label once the upload has finished. */
  doneRemoveLabel?: string;
  className?: string;
}

export function ResumableUploadRow({
  file,
  lessonId,
  kind,
  onAttached,
  onRemove,
  doneRemoveLabel = 'Remove',
  className,
}: ResumableUploadRowProps) {
  const queryClient = useQueryClient();
  const [attachState, setAttachState] = useState<AttachState>('idle');
  const [attachError, setAttachError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const startedRef = useRef<File | null>(null);

  const attachMutation = useMutation({
    mutationFn: (assetId: string) =>
      attachmentsApi.create(lessonId, { assetId, kind }),
    onMutate: () => {
      setAttachState('attaching');
      setAttachError(null);
    },
    onSuccess: (attachment) => {
      setAttachState('attached');
      queryClient.invalidateQueries({
        queryKey: ['lesson', lessonId, 'attachments'],
      });
      onAttached?.(attachment);
    },
    onError: (err: unknown) => {
      setAttachState('error');
      setAttachError(
        err instanceof ApiClientError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to attach file',
      );
    },
  });

  const upload = useResumableUpload({
    kind,
    onCompleted: (assetId) => {
      attachMutation.mutate(assetId);
    },
  });

  // Auto-start once for the provided file. Running in an effect guarantees the
  // hook reads the correct `kind` for this file before upload begins.
  useEffect(() => {
    if (startedRef.current !== file) {
      startedRef.current = file;
      setAttachState('idle');
      setAttachError(null);
      upload.start(file);
    }
  }, [file, upload]);

  const dismiss = useCallback(() => {
    upload.cancel();
    upload.reset();
    startedRef.current = null;
    if (onRemove) {
      onRemove();
    } else {
      setHidden(true);
    }
  }, [upload, onRemove]);

  if (hidden) return null;

  const Icon = kindIcon(kind);
  const statusText = statusLabel(upload.status, attachState);
  const showError = upload.status === 'error' || attachState === 'error';
  const errorMessage = attachError ?? upload.error;
  const isDone = attachState === 'attached';

  return (
    <div
      className={cn(
        'rounded-2xl border border-rim bg-canvas p-4 shadow-soft',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue/10 text-blue">
          {isDone ? <CheckCircle2 className="h-5 w-5 text-teal" /> : Icon}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-sm font-bold text-ink-strong">
              {upload.fileName ?? file.name}
            </p>
            <span
              className={cn(
                'shrink-0 text-xs font-semibold',
                showError ? 'text-red' : isDone ? 'text-teal' : 'text-blue',
              )}
            >
              {statusText}
            </span>
          </div>

          <div className="mt-2">
            <ProgressBar
              value={upload.status === 'completed' ? 100 : upload.progress}
              color={showError ? 'red' : isDone ? 'green' : 'blue'}
              label={`Upload progress: ${upload.progress}%`}
            />
          </div>

          <div className="mt-1.5 flex items-center justify-between text-xs text-ink-soft">
            <span>
              {formatBytes(upload.uploadedBytes)} /{' '}
              {formatBytes(upload.totalBytes)}
            </span>
            <span>{upload.progress}%</span>
          </div>

          {showError && errorMessage && (
            <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-red">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span className="break-words">{errorMessage}</span>
            </p>
          )}

          {/* Per-part progress grid */}
          {upload.parts.length > 1 && (
            <div
              className="mt-3 flex flex-wrap gap-1"
              aria-label="Per-part upload status"
            >
              {upload.parts.map((p) => (
                <PartCell key={p.partNumber} part={p} />
              ))}
            </div>
          )}

          {/* Controls */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {upload.canPause && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                leftIcon={<Pause className="h-4 w-4" />}
                onClick={() => upload.pause()}
              >
                Pause
              </Button>
            )}
            {upload.canResume && (
              <Button
                type="button"
                size="sm"
                variant="primary"
                leftIcon={<Play className="h-4 w-4" />}
                onClick={() => upload.resume()}
              >
                Resume
              </Button>
            )}
            {upload.status === 'error' && upload.canRetry && (
              <Button
                type="button"
                size="sm"
                variant="primary"
                leftIcon={<RotateCcw className="h-4 w-4" />}
                onClick={() => upload.retry()}
              >
                Retry
              </Button>
            )}
            {attachState === 'error' && upload.assetId && (
              <Button
                type="button"
                size="sm"
                variant="primary"
                leftIcon={<RotateCcw className="h-4 w-4" />}
                onClick={() => {
                  if (upload.assetId) attachMutation.mutate(upload.assetId);
                }}
              >
                Retry attach
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant={isDone ? 'secondary' : 'ghost'}
              leftIcon={<X className="h-4 w-4" />}
              onClick={dismiss}
            >
              {isDone ? doneRemoveLabel : 'Cancel'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// ResumableUploader — single-file dropzone wrapper around one row.
// ─────────────────────────────────────────────────────────────────

interface ResumableUploaderProps {
  lessonId: string;
  /** Called after the asset is uploaded AND attached to the lesson. */
  onAttached?: (attachment: Attachment) => void;
  /** Optional `accept` filter for the file input. */
  accept?: string;
  className?: string;
}

export function ResumableUploader({
  lessonId,
  onAttached,
  accept,
  className,
}: ResumableUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const pickFiles = useCallback((files: FileList | null) => {
    const next = files?.[0];
    if (next) setFile(next);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      pickFiles(e.dataTransfer.files);
    },
    [pickFiles],
  );

  const clear = useCallback(() => {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  // ── Active / finished state: delegate to one row ──────────────
  if (file) {
    return (
      <ResumableUploadRow
        file={file}
        lessonId={lessonId}
        kind={detectKind(file)}
        {...(onAttached ? { onAttached } : {})}
        onRemove={clear}
        doneRemoveLabel="Upload another"
        {...(className ? { className } : {})}
      />
    );
  }

  // ── Empty state: dropzone ──────────────────────────────────────
  return (
    <div className={className}>
      <div
        role="button"
        tabIndex={0}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition-all',
          isDragging
            ? 'border-blue bg-blue/10'
            : 'border-rim hover:border-blue/40 hover:bg-blue/5',
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          {...(accept ? { accept } : {})}
          onChange={(e) => pickFiles(e.target.files)}
          className="hidden"
        />
        <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue/10 text-blue">
          <Upload className="h-5 w-5" />
        </span>
        <p className="text-sm font-bold text-ink-strong">
          Videoni bu yerga tashlang yoki tanlang
        </p>
        <p className="mt-1 text-xs text-ink-faint">
          Large files upload in resumable chunks with pause &amp; retry
        </p>
      </div>
    </div>
  );
}

function PartCell({ part }: { part: PartState }) {
  const pct =
    part.size > 0 ? Math.round((part.loaded / part.size) * 100) : 0;
  const title =
    part.status === 'error'
      ? `Part ${part.partNumber}: ${part.error ?? 'failed'}`
      : `Part ${part.partNumber}: ${
          part.status === 'done' ? 'done' : `${pct}%`
        }`;
  return (
    <span
      title={title}
      className={cn(
        'h-2 w-4 rounded-sm transition-colors',
        part.status === 'done' && 'bg-teal',
        part.status === 'uploading' && 'bg-blue',
        part.status === 'error' && 'bg-red',
        part.status === 'pending' && 'bg-soft',
      )}
    />
  );
}

function statusLabel(
  status: ReturnType<typeof useResumableUpload>['status'],
  attach: AttachState,
): string {
  if (attach === 'attaching') return 'Attaching…';
  if (attach === 'attached') return 'Done';
  if (attach === 'error') return 'Attach failed';
  switch (status) {
    case 'initializing':
      return 'Preparing…';
    case 'uploading':
      return 'Uploading…';
    case 'paused':
      return 'Paused';
    case 'completing':
      return 'Finishing…';
    case 'completed':
      return 'Uploaded';
    case 'error':
      return 'Error';
    case 'aborted':
      return 'Canceled';
    default:
      return '';
  }
}

export function detectKind(file: File): AttachmentKind {
  const t = file.type.toLowerCase();
  if (t.startsWith('video/')) return 'VIDEO';
  if (t.startsWith('audio/')) return 'AUDIO';
  if (t.startsWith('image/')) return 'IMAGE';
  if (t === 'application/pdf') return 'PDF';
  if (t.includes('word') || t.includes('document')) return 'DOC';
  if (t.includes('sheet') || t.includes('excel') || t.includes('csv'))
    return 'SHEET';
  return 'OTHER';
}

function kindIcon(kind: AttachmentKind) {
  switch (kind) {
    case 'VIDEO':
    case 'RECORDING':
      return <FileVideo className="h-5 w-5" />;
    case 'AUDIO':
      return <FileAudio className="h-5 w-5" />;
    case 'IMAGE':
      return <FileImage className="h-5 w-5" />;
    case 'PDF':
    case 'DOC':
      return <FileText className="h-5 w-5" />;
    default:
      return <FileIcon className="h-5 w-5" />;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
