'use client';

import { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
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
} from 'lucide-react';

import {
  attachmentsApi,
  mediaApi,
  lessonsApi,
  type AttachmentKind,
  type Attachment,
} from '../../lib/api/catalog';
import { apiClient, ApiClientError } from '../../lib/api-client';

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

  return (
    <>
      <section className="liquid-glass rounded-2xl p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink-strong">Materiallar</h2>
          <span className="text-xs text-ink-soft">
            {attachments.length} ta fayl
          </span>
        </div>

        {/* Description / notes for the lesson materials */}
        <div className="mt-4">
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
            placeholder="Materiallar haqida izoh yozing... (masalan: 1-rasm grammatika qoidalari, 2-fayl mashqlar)"
            rows={2}
            className="w-full rounded-xl border border-rim bg-canvas px-4 py-2.5 text-sm text-ink-strong placeholder-ink-faint outline-none focus:border-blue/40 focus:ring-2 focus:ring-blue/10 resize-none"
          />
          <div className="mt-1 flex items-center justify-between">
            <span className="text-xs">
              {saveDescriptionMutation.isPending ? (
                <span className="text-ink-soft">Saqlanmoqda…</span>
              ) : saveDescriptionMutation.isError ? (
                <span className="text-red">Saqlashda xatolik</span>
              ) : descDirty ? (
                <span className="text-ink-soft">Saqlanmagan o&apos;zgarishlar</span>
              ) : descSaved ? (
                <span className="text-green">✓ Izoh saqlandi</span>
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

        {/* Drop zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
            isDragging
              ? 'border-blue bg-blue-tint'
              : 'border-rim hover:border-blue/40 hover:bg-blue-tint/40'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={(e) => handleFiles(e.target.files)}
            className="hidden"
          />
          <Upload className="h-8 w-8 text-ink-soft" />
          <p className="mt-2 text-sm font-semibold text-ink-strong">
            Faylni bu yerga tashlang yoki bosing
          </p>
          <p className="mt-1 text-xs text-ink-soft">
            Video, audio, rasm, PDF, DOC, XLSX
          </p>
        </div>

        {/* Upload progress */}
        {uploadEntries.length > 0 && (
          <ul className="mt-4 space-y-2">
            {uploadEntries.map(([key, progress]) => (
              <li key={key} className="rounded-xl border border-rim bg-canvas p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-medium text-ink-strong">
                    {progress.fileName}
                  </span>
                  <span className="shrink-0 text-xs text-ink-soft">
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

        {/* Existing attachments */}
        {attachments.length > 0 && (
          <ul className="mt-4 divide-y divide-rim">
            {attachments.map((att) => (
              <li
                key={att.id}
                className="flex items-center justify-between gap-3 py-3"
              >
                <button
                  type="button"
                  onClick={() => openPreview(att)}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 text-left transition-colors hover:bg-blue-tint/50"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-tint text-blue">
                    {loadingPreview === att.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      kindIcon(att.kind)
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink-strong">
                      {fileName(att)}
                    </p>
                    <p className="text-xs text-ink-soft">
                      {att.kind} · {formatBytes(att.asset.bytes)} ·{' '}
                      <StatusBadge status={att.asset.status} />
                    </p>
                  </div>
                  <ExternalLink className="ml-auto h-3.5 w-3.5 shrink-0 text-ink-faint" />
                </button>
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
              </li>
            ))}
          </ul>
        )}

        {attachmentsQuery.isLoading && (
          <p className="mt-4 text-sm text-ink-soft">Yuklanmoqda…</p>
        )}
        {attachments.length === 0 &&
          !attachmentsQuery.isLoading &&
          uploadEntries.length === 0 && (
            <p className="mt-4 text-sm text-ink-soft">
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
                />
              )}
              {preview.kind === 'VIDEO' || preview.kind === 'RECORDING' ? (
                <video
                  src={preview.url}
                  controls
                  autoPlay
                  className="max-h-[75vh] max-w-full rounded-xl"
                />
              ) : null}
              {preview.kind === 'AUDIO' && (
                <div className="w-full max-w-md">
                  <audio src={preview.url} controls autoPlay className="w-full" />
                </div>
              )}
              {(preview.kind === 'PDF' ||
                preview.kind === 'DOC' ||
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
          ? 'text-green'
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
