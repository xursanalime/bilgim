'use client';

import { X, ZoomIn, ZoomOut, RotateCw } from 'lucide-react';
import { useRef, useState } from 'react';

import { useFocusTrap } from '../../lib/a11y/use-focus-trap';

interface LightboxProps {
  src: string;
  alt?: string;
  onClose: () => void;
}

export function Lightbox({ src, alt, onClose }: LightboxProps) {
  const [scale, setScale] = useState(1);
  const [rotation, setRotate] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Custom (non-Radix) overlay: trap Tab focus, close on Esc, and restore focus
  // to the opener on unmount (Req 7.1, 7.2, 7.3).
  useFocusTrap(containerRef, { active: true, onClose });

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
          <button
            type="button"
            aria-label="Kattalashtirish"
            onClick={() => setScale(s => Math.min(s + 0.25, 3))}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          >
            <ZoomIn className="h-5 w-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Kichiklashtirish"
            onClick={() => setScale(s => Math.max(s - 0.25, 0.5))}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          >
            <ZoomOut className="h-5 w-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Aylantirish"
            onClick={() => setRotate(r => (r + 90) % 360)}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          >
            <RotateCw className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Yopish"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          >
            <X className="h-6 w-6" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div
        className="flex-1 overflow-auto p-4 flex items-center justify-center select-none"
        onContextMenu={(e) => e.preventDefault()}
        onDragStart={(e) => e.preventDefault()}
      >
        <div className="relative">
          {/* Ko'rinmas overlay — right-click va drag bloklash */}
          <div
            className="absolute inset-0 z-10"
            aria-hidden="true"
            onContextMenu={(e) => e.preventDefault()}
            onDragStart={(e) => e.preventDefault()}
          />
          <img
            src={src}
            alt={alt}
            draggable={false}
            onContextMenu={(e) => e.preventDefault()}
            style={{
              transform: `scale(${scale}) rotate(${rotation}deg)`,
              transition: 'transform 0.3s ease-out',
              userSelect: 'none',
              WebkitUserSelect: 'none',
              pointerEvents: 'none',
            }}
            className="max-h-full max-w-full object-contain shadow-2xl"
          />
        </div>
      </div>

      {alt && (
        <footer className="p-6 text-center">
          <p className="text-sm font-medium text-white/60">{alt}</p>
        </footer>
      )}
    </div>
  );
}
