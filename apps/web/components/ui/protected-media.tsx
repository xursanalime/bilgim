'use client';

/**
 * ProtectedImage va ProtectedAudio — ma'lumot o'g'irlanishining oldini oluvchi
 * media komponentlar.
 *
 * Qanday ishlaydi:
 *  - Rasm/audio `/api/media/proxy` orqali autentifikatsiyalangan so'rov bilan olinadi
 *  - Blob URL yaratiladi (faqat joriy sessiyada amal qiladi, tashqariga chiqarib bo'lmaydi)
 *  - Himoya qatlamlari: sichqoncha o'ng tugmasi, drag-drop, nusxa olish bloklandi
 *  - Yuklash tugmasi yo'q
 *  - Blob URL brauzer historiy va manba kodida ko'rinmaydi
 */

import React, { useEffect, useRef, useState } from 'react';
import { X, ZoomIn, ZoomOut, RotateCw } from 'lucide-react';
import { getAccessToken } from '../../lib/auth';
import { useFocusTrap } from '../../lib/a11y/use-focus-trap';

// ─── Shared fetch ──────────────────────────────────────────────────────────

async function fetchViaProxy(assetId: string): Promise<string> {
  const token = getAccessToken();
  const res = await fetch(`/api/media/proxy?assetId=${encodeURIComponent(assetId)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`proxy ${res.status}`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// ─── ProtectedImage ────────────────────────────────────────────────────────

interface ProtectedImageProps {
  assetId: string;
  alt?: string;
  className?: string;
  onClick?: () => void;
}

export function ProtectedImage({
  assetId,
  alt,
  className = '',
  onClick,
}: ProtectedImageProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const prevUrl = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    setError(false);
    setBlobUrl(null);

    fetchViaProxy(assetId)
      .then((url) => {
        if (!active) {
          URL.revokeObjectURL(url);
          return;
        }
        if (prevUrl.current) URL.revokeObjectURL(prevUrl.current);
        prevUrl.current = url;
        setBlobUrl(url);
      })
      .catch(() => active && setError(true));

    return () => {
      active = false;
    };
  }, [assetId]);

  // Komponent unmount bo'lganda blob URL ni tozalash
  useEffect(
    () => () => {
      if (prevUrl.current) URL.revokeObjectURL(prevUrl.current);
    },
    [],
  );

  const prevent = (e: React.MouseEvent | React.DragEvent) => e.preventDefault();

  if (error) {
    return (
      <div className={`flex items-center justify-center bg-black/10 rounded-xl ${className}`}>
        <span className="text-xs text-ink-faint">Rasm yuklanmadi</span>
      </div>
    );
  }

  if (!blobUrl) {
    return (
      <div className={`animate-pulse bg-black/10 rounded-xl ${className}`} />
    );
  }

  // When clickable (opens a lightbox), expose the wrapper as a keyboard-operable
  // button: reachable via Tab and activatable with Enter/Space (Req 3.1, 3.2).
  const interactiveProps = onClick
    ? {
        role: 'button' as const,
        tabIndex: 0,
        'aria-label': alt ?? 'Rasmni kattalashtirib ko‘rish',
        onClick,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        },
      }
    : {};

  return (
    <div
      className={`relative overflow-hidden select-none outline-none ${
        onClick ? 'focus-visible:ring-2 focus-visible:ring-blue focus-visible:ring-offset-2' : ''
      } ${className}`}
      onContextMenu={prevent}
      onDragStart={prevent}
      style={{ cursor: onClick ? 'zoom-in' : 'default' }}
      {...interactiveProps}
    >
      {/* Ko'rinmas overlay — right-click va drag ni to'xtatadi */}
      <div
        className="absolute inset-0 z-10"
        aria-hidden="true"
        onContextMenu={prevent}
        onDragStart={prevent}
        style={{ pointerEvents: 'all' }}
      />
      <img
        src={blobUrl}
        alt={alt}
        draggable={false}
        onContextMenu={prevent}
        className="w-full h-full object-cover pointer-events-none select-none"
        style={{ WebkitUserSelect: 'none', userSelect: 'none' }}
      />
    </div>
  );
}

// ─── ProtectedAudio ────────────────────────────────────────────────────────

interface ProtectedAudioProps {
  assetId: string;
  className?: string;
}

export function ProtectedAudio({ assetId, className = '' }: ProtectedAudioProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const prevUrl = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    setError(false);
    setBlobUrl(null);

    fetchViaProxy(assetId)
      .then((url) => {
        if (!active) { URL.revokeObjectURL(url); return; }
        if (prevUrl.current) URL.revokeObjectURL(prevUrl.current);
        prevUrl.current = url;
        setBlobUrl(url);
      })
      .catch(() => active && setError(true));

    return () => { active = false; };
  }, [assetId]);

  useEffect(() => () => {
    if (prevUrl.current) URL.revokeObjectURL(prevUrl.current);
  }, []);

  if (error) {
    return (
      <div className={`flex items-center gap-2 text-xs text-ink-faint ${className}`}>
        Audio yuklanmadi
      </div>
    );
  }

  if (!blobUrl) {
    return <div className={`h-10 animate-pulse bg-black/10 rounded-xl ${className}`} />;
  }

  return (
    <audio
      src={blobUrl}
      controls
      controlsList="nodownload noremoteplayback"
      onContextMenu={(e) => e.preventDefault()}
      className={`w-full ${className}`}
      style={{ userSelect: 'none' }}
    />
  );
}

// ─── ProtectedLightbox ────────────────────────────────────────────────────

interface ProtectedLightboxProps {
  assetId: string;
  alt?: string | undefined;
  onClose: () => void;
}

export function ProtectedLightbox({ assetId, alt, onClose }: ProtectedLightboxProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const prevUrl = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    fetchViaProxy(assetId)
      .then((url) => {
        if (!active) { URL.revokeObjectURL(url); return; }
        if (prevUrl.current) URL.revokeObjectURL(prevUrl.current);
        prevUrl.current = url;
        setBlobUrl(url);
      })
      .catch(() => active && setError(true));
    return () => { active = false; };
  }, [assetId]);

  useEffect(() => () => {
    if (prevUrl.current) URL.revokeObjectURL(prevUrl.current);
  }, []);

  // Custom (non-Radix) overlay: trap Tab focus, close on Esc, restore focus to
  // the opener on unmount (Req 7.1, 7.2, 7.3).
  useFocusTrap(containerRef, { active: true, onClose });

  const prevent = (e: React.MouseEvent | React.DragEvent) => e.preventDefault();

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={alt ?? 'Rasmni ko‘rish'}
      tabIndex={-1}
      className="fixed inset-0 z-[100] flex flex-col bg-black/95 backdrop-blur-xl animate-in fade-in duration-300 outline-none"
    >
      <header className="flex items-center justify-between p-4 sm:p-6">
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Kattalashtirish" onClick={() => setScale(s => Math.min(s + 0.25, 3))} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black">
            <ZoomIn className="h-5 w-5" aria-hidden="true" />
          </button>
          <button type="button" aria-label="Kichiklashtirish" onClick={() => setScale(s => Math.max(s - 0.25, 0.5))} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black">
            <ZoomOut className="h-5 w-5" aria-hidden="true" />
          </button>
          <button type="button" aria-label="Aylantirish" onClick={() => setRotation(r => (r + 90) % 360)} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black">
            <RotateCw className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <button type="button" aria-label="Yopish" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black">
          <X className="h-6 w-6" aria-hidden="true" />
        </button>
      </header>
      <div className="flex-1 overflow-auto p-4 flex items-center justify-center select-none" onContextMenu={prevent} onDragStart={prevent}>
        {error ? (
          <p className="text-white/50 text-sm">Rasm yuklanmadi</p>
        ) : !blobUrl ? (
          <div className="h-40 w-60 animate-pulse rounded-2xl bg-white/10" />
        ) : (
          <div className="relative">
            <div className="absolute inset-0 z-10" aria-hidden="true" onContextMenu={prevent} onDragStart={prevent} />
            <img
              src={blobUrl}
              alt={alt}
              draggable={false}
              onContextMenu={prevent}
              style={{ transform: `scale(${scale}) rotate(${rotation}deg)`, transition: 'transform 0.3s ease-out', userSelect: 'none', pointerEvents: 'none' }}
              className="max-h-full max-w-full object-contain shadow-2xl"
            />
          </div>
        )}
      </div>
      {alt && <footer className="p-6 text-center"><p className="text-sm font-medium text-white/60">{alt}</p></footer>}
    </div>
  );
}

// ─── ProtectedPdfViewer ────────────────────────────────────────────────────

interface ProtectedPdfViewerProps {
  assetId: string;
  className?: string;
}

export function ProtectedPdfViewer({ assetId, className = '' }: ProtectedPdfViewerProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const prevUrl = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    setError(false);
    setBlobUrl(null);

    fetchViaProxy(assetId)
      .then((url) => {
        if (!active) { URL.revokeObjectURL(url); return; }
        if (prevUrl.current) URL.revokeObjectURL(prevUrl.current);
        // Brauzer PDF viewer toolbarini yashirish
        prevUrl.current = url;
        setBlobUrl(`${url}#toolbar=0&navpanes=0&scrollbar=1&view=FitH`);
      })
      .catch(() => active && setError(true));

    return () => { active = false; };
  }, [assetId]);

  useEffect(() => () => {
    if (prevUrl.current) URL.revokeObjectURL(prevUrl.current);
  }, []);

  if (error) {
    return (
      <div className={`flex items-center justify-center bg-black/10 rounded-xl p-4 text-sm text-ink-faint ${className}`}>
        PDF yuklanmadi yoki ruxsat yo&apos;q
      </div>
    );
  }

  if (!blobUrl) {
    return <div className={`animate-pulse bg-black/10 rounded-xl ${className}`} style={{ minHeight: 400 }} />;
  }

  return (
    <div className={`relative ${className}`} onContextMenu={(e) => e.preventDefault()}>
      <iframe
        src={blobUrl}
        title="PDF ko'rish"
        className="w-full rounded-xl border border-white/10"
        style={{ minHeight: 500, border: 'none' }}
        sandbox="allow-scripts allow-same-origin"
      />
      {/* Iframe ustida himoya qatlami (download tugmasini bloklash uchun) */}
      <div
        className="absolute inset-0 z-10 pointer-events-none"
        aria-hidden="true"
      />
    </div>
  );
}
