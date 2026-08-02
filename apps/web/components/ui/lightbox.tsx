'use client';

import { X, ZoomIn, ZoomOut, RotateCw, Download } from 'lucide-react';
import { useState, useEffect } from 'react';

interface LightboxProps {
  src: string;
  alt?: string;
  onClose: () => void;
}

export function Lightbox({ src, alt, onClose }: LightboxProps) {
  const [scale, setScale] = useState(1);
  const [rotation, setRotate] = useState(0);

  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-tint-strong/50 backdrop-blur-xl animate-in fade-in duration-300"
      onClick={onClose}
    >
      <header
        className="flex items-center justify-between gap-4 p-4 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-1.5 rounded-2xl border border-rim bg-white/90 p-1.5 shadow-soft backdrop-blur-md">
          <button
            onClick={() => setScale((s) => Math.min(s + 0.25, 3))}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-ink-soft transition-colors hover:bg-tint hover:text-blue"
            aria-label="Kattalashtirish"
          >
            <ZoomIn className="h-4.5 w-4.5" />
          </button>
          <button
            onClick={() => setScale((s) => Math.max(s - 0.25, 0.5))}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-ink-soft transition-colors hover:bg-tint hover:text-blue"
            aria-label="Kichiklashtirish"
          >
            <ZoomOut className="h-4.5 w-4.5" />
          </button>
          <button
            onClick={() => setRotate((r) => (r + 90) % 360)}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-ink-soft transition-colors hover:bg-tint hover:text-blue"
            aria-label="Aylantirish"
          >
            <RotateCw className="h-4.5 w-4.5" />
          </button>
        </div>

        <div className="flex items-center gap-1.5 rounded-2xl border border-rim bg-white/90 p-1.5 shadow-soft backdrop-blur-md">
          <a
            href={src}
            download
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-ink-soft transition-colors hover:bg-tint hover:text-blue"
            aria-label="Yuklab olish"
          >
            <Download className="h-4.5 w-4.5" />
          </a>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-ink-soft transition-colors hover:bg-red-tint hover:text-red"
            aria-label="Yopish"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </header>

      <div className="flex flex-1 items-center justify-center overflow-auto p-4 sm:p-8">
        <div
          className="max-h-full max-w-full overflow-hidden rounded-[1.75rem] border border-white/10 bg-white p-2 shadow-large"
          onClick={(e) => e.stopPropagation()}
        >
          <img
            src={src}
            alt={alt}
            style={{
              transform: `scale(${scale}) rotate(${rotation}deg)`,
              transition: 'transform 0.3s ease-out',
            }}
            className="max-h-[calc(100vh-10rem)] max-w-full rounded-[1.25rem] object-contain"
          />
        </div>
      </div>

      {alt && (
        <footer className="p-6 text-center">
          <p className="mx-auto inline-block rounded-full border border-rim bg-white/90 px-4 py-1.5 text-xs font-bold text-ink-soft shadow-soft backdrop-blur-md">
            {alt}
          </p>
        </footer>
      )}
    </div>
  );
}
