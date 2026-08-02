'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSWRConfig } from 'swr';
import {
  Upload,
  FileVideo,
  Loader2,
  Trash2,
  ExternalLink,
  Paperclip,
  AlertCircle,
} from 'lucide-react';

import {
  attachmentsApi,
  mediaApi,
  type AttachmentKind,
  type Attachment,
} from '../../lib/api/catalog';
import { homeworkApi } from '../../lib/api/homework';
import { apiClient, ApiClientError } from '../../lib/api-client';
import { resolveContentType } from '../../lib/media-content-type';
import { cn } from '../../lib/utils';
import { KIND_COLOR, kindIcon, attachmentFileName as fileName, formatBytes } from '../../lib/attachment-display';
import { HlsPlayer } from '../lesson/hls-player';
import {
  AttachmentPreviewModal,
  type AttachmentPreviewState as PreviewState,
} from '../lesson/attachment-preview-modal';

type PlaybackUrlType = 'manifest' | 'variant' | 'original';

interface AssignmentMaterialsProps {
  assignmentId: string;
  /** Teacher management view (upload/delete/note) vs read-only student view. */
  editable: boolean;
  /** Pre-fetched list — lets the assignment-view page avoid a second
   * round trip when it already loaded attachments via `GET /assignments/:id`. */
  initialAttachments?: Attachment[] | undefined;
  /** Current `Assignment.description` — edited here (teacher only) via the
   * same field the read-only "Topshiriq tavsifi" block elsewhere displays,
   * mirroring how `LessonMaterials` edits `Lesson.description` inline. */
  initialDescription?: string | null | undefined;
}

interface UploadProgress {
  fileName: string;
  loaded: number;
  total: number;
  status: 'uploading' | 'completing' | 'attaching' | 'error' | 'done';
  error?: string;
}

const PART_SIZE = 5 * 1024 * 1024; // 5 MiB

const isVideoKind = (kind: AttachmentKind) => kind === 'VIDEO' || kind === 'RECORDING';

/**
 * Instructional files (video/PDF/image/office docs) a teacher attaches
 * to an Assignment alongside its text description — the "how" a
 * homework can be given beyond plain text. Mirrors `LessonMaterials`
 * exactly (same upload pipeline, same preview UX), scoped to an
 * assignment instead of a lesson.
 */
