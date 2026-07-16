'use client';

/**
 * ProtectedFileViewer — hardened, download-gated renderer for protected
 * attachments (PDF / DOC / SHEET / IMAGE / AUDIO). Implements frontend-redesign
 * design §3.5 and Requirements 2.1–2.5.
 *
 * Security model
 * --------------
 *  - Bytes are streamed through the same-origin Media BFF
 *    (`GET /api/media/stream?assetId=`), which proxies the API's gated byte
 *    stream and attaches the session token server-side. A raw / signed R2
 *    storage URL is therefore NEVER serialized into the DOM (Req 2.1, 2.4).
 *  - The streamed response is turned into a `blob:` object URL for inline
 *    rendering. Object URLs are session-scoped and are revoked on unmount.
 *  - `downloadAllowed` is **server-authoritative and display-only**: the API
 *    independently rejects unauthorized fetches (the BFF sets
 *    `Content-Disposition: inline` while downloads are disabled). The client
 *    treats the flag purely as a rendering hint (Req 2.4).
 *
 * Gating behaviour
 * ----------------
 *  - `downloadAllowed === false`: inline / preview only. No download, export,
 *    "save as", or "open in new tab" affordance is rendered. Text selection,
 *    print, drag-save, and the context menu are disabled for the file
 *    (Req 2.2, 2.5). PDFs render in a toolbar-less proxied viewer.
 *  - `downloadAllowed === true`: a streamed download action (sourced from the
 *    BFF-streamed blob) is revealed (Req 2.3).
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Download, FileText, Lock } from 'lucide-react';

/** Attachment kinds this viewer knows how to render. */
export type ProtectedFileKind =
  | 'PDF'
  | 'IMAGE'
  | 'AUDIO'
  | 'VIDEO'
  | 'RECORDING'
  | 'DOC'
  | 'DOCX'
  | 'SHEET'
  | 'XLSX'
  | 'FILE'
  | 'OTHER';

export interface ProtectedFileViewerProps {
  /** Asset id; streamed via `/api/media/stream?assetId=`. */
  assetId: string;
  /** Attachment kind — drives which inline renderer is used. */
  kind: string;
  /**
   * Server-authoritative Download_Permission mirror. Display-only: the API
   * enforces the real gate. `false` → inline/preview only with no download.
   */
  downloadAllowed: boolean;
  /** Human-facing file name (used as the download filename + label). */
  fileName?: string;
  className?: string;
}

/** Build the same-origin BFF stream URL. Never a raw storage URL. */
function streamUrl(assetId: string): string {
  return `/api/media/stream?assetId=${encodeURIComponent(assetId)}`;
}

/**
 * Stream the gated bytes through the BFF and wrap them in a session-scoped
 * `blob:` URL. `credentials: 'include'` lets the BFF read the session cookie;
 * the token is attached server-side and never reaches the DOM.
 */
