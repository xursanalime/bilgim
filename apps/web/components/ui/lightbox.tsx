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
    <div className="fixed inset-0 z-[100] flex flex-col bg-black/95 backdrop-blur-xl animate-in fade-in duration-300">
      <header className="flex items-center justify-between p-4 sm:p-6">
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setScale(s => Math.min(s + 0.25, 3))}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
          >
            <ZoomIn className="h-5 w-5" />
          </button>
          <button 
            onClick={() => setScale(s => Math.max(s - 0.25, 0.5))}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
          >
            <ZoomOut className="h-5 w-5" />
          </button>
          <button 
            onClick={() => setRotate(r => (r + 90) % 360)}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
          >
            <RotateCw className="h-5 w-5" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <a 
            href={src} 
            download 
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
          >
            <Download className="h-5 w-5" />
          </a>
          <button 
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-4 flex items-center justify-center">
        <img
          src={src}
          alt={alt}
          style={{ 
            transform: `scale(${scale}) rotate(${rotation}deg)`,
            transition: 'transform 0.3s ease-out'
          }}
          className="max-h-full max-w-full object-contain shadow-2xl"
        />
      </div>
      
      {alt && (
        <footer className="p-6 text-center">
          <p className="text-sm font-medium text-white/60">{alt}</p>
        </footer>
      )}
    </div>
  );
}
