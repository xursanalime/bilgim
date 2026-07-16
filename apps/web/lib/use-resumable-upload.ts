'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  mediaApi,
  type AttachmentKind,
  type CompletedPart,
  type SignedPartUrl,
} from './api/catalog';
import { ApiClientError } from './api-client';

/**
 * useResumableUpload — client engine for S3/R2-style multipart uploads with
 * per-part progress, pause/resume, and retry of individual failed parts
 * (Task 4.4, Req 8.4).
 *
 * Flow:
 *   1. `mediaApi.initUpload` → { assetId, uploadId, partUrls[], partSizeBytes }
 *   2. The file is sliced into parts using the SERVER-PROVIDED `partSizeBytes`
 *      and each part is `PUT` to its signed URL, capturing the returned ETag.
 *   3. Once every part is uploaded, `mediaApi.completeUpload` is called with
 *      the ordered `{ partNumber, etag }` list.
 *   4. On `cancel()` or unmount of an in-flight upload, `mediaApi.abortUpload`
 *      is called so the server can release the multipart upload.
 *
 * Parts are uploaded with a bounded concurrency pool. Pausing aborts the
 * in-flight `PUT`s and marks them pending again (they restart from 0 bytes on
 * resume — S3/R2 parts are not byte-resumable). Retrying re-queues only the
 * parts that failed.
 *
 * Backend assumptions are documented in the component
 * (`components/teacher/resumable-uploader.tsx`).
 */

// Part size used purely to compute `partsCount` for the init request. The
// backend echoes back the authoritative `partSizeBytes`, which is what we
// slice with. Both sides currently agree on 5 MiB (see `lib/upload.ts`).
const DEFAULT_PART_SIZE = 5 * 1024 * 1024; // 5 MiB
const DEFAULT_CONCURRENCY = 3;

export type UploadStatus =
  | 'idle'
  | 'initializing'
  | 'uploading'
  | 'paused'
  | 'completing'
  | 'completed'
  | 'error'
  | 'aborted';

export type PartStatus = 'pending' | 'uploading' | 'done' | 'error';

export interface PartState {
  partNumber: number;
  status: PartStatus;
  /** Bytes uploaded for this part (0..size). */
  loaded: number;
  /** Total bytes in this part. */
  size: number;
  /** Captured ETag once the part is done, else null. */
  etag: string | null;
  /** Last error message for this part, else null. */
  error: string | null;
}

export interface ResumableUploadSnapshot {
  status: UploadStatus;
  fileName: string | null;
  assetId: string | null;
  parts: PartState[];
  /** Overall progress, 0–100. */
  progress: number;
  uploadedBytes: number;
  totalBytes: number;
  /** Top-level error message (init/complete/part failure), else null. */
  error: string | null;
  /** Convenience flags for the UI. */
  isActive: boolean;
  canPause: boolean;
  canResume: boolean;
  canRetry: boolean;
}

export interface UseResumableUploadOptions {
  kind: AttachmentKind;
  /** Max concurrent part PUTs. Defaults to 3. */
  concurrency?: number;
  onCompleted?: (assetId: string) => void;
  onError?: (message: string) => void;
}

export interface ResumableUploadControls extends ResumableUploadSnapshot {
  start: (file: File) => void;
  pause: () => void;
  resume: () => void;
  retry: () => void;
  cancel: () => void;
  reset: () => void;
}

interface Engine {
  file: File | null;
  assetId: string | null;
  uploadId: string | null;
  partSizeBytes: number;
  partUrls: SignedPartUrl[];
  parts: Map<number, PartState>;
  inFlight: Map<number, XMLHttpRequest>;
  status: UploadStatus;
  error: string | null;
  paused: boolean;
  canceled: boolean;
}

function createEngine(): Engine {
  return {
    file: null,
    assetId: null,
    uploadId: null,
    partSizeBytes: DEFAULT_PART_SIZE,
    partUrls: [],
    parts: new Map(),
    inFlight: new Map(),
    status: 'idle',
    error: null,
    paused: false,
    canceled: false,
  };
}