async function fetchBlobUrl(assetId: string): Promise<string> {
  const res = await fetch(streamUrl(assetId), {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`stream ${res.status}`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

const PREVENT_KEYS = new Set(['s', 'p', 'c']);

export function ProtectedFileViewer({
  assetId,
  kind,
  downloadAllowed,
  fileName,
  className = '',
}: ProtectedFileViewerProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const objectUrlRef = useRef<string | null>(null);

  const normalizedKind = kind.toUpperCase();
  const label = fileName ?? `${normalizedKind}-${assetId.slice(0, 8)}`;

  useEffect(() => {
    let active = true;
    setStatus('loading');
    setBlobUrl(null);

    fetchBlobUrl(assetId)
      .then((url) => {
        if (!active) {
          URL.revokeObjectURL(url);
          return;
        }
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = url;
        setBlobUrl(url);
        setStatus('ready');
      })
      .catch(() => {
        if (active) setStatus('error');
      });

    return () => {
      active = false;
    };
  }, [assetId]);

  // Revoke the created blob URL when the component unmounts so the streamed
  // bytes are not retrievable after the viewer closes.
  useEffect(
    () => () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    },
    [],
  );

  const prevent = useCallback(
    (e: React.SyntheticEvent) => {
      if (!downloadAllowed) e.preventDefault();
    },
    [downloadAllowed],
  );

  // Block print/save/copy keyboard shortcuts while downloads are disabled
  // (Req 2.5). Selection is also disabled via CSS below.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (downloadAllowed) return;
      if ((e.ctrlKey || e.metaKey) && PREVENT_KEYS.has(e.key.toLowerCase())) {
        e.preventDefault();
      }
    },
    [downloadAllowed],
  );

  const protectionStyle: React.CSSProperties = downloadAllowed
    ? {}
    : {
        userSelect: 'none',
        WebkitUserSelect: 'none',
        MozUserSelect: 'none',
        msUserSelect: 'none',
      };

  return (
    <div
      data-testid="protected-file-viewer"
      data-download-allowed={downloadAllowed ? 'true' : 'false'}
      data-selection-disabled={downloadAllowed ? 'false' : 'true'}
      className={`relative flex flex-col gap-3 ${className}`}
      onContextMenu={prevent}
      onDragStart={prevent}
      onCopy={prevent}
      onKeyDown={onKeyDown}
      style={protectionStyle}
    >
      <div className="flex-1">
        {status === 'loading' ? (
          <div
            className="min-h-[300px] animate-pulse rounded-xl bg-black/10"
            aria-label="Yuklanmoqda"
          />
        ) : status === 'error' || !blobUrl ? (
          <div className="flex min-h-[200px] items-center justify-center rounded-xl bg-black/10 p-6 text-sm text-cream-dim">
            Faylni yuklab bo&apos;lmadi yoki ruxsat yo&apos;q.
          </div>
        ) : (
          <FileBody
            kind={normalizedKind}
            blobUrl={blobUrl}
            label={label}
            downloadAllowed={downloadAllowed}
          />
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        {downloadAllowed ? (
          <span className="flex items-center gap-1.5 text-[11px] text-sky-400">
            Faylni yuklab olishingiz mumkin
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-[11px] text-amber-500">
            <Lock className="h-3.5 w-3.5" />
            Yuklab olish cheklangan
          </span>
        )}

        {/* Download affordance is revealed ONLY when downloadAllowed === true
            (Req 2.2/2.3). The href is the BFF-streamed blob, never a raw URL. */}
        {downloadAllowed && blobUrl ? (
          <a
            data-testid="protected-file-download"
            href={blobUrl}
            download={label}
            className="inline-flex items-center gap-2 rounded-xl bg-accent2-500 px-4 py-2 text-xs font-bold text-ink transition-all hover:bg-accent2-400 active:scale-95"
          >
            <Download className="h-4 w-4" />
            Yuklab olish
          </a>
        ) : null}
      </div>
    </div>
  );
}

interface FileBodyProps {
  kind: string;
  blobUrl: string;
  label: string;
  downloadAllowed: boolean;
}

function FileBody({ kind, blobUrl, label, downloadAllowed }: FileBodyProps) {
  const prevent = (e: React.SyntheticEvent) => {
    if (!downloadAllowed) e.preventDefault();
  };

  if (kind === 'IMAGE') {
    return (
      <img
        data-testid="protected-file-image"
        src={blobUrl}
        alt={label}
        draggable={downloadAllowed}
        onContextMenu={prevent}
        className="max-h-[60vh] w-full rounded-xl object-contain"
      />
    );
  }

  if (kind === 'AUDIO') {
    return (
      <audio
        data-testid="protected-file-audio"
        src={blobUrl}
        controls
        controlsList={downloadAllowed ? undefined : 'nodownload noremoteplayback'}
        onContextMenu={prevent}
        aria-label={label}
        className="w-full"
      />
    );
  }

  if (kind === 'VIDEO' || kind === 'RECORDING') {
    return (
      <video
        data-testid="protected-file-video"
        src={blobUrl}
        controls
        disablePictureInPicture
        controlsList={downloadAllowed ? undefined : 'nodownload noremoteplayback'}
        onContextMenu={prevent}
        aria-label={label}
        className="max-h-[60vh] w-full rounded-xl"
      />
    );
  }

  if (kind === 'PDF') {
    // Toolbar-less inline render. When downloads are disabled the browser's
    // built-in PDF download/print toolbar is hidden via the URL fragment, and
    // the sandbox withholds download/popup capabilities.
    const src = downloadAllowed
      ? blobUrl
      : `${blobUrl}#toolbar=0&navpanes=0&scrollbar=1&view=FitH`;
    return (
      <iframe
        data-testid="protected-file-pdf"
        src={src}
        title={label}
        className="h-[60vh] min-h-[400px] w-full rounded-xl border border-white/[0.08]"
        sandbox="allow-scripts allow-same-origin"
      />
    );
  }

  // DOC / DOCX / SHEET / XLSX / FILE / OTHER — not browser-previewable.
  return (
    <div
      data-testid="protected-file-nonpreview"
      className="flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-xl bg-white/[0.02] p-8 text-center"
    >
      <FileText className="h-14 w-14 text-cream-dim opacity-50" />
      <p className="text-sm font-medium text-cream">{label}</p>
      <p className="text-xs text-cream-dim">
        {downloadAllowed
          ? "Bu fayl turini brauzerda ko'rsatib bo'lmaydi. Yuklab oling."
          : "Bu fayl turini brauzerda ko'rsatib bo'lmaydi."}
      </p>
    </div>
  );
}
