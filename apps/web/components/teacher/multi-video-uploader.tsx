'use client';

import { useCallback, useRef, useState } from 'react';
import { AlertTriangle, Upload } from 'lucide-react';

import type { Attachment } from '../../lib/api/catalog';
import { ResumableUploadRow } from './resumable-uploader';
import { cn } from '../../lib/utils';

// ═════════════════════════════════════════════════════════════════
// MultiVideoUploader — upload up to MAX_VIDEOS videos for a single lesson.
//
// Renders a dropzone (accept="video/*", multiple) and one independent
// ResumableUploadRow per selected video. Each row uploads + attaches to the
// lesson on its own. The dropzone stays available until MAX_VIDEOS rows
// exist. Non-video files are filtered out defensively; extras beyond the
// MAX are ignored with a small note.
// ═════════════════════════════════════════════════════════════════

const MAX_VIDEOS = 10;

interface SelectedVideo {
  /** Stable key for the row (independent of File identity). */
  id: number;
  file: File;
}

interface MultiVideoUploaderProps {
  lessonId: string;
  /** Called each time a video is uploaded AND attached to the lesson. */
  onAttached?: (attachment: Attachment) => void;
  /** `accept` filter for the file input. Defaults to `video/*`. */
  accept?: string;
  className?: string;
}

export function MultiVideoUploader({
  lessonId,
  onAttached,
  accept = 'video/*',
  className,
}: MultiVideoUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const idRef = useRef(0);
  const [videos, setVideos] = useState<SelectedVideo[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [overflowNote, setOverflowNote] = useState<string | null>(null);

  const addFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;

    // Defensive: only accept real videos regardless of the OS picker filter.
    const videoFiles = Array.from(files).filter((f) =>
      f.type.startsWith('video/'),
    );
    const rejectedNonVideo = files.length - videoFiles.length;

    setVideos((prev) => {
      const remaining = MAX_VIDEOS - prev.length;
      const accepted = videoFiles.slice(0, Math.max(0, remaining));
      const ignored = videoFiles.length - accepted.length;

      if (ignored > 0) {
        setOverflowNote(
          `Faqat ${MAX_VIDEOS} ta videoga ruxsat beriladi — ${ignored} ta video e'tiborga olinmadi.`,
        );
      } else if (rejectedNonVideo > 0) {
        setOverflowNote(
          `${rejectedNonVideo} ta fayl video bo'lmagani uchun e'tiborga olinmadi.`,
        );
      } else {
        setOverflowNote(null);
      }

      if (accepted.length === 0) return prev;

      const next = accepted.map<SelectedVideo>((file) => ({
        id: (idRef.current += 1),
        file,
      }));
      return [...prev, ...next];
    });
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  const removeVideo = useCallback((id: number) => {
    setVideos((prev) => prev.filter((v) => v.id !== id));
  }, []);

  const openPicker = useCallback(() => {
    if (fileInputRef.current) {
      // Reset so re-selecting the same file fires `onChange` again.
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  }, []);

  const count = videos.length;
  const canAddMore = count < MAX_VIDEOS;

  return (
    <div className={cn('space-y-4', className)}>
      {/* Counter */}
      <div className="flex items-center justify-between">
        <span
          className="text-xs font-semibold text-ink-soft"
          aria-live="polite"
        >
          {count} / {MAX_VIDEOS} video
        </span>
      </div>

      {/* One independent upload row per selected video */}
      {videos.length > 0 && (
        <div className="space-y-3">
          {videos.map((v) => (
            <ResumableUploadRow
              key={v.id}
              file={v.file}
              lessonId={lessonId}
              kind="VIDEO"
              {...(onAttached ? { onAttached } : {})}
              onRemove={() => removeVideo(v.id)}
              doneRemoveLabel="O'chirish"
            />
          ))}
        </div>
      )}

      {/* Dropzone — available until MAX_VIDEOS rows exist */}
      {canAddMore && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Videolarni tanlash uchun bosing yoki bu yerga tashlang"
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={openPicker}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openPicker();
            }
          }}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition-all outline-none focus-visible:ring-2 focus-visible:ring-blue focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            isDragging
              ? 'border-blue bg-blue/10'
              : 'border-rim hover:border-blue/40 hover:bg-blue/5',
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={accept}
            multiple
            onChange={(e) => addFiles(e.target.files)}
            className="hidden"
          />
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue/10 text-blue">
            <Upload className="h-5 w-5" />
          </span>
          <p className="text-sm font-bold text-ink-strong">
            Videoni bu yerga tashlang yoki tanlang
          </p>
          <p className="mt-1 text-xs text-ink-faint">
            {MAX_VIDEOS} tagacha video — har biri qayta tiklanadigan
            bo'laklarda yuklanadi (pauza va qayta urinish bilan)
          </p>
        </div>
      )}

      {overflowNote && (
        <p
          className="flex items-center gap-1.5 text-xs font-semibold text-orange"
          role="status"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>{overflowNote}</span>
        </p>
      )}
    </div>
  );
}
