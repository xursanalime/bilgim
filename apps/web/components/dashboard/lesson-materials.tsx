'use client';

import { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';import {
  Upload,
  File,
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  Loader2,
  Trash2,
  X,
  ExternalLink,
  Lock,
  Unlock,
} from 'lucide-react';

import {
  attachmentsApi,
  mediaApi,
  lessonsApi,
  type AttachmentKind,
  type Attachment,
} from '../../lib/api/catalog';
import { apiClient, ApiClientError } from '../../lib/api-client';
import { cn } from '../../lib/utils';
import { useFocusTrap } from '../../lib/a11y/use-focus-trap';

interface LessonMaterialsProps {
  lessonId: string;
}

interface UploadProgress {
  fileName: string;
  loaded: number;
  total: number;
  status: 'uploading' | 'completing' | 'attaching' | 'error' | 'done';
  error?: string;
}

interface PreviewState {
  url: string;
  kind: AttachmentKind;
  name: string;
}

const PART_SIZE = 5 * 1024 * 1024; // 5 MiB

export function LessonMaterials({ lessonId }: LessonMaterialsProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploads, setUploads] = useState<Record<string, UploadProgress>>({});
  const [description, setDescription] = useState('');
  const [descDirty, setDescDirty] = useState(false);
  const [descSaved, setDescSaved] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [loadingPreview, setLoadingPreview] = useState<string | null>(null);

  const attachmentsQuery = useQuery({
    queryKey: ['lesson', lessonId, 'attachments'],
    queryFn: () => attachmentsApi.listForLesson(lessonId),
  });

  // Load the lesson so we can seed (and later persist) the materials note,
  // which is stored on the lesson's `description` field. Without this the
  // textarea reset to empty on every reload.
  const lessonQuery = useQuery({
    queryKey: ['lesson', lessonId, 'detail'],
    queryFn: () => lessonsApi.get(lessonId),
  });

  // Seed the textarea from the persisted description exactly once after the
  // lesson loads, unless the user has already started editing.
  const seededRef = useRef(false);
  if (!seededRef.current && lessonQuery.data) {
    seededRef.current = true;
    setDescription(lessonQuery.data.description ?? '');
  }

  const saveDescriptionMutation = useMutation({
    mutationFn: (value: string) =>
      lessonsApi.update(lessonId, { description: value.trim() || null }),
    onSuccess: () => {
      setDescDirty(false);
      setDescSaved(true);
      queryClient.invalidateQueries({
        queryKey: ['lesson', lessonId, 'detail'],
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => attachmentsApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['lesson', lessonId, 'attachments'],
      });
    },
  });

  const toggleDownloadMutation = useMutation({
    mutationFn: ({ id, restrict }: { id: string; restrict: boolean }) =>
      attachmentsApi.update(id, { caption: restrict ? 'restrict' : 'allow' }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['lesson', lessonId, 'attachments'],
      });
    },
  });

  const openPreview = useCallback(async (att: Attachment) => {
    setLoadingPreview(att.id);
    try {
      const res = await apiClient.get<{ url: string }>(
        `/media/assets/${att.assetId}/url`,
      );
      setPreview({
        url: res.url,
        kind: att.kind,
        name: fileName(att),
      });
    } catch {
      // Fallback: open in new tab if we can't get signed URL
      window.open(`/api/v1/media/assets/${att.assetId}/url`, '_blank');
    } finally {
      setLoadingPreview(null);
    }
  }, []);

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
          contentType: file.type || 'application/octet-stream',
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

        await attachmentsApi.create(lessonId, { assetId: init.assetId, kind });

        setUploads((prev) => ({
          ...prev,
          [uploadKey]: { ...prev[uploadKey]!, status: 'done' },
        }));

        queryClient.invalidateQueries({
          queryKey: ['lesson', lessonId, 'attachments'],
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
    [lessonId, queryClient],
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
  const uploadEntries = Object.entries(uploads);

  // Custom (non-Radix) preview overlay: trap focus while open, close on Esc,
  // and restore focus to the opener when it closes (Req 7.1, 7.2, 7.3).
  useFocusTrap(previewRef, {
    active: preview !== null,
    onClose: () => setPreview(null),
  });

  return (
    <>
      <section className="group relative rounded-[2.5rem] border border-rim/50 bg-white/60 p-8 shadow-xl backdrop-blur-xl sm:p-10 lg:p-12 overflow-visible">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-extrabold text-ink-strong tracking-tight">Dars Materiallari</h2>
          <span className="rounded-full bg-purple/10 text-purple px-3 py-1 text-xs font-extrabold uppercase tracking-wider">
            {attachments.length} ta fayl
          </span>
        </div>

        {/* Description / notes for the lesson materials */}
        <div className="mt-6">
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
            placeholder="Materiallar haqida izoh yozing... (masalan: 1-rasm grammatika qoidalari, 2-fayl darslik mashqlari)"
            rows={2}
            className="w-full rounded-2xl border border-white/60 bg-white/50 px-5 py-4 text-sm text-ink-strong placeholder-ink-faint outline-none focus:border-blue/40 focus:ring-4 focus:ring-blue/10 resize-none transition-all shadow-inner focus:bg-white"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs font-medium">
              {saveDescriptionMutation.isPending ? (
                <span className="text-ink-soft">Saqlanmoqda…</span>
              ) : saveDescriptionMutation.isError ? (
                <span className="text-red">Saqlashda xatolik</span>
              ) : descDirty ? (
                <span className="text-ink-soft">Saqlanmagan o&apos;zgarishlar</span>
              ) : descSaved ? (
                <span className="text-teal font-semibold flex items-center gap-1">✓ Izoh muvaffaqiyatli saqlandi</span>
              ) : null}
            </span>
            {descDirty && (
              <button
                type="button"
                onClick={() => saveDescriptionMutation.mutate(description)}
                disabled={saveDescriptionMutation.isPending}
                className="rounded-xl bg-gradient-to-r from-blue to-purple px-4 py-1.5 text-xs font-bold text-white transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5 active:scale-95 disabled:opacity-60"
              >
                Saqlash
              </button>
            )}
          </div>
        </div>

        {/* Drop zone */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={(e) => handleFiles(e.target.files)}
          className="hidden"
        />
        <button
          type="button"
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`mt-6 flex w-full cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 text-center transition-all duration-300 ${
            isDragging
              ? 'border-blue bg-blue/10 scale-[1.02] shadow-[0_0_20px_rgba(0,113,227,0.15)]'
              : 'border-rim hover:border-blue/40 hover:bg-blue/5 hover:scale-[1.01]'
          }`}
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue/10 text-blue mb-3 transition-transform group-hover:scale-110">
            <Upload className="h-6 w-6 animate-bounce" style={{ animationDuration: '2s' }} />
          </div>
          <p className="text-sm font-extrabold text-ink-strong">
            Faylni bu yerga sudrab tashlang yoki bosing
          </p>
          <p className="mt-1 text-xs text-ink-faint font-medium">
            Video, audio, rasm, PDF, DOC, XLSX formatlari qo'llab-quvvatlanadi
          </p>
        </button>

        {/* Upload progress */}
        {uploadEntries.length > 0 && (
          <ul className="mt-6 space-y-3">
            {uploadEntries.map(([key, progress]) => (
              <li key={key} className="rounded-2xl border border-white/60 bg-white/50 p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-bold text-ink-strong">
                    {progress.fileName}
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-blue">
                    {statusLabel(progress)}
                  </span>
                </div>
                {progress.status !== 'error' && (
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-soft shadow-inner">
                    <div
                      className="h-full bg-gradient-to-r from-blue to-purple transition-[width] duration-300"
                      style={{ width: `${(progress.loaded / progress.total) * 100}%` }}
                    />
                  </div>
                )}
                {progress.error && (
                  <p className="mt-2 text-xs font-semibold text-red">{progress.error}</p>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Existing attachments */}
        {attachments.length > 0 && (
          <ul className="mt-6 space-y-3">
            {attachments.map((att) => (
              <li
                key={att.id}
                className="flex items-center justify-between gap-4 rounded-2xl border border-white/60 bg-white/50 p-4 shadow-sm hover:bg-white/80 transition-all duration-300 hover:scale-[1.01]"
              >
                <button
                  type="button"
                  onClick={() => openPreview(att)}
                  className="flex min-w-0 flex-1 items-center gap-4 text-left group"
                >
                  <span className={cn(
                    "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl shadow-inner transition-transform group-hover:scale-105",
                    iconBackgroundClass(att.kind)
                  )}>
                    {loadingPreview === att.id ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      kindIcon(att.kind)
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-ink-strong group-hover:text-blue transition-colors">
                      {fileName(att)}
                    </p>
                    <p className="text-xs text-ink-soft font-medium mt-0.5 flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold uppercase tracking-wider text-[10px] text-ink-faint">
                        {att.kind}
                      </span>
                      <span className="text-ink-faint">·</span>
                      <span>{formatBytes(att.asset.bytes)}</span>
                      <span className="text-ink-faint">·</span>
                      <span className="font-semibold">
                        <StatusBadge status={att.asset.status} />
                      </span>
                    </p>
                  </div>
                  <ExternalLink className="ml-auto h-4 w-4 shrink-0 text-ink-faint group-hover:text-blue group-hover:translate-x-0.5 transition-all" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    const restrict = att.caption !== 'restrict';
                    toggleDownloadMutation.mutate({ id: att.id, restrict });
                  }}
                  disabled={toggleDownloadMutation.isPending}
                  className={cn(
                    "shrink-0 flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-all border",
                    att.caption === 'restrict'
                      ? "border-red/20 bg-red/5 text-red hover:bg-red/10"
                      : "border-teal/20 bg-teal/5 text-teal hover:bg-teal/10"
                  )}
                  title={att.caption === 'restrict' ? "Talabalar bu faylni yuklab ololmaydi, faqat ko'ra oladi" : "Talabalar bu faylni yuklab olishi mumkin"}
                >
                  {toggleDownloadMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : att.caption === 'restrict' ? (
                    <>
                      <Lock className="h-3.5 w-3.5" />
                      Faqat ko&apos;rish
                    </>
                  ) : (
                    <>
                      <Unlock className="h-3.5 w-3.5" />
                      Yuklab olish ochiq
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteMutation.mutate(att.id);
                  }}
                  disabled={deleteMutation.isPending}
                  className="shrink-0 rounded-xl p-2.5 text-ink-faint hover:bg-red/10 hover:text-red transition-all disabled:opacity-40"
                  aria-label="O'chirish"
                >
                  <Trash2 className="h-4.5 w-4.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {attachmentsQuery.isLoading && (
          <div className="mt-6 flex justify-center py-6">
            <Loader2 className="h-6 w-6 animate-spin text-ink-faint" />
          </div>
        )}
        {attachments.length === 0 &&
          !attachmentsQuery.isLoading &&
          uploadEntries.length === 0 && (
            <p className="mt-6 text-sm text-center font-medium text-ink-soft opacity-60">
              Hali fayllar qo&apos;shilmagan.
            </p>
          )}
      </section>

      {/* Preview Modal */}
      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setPreview(null)}
        >
          <div
            ref={previewRef}
            role="dialog"
            aria-modal="true"
            aria-label={preview.name}
            className="relative max-h-[90vh] max-w-4xl w-full overflow-auto rounded-2xl bg-canvas p-2 shadow-large"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-2">
              <p className="truncate text-sm font-semibold text-ink-strong">
                {preview.name}
              </p>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="rounded-lg p-1.5 text-ink-soft hover:bg-soft hover:text-ink-strong"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex items-center justify-center p-4">
              {preview.kind === 'IMAGE' && (
                <img
                  src={preview.url}
                  alt={preview.name}
                  className="max-h-[75vh] max-w-full rounded-xl object-contain"
                  draggable={false}
                  onContextMenu={(e) => e.preventDefault()}
                />
              )}
              {preview.kind === 'VIDEO' || preview.kind === 'RECORDING' ? (
                <video
                  src={preview.url}
                  controls
                  autoPlay
                  disablePictureInPicture
                  className="max-h-[75vh] max-w-full rounded-xl"
                  controlsList="nodownload noremoteplayback"
                  onContextMenu={(e) => e.preventDefault()}
                />
              ) : null}
              {preview.kind === 'AUDIO' && (
                <div className="w-full max-w-md">
                  <audio src={preview.url} controls autoPlay className="w-full" controlsList="nodownload noremoteplayback" onContextMenu={(e) => e.preventDefault()} />
                </div>
              )}
              {preview.kind === 'PDF' ? (
                <div className="w-full h-[75vh] min-h-[500px]">
                  <iframe
                    src={`${preview.url}#toolbar=0&navpanes=0`}
                    className="w-full h-full rounded-xl border border-rim/50"
                    title={preview.name}
                  />
                </div>
              ) : (preview.kind === 'DOC' ||
                preview.kind === 'SHEET' ||
                preview.kind === 'OTHER') && (
                <div className="text-center">
                  <FileText className="mx-auto h-16 w-16 text-ink-faint" />
                  <p className="mt-4 text-sm text-ink-soft">
                    Bu fayl turini brauzerda ko&apos;rsatib bo&apos;lmaydi.
                  </p>
                  <a
                    href={preview.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex items-center gap-2 rounded-xl bg-blue px-4 py-2 text-sm font-bold text-white hover:bg-blue-600"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Yuklab olish
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
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
            ? 'text-orange font-semibold'
            : status === 'FAILED'
              ? 'text-red font-semibold'
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

function iconBackgroundClass(kind: AttachmentKind): string {
  switch (kind) {
    case 'VIDEO':
    case 'RECORDING':
      return 'bg-purple/10 text-purple';
    case 'AUDIO':
      return 'bg-violet/10 text-violet';
    case 'IMAGE':
      return 'bg-blue/10 text-blue';
    case 'PDF':
      return 'bg-red/10 text-red';
    case 'DOC':
      return 'bg-orange/10 text-orange';
    case 'SHEET':
      return 'bg-teal/10 text-teal';
    default:
      return 'bg-black/5 text-ink-soft';
  }
}

function statusLabel(p: UploadProgress): string {
  if (p.status === 'error') return 'Xatolik';
  if (p.status === 'done') return 'Tayyor';
  if (p.status === 'completing') return 'Yakunlanmoqda…';
  if (p.status === 'attaching') return 'Biriktirilmoqda…';
  return `${Math.round((p.loaded / p.total) * 100)}%`;
}

function detectKind(file: File): AttachmentKind {
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
      return <FileVideo className="h-4 w-4" />;
    case 'AUDIO':
      return <FileAudio className="h-4 w-4" />;
    case 'IMAGE':
      return <FileImage className="h-4 w-4" />;
    case 'PDF':
    case 'DOC':
      return <FileText className="h-4 w-4" />;
    default:
      return <File className="h-4 w-4" />;
  }
}

function fileName(att: Attachment): string {
  const meta = att.asset.metadata;
  if (meta && typeof meta === 'object' && 'fileName' in meta) {
    return String((meta as Record<string, unknown>).fileName);
  }
  return `${att.kind}-${att.id.slice(0, 8)}`;
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return '—';
  const n = Number(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