/**
 * Byte range `[start, end)` for a 1-based part number given the part size and
 * total file size. The final part is clamped to the file end. Pure + exported
 * for unit testing.
 */
export function partByteRange(
  partNumber: number,
  partSizeBytes: number,
  fileSize: number,
): { start: number; end: number; size: number } {
  const start = Math.min((partNumber - 1) * partSizeBytes, fileSize);
  const end = Math.min(start + partSizeBytes, fileSize);
  return { start, end, size: Math.max(0, end - start) };
}

/**
 * Overall 0–100 progress from per-part state. Done parts count their full
 * size; in-flight parts count their uploaded bytes. Pure + exported for tests.
 */
export function overallProgress(
  parts: Pick<PartState, 'status' | 'loaded' | 'size'>[],
): { uploadedBytes: number; totalBytes: number; percent: number } {
  const totalBytes = parts.reduce((sum, p) => sum + p.size, 0);
  const uploadedBytes = parts.reduce(
    (sum, p) => sum + (p.status === 'done' ? p.size : p.loaded),
    0,
  );
  const percent =
    totalBytes > 0
      ? Math.min(100, Math.round((uploadedBytes / totalBytes) * 100))
      : 0;
  return { uploadedBytes, totalBytes, percent };
}

function messageOf(err: unknown): string {
  if (err instanceof ApiClientError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Upload failed';
}

/**
 * PUT a single part blob to its signed URL via XHR (for upload progress +
 * abort support that `fetch` lacks). Resolves with the captured ETag.
 */
function putPart(
  url: string,
  blob: Blob,
  onProgress: (loaded: number) => void,
  register: (xhr: XMLHttpRequest) => void,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    register(xhr);
    xhr.open('PUT', url, true);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        // NOTE: requires the bucket CORS to expose the ETag response header
        // (`Access-Control-Expose-Headers: ETag`) for browser reads.
        const etag =
          xhr.getResponseHeader('ETag') ?? xhr.getResponseHeader('etag');
        if (!etag) {
          reject(new Error('Missing ETag header on part response'));
          return;
        }
        resolve(etag.replace(/"/g, ''));
      } else {
        reject(new Error(`Part HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error during part upload'));
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));

    // A blob produced by File.slice() carries an empty type, so the browser
    // sends no Content-Type header — matching the signed-URL expectations of
    // the existing upload path (`components/dashboard/lesson-materials.tsx`).
    xhr.send(blob);
  });
}

export function useResumableUpload(
  options: UseResumableUploadOptions,
): ResumableUploadControls {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const engineRef = useRef<Engine>(createEngine());

  const buildSnapshot = useCallback((): ResumableUploadSnapshot => {
    const eng = engineRef.current;
    const parts = [...eng.parts.values()].sort(
      (a, b) => a.partNumber - b.partNumber,
    );
    const totalBytes = eng.file?.size ?? 0;
    const { uploadedBytes, percent: progress } = overallProgress(parts);
    const hasFailedPart = parts.some((p) => p.status === 'error');

    return {
      status: eng.status,
      fileName: eng.file?.name ?? null,
      assetId: eng.assetId,
      parts,
      progress,
      uploadedBytes,
      totalBytes,
      error: eng.error,
      isActive:
        eng.status === 'initializing' ||
        eng.status === 'uploading' ||
        eng.status === 'completing',
      canPause: eng.status === 'uploading',
      canResume: eng.status === 'paused',
      canRetry: eng.status === 'error' && (hasFailedPart || eng.assetId != null),
    };
  }, []);

  const [snapshot, setSnapshot] = useState<ResumableUploadSnapshot>(() =>
    buildSnapshot(),
  );

  const publish = useCallback(() => {
    setSnapshot(buildSnapshot());
  }, [buildSnapshot]);

  // Forward-declared so the pump/launch closures can reference each other.
  const pumpRef = useRef<() => void>(() => {});

  const complete = useCallback(async () => {
    const eng = engineRef.current;
    if (eng.status === 'completing' || eng.status === 'completed') return;
    if (!eng.assetId) return;
    eng.status = 'completing';
    publish();
    try {
      const parts: CompletedPart[] = [...eng.parts.values()]
        .sort((a, b) => a.partNumber - b.partNumber)
        .map((p) => ({ partNumber: p.partNumber, etag: p.etag ?? '' }));
      await mediaApi.completeUpload(eng.assetId, parts);
      eng.status = 'completed';
      publish();
      const assetId = eng.assetId;
      if (optionsRef.current.onCompleted && assetId) {
        optionsRef.current.onCompleted(assetId);
      }
    } catch (err) {
      eng.status = 'error';
      eng.error = messageOf(err);
      publish();
      optionsRef.current.onError?.(eng.error);
    }
  }, [publish]);

  const launchPart = useCallback(
    (partNumber: number) => {
      const eng = engineRef.current;
      const part = eng.parts.get(partNumber);
      const signed = eng.partUrls.find((u) => u.partNumber === partNumber);
      const file = eng.file;
      if (!part || !signed || !file) return;

      part.status = 'uploading';
      part.error = null;
      part.loaded = 0;
      publish();

      const { start, end } = partByteRange(
        partNumber,
        eng.partSizeBytes,
        file.size,
      );
      const blob = file.slice(start, end);

      void putPart(
        signed.url,
        blob,
        (loaded) => {
          const current = engineRef.current.parts.get(partNumber);
          if (current && current.status === 'uploading') {
            current.loaded = loaded;
            publish();
          }
        },
        (xhr) => {
          engineRef.current.inFlight.set(partNumber, xhr);
        },
      )
        .then((etag) => {
          const e = engineRef.current;
          e.inFlight.delete(partNumber);
          const p = e.parts.get(partNumber);
          if (p) {
            p.status = 'done';
            p.etag = etag;
            p.loaded = p.size;
            p.error = null;
          }
          publish();
          pumpRef.current();
        })
        .catch((err: unknown) => {
          const e = engineRef.current;
          e.inFlight.delete(partNumber);
          const p = e.parts.get(partNumber);
          const aborted =
            err instanceof DOMException && err.name === 'AbortError';
          if (p) {
            if (aborted) {
              // Paused or canceled — requeue without surfacing an error.
              p.status = 'pending';
              p.loaded = 0;
              p.error = null;
            } else {
              p.status = 'error';
              p.error = messageOf(err);
            }
          }
          if (!aborted && e.status === 'uploading') {
            e.status = 'error';
            e.error = messageOf(err);
            optionsRef.current.onError?.(e.error);
          }
          publish();
          pumpRef.current();
        });
    },
    [publish],
  );

  const pump = useCallback(() => {
    const eng = engineRef.current;
    if (eng.status !== 'uploading') return;

    const concurrency =
      optionsRef.current.concurrency ?? DEFAULT_CONCURRENCY;

    while (eng.inFlight.size < Math.max(1, concurrency)) {
      const next = [...eng.parts.values()].find(
        (p) => p.status === 'pending' && !eng.inFlight.has(p.partNumber),
      );
      if (!next) break;
      launchPart(next.partNumber);
    }

    const all = [...eng.parts.values()];
    if (all.length > 0 && all.every((p) => p.status === 'done')) {
      void complete();
    }
  }, [complete, launchPart]);

  pumpRef.current = pump;

  const init = useCallback(async () => {
    const eng = engineRef.current;
    const file = eng.file;
    if (!file) return;
    try {
      const partsCount = Math.max(
        1,
        Math.ceil(file.size / DEFAULT_PART_SIZE),
      );
      const res = await mediaApi.initUpload({
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        partsCount,
        kind: optionsRef.current.kind,
      });

      if (eng.canceled) {
        // Canceled during init — release the just-created upload.
        void mediaApi.abortUpload(res.assetId).catch(() => undefined);
        return;
      }

      eng.assetId = res.assetId;
      eng.uploadId = res.uploadId;
      eng.partSizeBytes = res.partSizeBytes || DEFAULT_PART_SIZE;
      eng.partUrls = res.partUrls;
      eng.parts = new Map();
      for (const signed of res.partUrls) {
        const { size } = partByteRange(
          signed.partNumber,
          eng.partSizeBytes,
          file.size,
        );
        eng.parts.set(signed.partNumber, {
          partNumber: signed.partNumber,
          status: 'pending',
          loaded: 0,
          size,
          etag: null,
          error: null,
        });
      }
      eng.status = 'uploading';
      eng.error = null;
      publish();
      pumpRef.current();
    } catch (err) {
      eng.status = 'error';
      eng.error = messageOf(err);
      publish();
      optionsRef.current.onError?.(eng.error);
    }
  }, [publish]);

  const start = useCallback(
    (file: File) => {
      const prev = engineRef.current;
      // Abort any prior in-flight upload before replacing the engine.
      for (const xhr of prev.inFlight.values()) xhr.abort();
      if (
        prev.assetId &&
        prev.status !== 'completed' &&
        prev.status !== 'aborted'
      ) {
        void mediaApi.abortUpload(prev.assetId).catch(() => undefined);
      }

      const eng = createEngine();
      eng.file = file;
      eng.status = 'initializing';
      engineRef.current = eng;
      publish();
      void init();
    },
    [init, publish],
  );

  const pause = useCallback(() => {
    const eng = engineRef.current;
    if (eng.status !== 'uploading') return;
    eng.paused = true;
    eng.status = 'paused';
    for (const xhr of eng.inFlight.values()) xhr.abort();
    eng.inFlight.clear();
    publish();
  }, [publish]);

  const resume = useCallback(() => {
    const eng = engineRef.current;
    if (eng.status !== 'paused') return;
    eng.paused = false;
    eng.status = 'uploading';
    publish();
    pumpRef.current();
  }, [publish]);

  const retry = useCallback(() => {
    const eng = engineRef.current;
    if (eng.status !== 'error') return;
    // If init never produced an asset, restart from scratch.
    if (!eng.assetId && eng.file) {
      eng.status = 'initializing';
      eng.error = null;
      publish();
      void init();
      return;
    }
    // Re-queue failed parts and resume the pool.
    for (const p of eng.parts.values()) {
      if (p.status === 'error') {
        p.status = 'pending';
        p.loaded = 0;
        p.error = null;
      }
    }
    eng.status = 'uploading';
    eng.error = null;
    publish();
    pumpRef.current();
  }, [init, publish]);

  const cancel = useCallback(() => {
    const eng = engineRef.current;
    if (eng.status === 'completed' || eng.status === 'aborted') return;
    eng.canceled = true;
    for (const xhr of eng.inFlight.values()) xhr.abort();
    eng.inFlight.clear();
    if (eng.assetId) {
      void mediaApi.abortUpload(eng.assetId).catch(() => undefined);
    }
    eng.status = 'aborted';
    publish();
  }, [publish]);

  const reset = useCallback(() => {
    const eng = engineRef.current;
    for (const xhr of eng.inFlight.values()) xhr.abort();
    if (
      eng.assetId &&
      eng.status !== 'completed' &&
      eng.status !== 'aborted'
    ) {
      void mediaApi.abortUpload(eng.assetId).catch(() => undefined);
    }
    engineRef.current = createEngine();
    publish();
  }, [publish]);

  // Abort an in-flight multipart upload if the component unmounts so the
  // server doesn't leak a dangling upload.
  useEffect(() => {
    return () => {
      const eng = engineRef.current;
      for (const xhr of eng.inFlight.values()) xhr.abort();
      if (
        eng.assetId &&
        eng.status !== 'completed' &&
        eng.status !== 'aborted'
      ) {
        void mediaApi.abortUpload(eng.assetId).catch(() => undefined);
      }
    };
  }, []);

  return {
    ...snapshot,
    start,
    pause,
    resume,
    retry,
    cancel,
    reset,
  };
}