export function AssignmentMaterials({
  assignmentId,
  editable,
  initialAttachments,
  initialDescription,
}: AssignmentMaterialsProps) {
  const queryClient = useQueryClient();
  const { mutate } = useSWRConfig();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [description, setDescription] = useState(initialDescription ?? '');
  const [descDirty, setDescDirty] = useState(false);
  const [descSaved, setDescSaved] = useState(false);
  const seededDescRef = useRef(false);
  if (!seededDescRef.current && initialDescription !== undefined) {
    seededDescRef.current = true;
    setDescription(initialDescription ?? '');
  }

  const saveDescriptionMutation = useMutation({
    mutationFn: (value: string) =>
      homeworkApi.updateAssignment(assignmentId, {
        description: value.trim() || null,
      }),
    onSuccess: () => {
      setDescDirty(false);
      setDescSaved(true);
      void mutate(['homework:assignment', assignmentId]);
    },
  });

  const [isDragging, setIsDragging] = useState(false);
  const [uploads, setUploads] = useState<Record<string, UploadProgress>>({});
  const isUploadInProgress = Object.values(uploads).some(
    (u) => u.status === 'uploading' || u.status === 'completing' || u.status === 'attaching',
  );

  useEffect(() => {
    if (!isUploadInProgress) return undefined;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isUploadInProgress]);

  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [loadingPreview, setLoadingPreview] = useState<string | null>(null);

  const openPreviewFile = useCallback((next: PreviewState) => {
    setPreview(next);
  }, []);

  const attachmentsQuery = useQuery({
    queryKey: ['assignment', assignmentId, 'attachments'],
    queryFn: () => attachmentsApi.listForAssignment(assignmentId),
    initialData: initialAttachments,
    refetchInterval: (query) => {
      const attachments = query.state.data;
      const isProcessing = attachments?.some(
        (a) => a.asset.status === 'UPLOADING' || a.asset.status === 'TRANSCODING',
      );
      return isProcessing ? 3000 : false;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => attachmentsApi.remove(id),
    onSuccess: (_data, deletedId) => {
      // Patch the cache directly rather than relying solely on
      // `invalidateQueries` — this query is seeded with a non-memoized
      // `initialData` prop from the parent (re-derived from its own SWR
      // cache), which can otherwise race a refetch and reintroduce the
      // just-deleted row, making the delete button look like a no-op.
      queryClient.setQueryData<Attachment[]>(
        ['assignment', assignmentId, 'attachments'],
        (prev) => (prev ?? []).filter((a) => a.id !== deletedId),
      );
      queryClient.invalidateQueries({
        queryKey: ['assignment', assignmentId, 'attachments'],
      });
    },
  });

  const openPreview = useCallback(async (att: Attachment) => {
    setLoadingPreview(att.id);
    try {
      const res = await apiClient.get<{ url: string; type: PlaybackUrlType }>(
        `/media/assets/${att.assetId}/url`,
      );
      openPreviewFile({
        url: res.url,
        type: res.type,
        kind: att.kind,
        name: fileName(att),
      });
    } catch {
      window.open(`/api/v1/media/assets/${att.assetId}/url`, '_blank');
    } finally {
      setLoadingPreview(null);
    }
  }, [openPreviewFile]);

  const uploadFile = useCallback(
    async (file: File) => {
      const uploadKey = `${file.name}-${Date.now()}`;
      const kind = detectKind(file);
      const partsCount = Math.max(1, Math.ceil(file.size / PART_SIZE));

      setUploads((prev) => ({
        ...prev,
        [uploadKey]: {
          fileName: file.name,
          loaded: 0,
          total: file.size,
          status: 'uploading',
        },
      }));

      try {
        const init = await mediaApi.initUpload({
          fileName: file.name,
          contentType: resolveContentType(file),
          sizeBytes: file.size,
          partsCount,
          kind,
        });

        const completedParts: { partNumber: number; etag: string }[] = [];
        let uploadedBytes = 0;

        for (const part of init.partUrls) {
          const start = (part.partNumber - 1) * PART_SIZE;
          const end = Math.min(start + PART_SIZE, file.size);
          const blob = file.slice(start, end);

          const res = await fetch(part.url, {
            method: 'PUT',
            body: blob,
          });

          if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(
              `Part ${part.partNumber} HTTP ${res.status}: ${body.slice(0, 200) || res.statusText}`,
            );
          }

          const etag = res.headers.get('etag')?.replace(/"/g, '') ?? '';
          completedParts.push({ partNumber: part.partNumber, etag });
          uploadedBytes += blob.size;

          setUploads((prev) => ({
            ...prev,
            [uploadKey]: { ...prev[uploadKey]!, loaded: uploadedBytes },
          }));
        }

        setUploads((prev) => ({
          ...prev,
          [uploadKey]: { ...prev[uploadKey]!, status: 'completing' },
        }));

        await mediaApi.completeUpload(init.assetId, completedParts);

        setUploads((prev) => ({
          ...prev,
          [uploadKey]: { ...prev[uploadKey]!, status: 'attaching' },
        }));

        await attachmentsApi.createForAssignment(assignmentId, {
          assetId: init.assetId,
          kind,
        });

        setUploads((prev) => ({
          ...prev,
          [uploadKey]: { ...prev[uploadKey]!, status: 'done' },
        }));

        queryClient.invalidateQueries({
          queryKey: ['assignment', assignmentId, 'attachments'],
        });

        setTimeout(() => {
          setUploads((prev) => {
            const next = { ...prev };
            delete next[uploadKey];
            return next;
          });
        }, 1500);
      } catch (err) {
        const message =
          err instanceof ApiClientError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Yuklashda xatolik';
        setUploads((prev) => ({
          ...prev,
          [uploadKey]: { ...prev[uploadKey]!, status: 'error', error: message },
        }));
      }
    },
    [assignmentId, queryClient],
  );

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      Array.from(files).forEach((file) => void uploadFile(file));
    },
    [uploadFile],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const attachments = attachmentsQuery.data ?? [];
  const videoAttachments = attachments.filter((a) => isVideoKind(a.kind));
  const otherAttachments = attachments.filter((a) => !isVideoKind(a.kind));
  const uploadEntries = Object.entries(uploads);

  if (!editable && attachments.length === 0 && !attachmentsQuery.isLoading) {
    return null;
  }

  return (
    <>
      <section className="rounded-[2rem] border border-rim bg-white p-6 shadow-soft">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-tint">
              <Paperclip className="h-5 w-5 text-blue" />
            </div>
            <h2 className="font-display text-sm font-extrabold text-ink-strong">
              Materiallar
            </h2>
          </div>
          <span className="text-xs font-bold uppercase tracking-wider text-ink-faint">
            {attachments.length} ta fayl
          </span>
        </div>

        {editable && (
          <div className="mt-5">
            <textarea
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setDescDirty(true);
                setDescSaved(false);
              }}
              onBlur={() => {
                if (descDirty && !saveDescriptionMutation.isPending) {
                  saveDescriptionMutation.mutate(description);
                }
              }}
              placeholder="Talabaga tushuntirish yozing... (masalan: 1-video namuna, 2-fayl mashqlar)"
              rows={2}
              className="w-full rounded-2xl border border-rim bg-tint/40 px-4 py-3 text-sm text-ink-strong placeholder-ink-faint outline-none transition-colors focus:border-blue/40 focus:bg-canvas focus:ring-2 focus:ring-blue/10 resize-none"
            />
            <div className="mt-1.5 flex items-center justify-between">
              <span className="text-xs font-medium">
                {saveDescriptionMutation.isPending ? (
                  <span className="text-ink-soft">Saqlanmoqda…</span>
                ) : saveDescriptionMutation.isError ? (
                  <span className="text-red">Saqlashda xatolik</span>
                ) : descDirty ? (
                  <span className="text-ink-soft">Saqlanmagan o&apos;zgarishlar</span>
                ) : descSaved ? (
                  <span className="text-teal">✓ Izoh saqlandi</span>
                ) : null}
              </span>
              {descDirty && (
                <button
                  type="button"
                  onClick={() => saveDescriptionMutation.mutate(description)}
                  disabled={saveDescriptionMutation.isPending}
                  className="rounded-lg bg-blue px-3 py-1 text-xs font-bold text-white transition-colors hover:bg-blue-600 disabled:opacity-60"
                >
                  Saqlash
                </button>
              )}
            </div>
          </div>
        )}

        {editable && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              'mt-4 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition-all',
              isDragging
                ? 'border-blue bg-blue-tint scale-[1.01]'
                : 'border-rim hover:border-blue/40 hover:bg-blue-tint/40',
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={(e) => handleFiles(e.target.files)}
              className="hidden"
            />
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-tint">
              <Upload className="h-5 w-5 text-blue" />
            </div>
            <p className="mt-3 text-sm font-bold text-ink-strong">
              Faylni bu yerga tashlang yoki bosing
            </p>
            <p className="mt-1 text-xs text-ink-soft">
              Video, audio, rasm, PDF, DOC, XLSX
            </p>
          </div>
        )}

        {uploadEntries.length > 0 && (
          <ul className="mt-4 space-y-2">
            {uploadEntries.map(([key, progress]) => (
              <li key={key} className="rounded-2xl border border-rim bg-tint/40 p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-bold text-ink-strong">
                    {progress.fileName}
                  </span>
                  <span className="shrink-0 text-xs font-bold text-ink-soft">
                    {statusLabel(progress)}
                  </span>
                </div>
                {progress.status !== 'error' && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-soft">
                    <div
                      className="h-full bg-blue transition-[width]"
                      style={{ width: `${(progress.loaded / progress.total) * 100}%` }}
                    />
                  </div>
                )}
                {progress.error && (
                  <p className="mt-2 text-xs text-red">{progress.error}</p>
                )}
              </li>
            ))}
          </ul>
        )}

        {attachmentsQuery.isLoading && (
          <p className="mt-4 text-sm text-ink-soft">Yuklanmoqda…</p>
        )}
        {attachments.length === 0 &&
          editable &&
          !attachmentsQuery.isLoading &&
          uploadEntries.length === 0 && (
            <p className="mt-4 text-sm text-ink-soft">
              Hali fayllar qo&apos;shilmagan.
            </p>
          )}

        {videoAttachments.length > 0 && (
          <div className="mt-5 space-y-4">
            {videoAttachments.map((att) => (
              <VideoAttachmentCard
                key={att.id}
                attachment={att}
                editable={editable}
                onDelete={() => deleteMutation.mutate(att.id)}
                isDeleting={deleteMutation.isPending}
              />
            ))}
          </div>
        )}

        {otherAttachments.length > 0 && (
          <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {otherAttachments.map((att) => (
              <li key={att.id}>
                <div className="group flex items-center justify-between gap-3 rounded-2xl border border-rim bg-canvas p-3.5 transition-all hover:-translate-y-0.5 hover:shadow-soft hover:border-blue/20">
                  <button
                    type="button"
                    onClick={() => openPreview(att)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <span
                      className={cn(
                        'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                        KIND_COLOR[att.kind],
                      )}
                    >
                      {loadingPreview === att.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        kindIcon(att.kind)
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-ink-strong">
                        {fileName(att)}
                      </p>
                      <p className="text-xs text-ink-soft">
                        {formatBytes(att.asset.bytes)} ·{' '}
                        <StatusBadge status={att.asset.status} />
                      </p>
                    </div>
                    <ExternalLink className="ml-auto h-3.5 w-3.5 shrink-0 text-ink-faint opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                  {editable && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteMutation.mutate(att.id);
                      }}
                      disabled={deleteMutation.isPending}
                      className="shrink-0 rounded-lg p-2 text-ink-soft transition-colors hover:bg-red-tint hover:text-red"
                      aria-label="O'chirish"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AttachmentPreviewModal preview={preview} onClose={() => setPreview(null)} />
    </>
  );
}

interface VideoAttachmentCardProps {
  attachment: Attachment;
  editable: boolean;
  onDelete: () => void;
  isDeleting: boolean;
}

function VideoAttachmentCard({
  attachment,
  editable,
  onDelete,
  isDeleting,
}: VideoAttachmentCardProps) {
  const isReady =
    attachment.asset.status === 'READY' || attachment.asset.status === 'UPLOADED';
  const isFailed = attachment.asset.status === 'FAILED';

  const urlQuery = useQuery({
    queryKey: ['media-asset-url', attachment.assetId],
    queryFn: () =>
      apiClient.get<{ url: string; type: PlaybackUrlType }>(
        `/media/assets/${attachment.assetId}/url`,
      ),
    enabled: isReady,
  });

  return (
    <div className="overflow-hidden rounded-2xl border border-rim bg-canvas">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-tint text-blue">
            <FileVideo className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-ink-strong">
              {fileName(attachment)}
            </p>
            <p className="text-xs text-ink-soft">
              {formatBytes(attachment.asset.bytes)} ·{' '}
              <StatusBadge status={attachment.asset.status} />
            </p>
          </div>
        </div>
        {editable && (
          <button
            type="button"
            onClick={onDelete}
            disabled={isDeleting}
            className="shrink-0 rounded-lg p-2 text-ink-soft transition-colors hover:bg-red-tint hover:text-red"
            aria-label="O'chirish"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {isReady ? (
        urlQuery.data ? (
          <HlsPlayer
            src={urlQuery.data.url}
            type={urlQuery.data.type}
            className="aspect-video w-full"
          />
        ) : (
          <div className="flex aspect-video w-full items-center justify-center bg-tint-strong/95">
            <Loader2 className="h-6 w-6 animate-spin text-white/70" />
          </div>
        )
      ) : isFailed ? (
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 bg-red-tint">
          <AlertCircle className="h-5 w-5 text-red" />
          <p className="text-xs font-medium text-red">
            Videoni qayta ishlashda xatolik yuz berdi
          </p>
        </div>
      ) : (
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 bg-tint">
          <Loader2 className="h-5 w-5 animate-spin text-ink-faint" />
          <p className="text-xs font-medium text-ink-soft">
            Video qayta ishlanmoqda…
          </p>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const isReady = status === 'READY' || status === 'UPLOADED';
  return (
    <span
      className={
        isReady
          ? 'text-teal'
          : status === 'TRANSCODING'
            ? 'text-orange'
            : status === 'FAILED'
              ? 'text-red'
              : 'text-ink-soft'
      }
    >
      {status === 'READY'
        ? 'Tayyor'
        : status === 'UPLOADED'
          ? 'Yuklandi'
          : status === 'TRANSCODING'
            ? 'Qayta ishlanmoqda'
            : status === 'FAILED'
              ? 'Xatolik'
              : status}
    </span>
  );
}

function statusLabel(p: UploadProgress): string {
  if (p.status === 'error') return 'Xatolik';
  if (p.status === 'done') return 'Tayyor';
  if (p.status === 'completing') return 'Yakunlanmoqda…';
  if (p.status === 'attaching') return 'Biriktirilmoqda…';
  return `${Math.round((p.loaded / p.total) * 100)}%`;
}

function detectKind(file: File): AttachmentKind {
  const t = resolveContentType(file).toLowerCase();
  if (t.startsWith('video/')) return 'VIDEO';
  if (t.startsWith('audio/')) return 'AUDIO';
  if (t.startsWith('image/')) return 'IMAGE';
  if (t === 'application/pdf') return 'PDF';
  if (t.includes('word') || t.includes('document')) return 'DOC';
  if (t.includes('sheet') || t.includes('excel') || t.includes('csv'))
    return 'SHEET';
  return 'OTHER';
}
