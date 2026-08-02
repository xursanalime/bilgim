'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';

import { HlsPlayer } from './hls-player';
import { DocumentPreview } from './document-preview';
import { cn } from '../../lib/utils';

export type PreviewKind =
  | 'VIDEO'
  | 'RECORDING'
  | 'AUDIO'
  | 'IMAGE'
  | 'PDF'
  | 'DOC'
  | 'SHEET'
  | 'OTHER';

export interface AttachmentPreviewState {
  url: string;
  type: 'manifest' | 'variant' | 'original';
  kind: PreviewKind;
  name: string;
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;

/**
 * Slide-over side panel for previewing a lesson attachment — shared by
 * the teacher's materials editor and the student's lesson viewer so
 * both sides open files the exact same way (docked on the right, like
 * Claude's file/artifact panel, not a new tab / download) instead of
 * drifting into two different UIs for the same underlying data.
 *
 * Rendered via a portal straight into <body> so it never inherits layout
 * side effects from wherever it happens to be mounted — e.g. a
 * `space-y-8` ancestor's child-spacing margin landing on this modal too
 * (even with position: fixed, margin still applies) and pushing its top
 * edge down instead of flush with the viewport.
 */
export function AttachmentPreviewModal({
  preview,
  onClose,
}: {
  preview: AttachmentPreviewState | null;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  // Kept alive briefly after `preview` clears so the panel can play its
  // slide-out transition instead of vanishing instantly.
  const [displayed, setDisplayed] = useState<AttachmentPreviewState | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (preview) {
      setDisplayed(preview);
      setZoom(1);
      const raf = requestAnimationFrame(() => setOpen(true));
      return () => cancelAnimationFrame(raf);
    }
    setOpen(false);
    return undefined;
  }, [preview]);

  useEffect(() => {
    if (!open) return undefined;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const zoomIn = useCallback(
    () => setZoom((z) => Math.min(ZOOM_MAX, Math.round((z + 0.25) * 100) / 100)),
    [],
  );
  const zoomOut = useCallback(
    () => setZoom((z) => Math.max(ZOOM_MIN, Math.round((z - 0.25) * 100) / 100)),
    [],
  );
  const zoomReset = useCallback(() => setZoom(1), []);

  if (!displayed) return null;

  const showZoomControls =
    displayed.kind !== 'VIDEO' &&
    displayed.kind !== 'RECORDING' &&
    displayed.kind !== 'AUDIO' &&
    // PDF gets its own native toolbar (with working zoom) inside the
    // iframe — our custom controls only cover content types we render
    // ourselves (image, mammoth/xlsx HTML).
    displayed.kind !== 'PDF';

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className={cn(
          'absolute inset-0 bg-tint-strong/30 backdrop-blur-[2px] transition-opacity duration-300',
          open ? 'opacity-100' : 'opacity-0',
        )}
        onClick={onClose}
      />
      <div
        onTransitionEnd={() => {
          if (!open) setDisplayed(null);
        }}
        className={cn(
          'relative flex h-full w-full flex-col border-l border-rim bg-canvas shadow-2xl transition-transform duration-300 ease-out sm:w-[85vw] md:w-[70vw] lg:w-[52vw] xl:max-w-[860px]',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-rim px-4 py-3">
          <p className="truncate text-sm font-semibold text-ink-strong">{displayed.name}</p>
          <div className="flex shrink-0 items-center gap-1">
            {showZoomControls && (
              <>
                <button
                  type="button"
                  onClick={zoomOut}
                  disabled={zoom <= ZOOM_MIN}
                  className="rounded-lg p-1.5 text-ink-soft transition-colors hover:bg-soft hover:text-ink-strong disabled:opacity-40"
                  aria-label="Kichiklashtirish"
                >
                  <ZoomOut className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={zoomReset}
                  className="w-14 rounded-lg px-2 py-1.5 text-center text-xs font-medium text-ink-soft transition-colors hover:bg-soft hover:text-ink-strong"
                  aria-label="Asl o'lchamga qaytarish"
                >
                  {Math.round(zoom * 100)}%
                </button>
                <button
                  type="button"
                  onClick={zoomIn}
                  disabled={zoom >= ZOOM_MAX}
                  className="rounded-lg p-1.5 text-ink-soft transition-colors hover:bg-soft hover:text-ink-strong disabled:opacity-40"
                  aria-label="Kattalashtirish"
                >
                  <ZoomIn className="h-4 w-4" />
                </button>
                {zoom !== 1 && (
                  <button
                    type="button"
                    onClick={zoomReset}
                    className="rounded-lg p-1.5 text-ink-soft transition-colors hover:bg-soft hover:text-ink-strong"
                    aria-label="Nolga qaytarish"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>
                )}
                <div className="mx-1 h-5 w-px bg-rim" />
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-ink-soft hover:bg-soft hover:text-ink-strong"
              aria-label="Yopish"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        {displayed.kind === 'PDF' ? (
          // Full-bleed — no padding/centering box. The native PDF viewer
          // brings its own toolbar and scrolling, so it should fill the
          // entire panel like Claude's file panel does, not sit centered
          // in a card with dead space around it.
          <div className="flex-1 overflow-hidden">
            <DocumentPreview url={displayed.url} kind={displayed.kind} name={displayed.name} />
          </div>
        ) : (
          <div
            className="flex-1 overflow-auto"
            onWheel={(e) => {
              if (!e.ctrlKey && !e.metaKey) return;
              e.preventDefault();
              if (e.deltaY < 0) zoomIn();
              else zoomOut();
            }}
          >
            <div className="flex min-h-full items-center justify-center p-6">
              {displayed.kind === 'IMAGE' && (
                // Zoom resizes the actual <img> box (not a CSS transform) so
                // the browser re-samples the bitmap at the new size instead
                // of stretching an already-rendered frame — a
                // transform: scale() here made the image visibly blurry
                // past 100%.
                <div style={{ width: `${zoom * 100}%` }} className="shrink-0 transition-[width] duration-150">
                  <img
                    src={displayed.url}
                    alt={displayed.name}
                    draggable={false}
                    onContextMenu={(e) => e.preventDefault()}
                    className="h-auto max-h-[75vh] w-full select-none rounded-xl object-contain"
                  />
                </div>
              )}
              {displayed.kind === 'VIDEO' || displayed.kind === 'RECORDING' ? (
                <HlsPlayer src={displayed.url} type={displayed.type} className="max-h-[70vh] w-full" />
              ) : null}
              {displayed.kind === 'AUDIO' && (
                <div className="w-full max-w-md">
                  <audio src={displayed.url} controls autoPlay className="w-full" />
                </div>
              )}
              {(displayed.kind === 'DOC' || displayed.kind === 'SHEET' || displayed.kind === 'OTHER') && (
                // DOC/SHEET are our own rendered HTML (mammoth/xlsx) — widening
                // the box makes the browser reflow and re-render it natively
                // at the new size instead of blurring a scaled-up bitmap.
                <div style={{ width: `${zoom * 100}%` }} className="shrink-0 transition-[width] duration-150">
                  <DocumentPreview url={displayed.url} kind={displayed.kind} name={displayed.name} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
