'use client';

import * as React from 'react';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Shared visual language for the whole live-class surface (lobby,
 * pre-join, in-call chrome): the platform's own light Apple-style system
 * (bg-base page, white cards, border-rim, shadow-soft, solid blue CTAs) —
 * see apps/web/components/ui/button.tsx and dashboard/sidebar.tsx for the
 * source conventions this mirrors. Actual video tiles stay dark (#111118),
 * which is the one legitimate dark surface already used platform-wide
 * (globals.css "LiveKit Components — Dark room override").
 */
export function LiveStage({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative h-screen w-full overflow-hidden bg-[rgb(var(--bg-base))] ${className}`}>
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-[10%] h-[24rem] w-[24rem] rounded-full bg-blue-tint blur-[100px]" />
        <div className="absolute bottom-[-6rem] right-[8%] h-[20rem] w-[20rem] rounded-full bg-purple-tint blur-[100px]" />
      </div>
      <div className="relative z-10 h-full w-full">{children}</div>
      <style jsx global>{`
        @keyframes signal-ring-pulse {
          0% { transform: scale(0.85); opacity: 0.5; }
          100% { transform: scale(1.9); opacity: 0; }
        }
        .signal-ring { animation: signal-ring-pulse 2.4s cubic-bezier(0.2, 0.7, 0.4, 1) infinite; }

        @keyframes shimmer-sweep {
          0% { transform: translateX(-120%); }
          100% { transform: translateX(220%); }
        }
        .shimmer-sweep { animation: shimmer-sweep 2.8s ease-in-out infinite; }
      `}</style>
    </div>
  );
}

export function LiveWordmark({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <span className="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-xl bg-blue text-white shadow-[0_4px_12px_-2px_rgba(0,113,227,0.4)]">
        <Sparkles className="h-4 w-4" />
      </span>
      <span className="text-sm font-extrabold tracking-tight text-ink-strong">Bilgim Live</span>
    </div>
  );
}

export function LiveBackButton({
  onClick,
  label = 'Orqaga',
  className = '',
}: {
  onClick: () => void;
  label?: string;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'group inline-flex items-center gap-2 rounded-2xl border border-rim bg-canvas px-4 py-2.5 text-sm font-bold text-ink-strong shadow-soft transition-all hover:border-rim-2 hover:bg-tint active:scale-[0.98]',
        className,
      )}
    >
      <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
      {label}
    </button>
  );
}

/** White card, matching the platform's dashboard card recipe (border-rim + shadow-soft). */
export function LiveCard({
  children,
  tone = 'default',
  className = '',
}: {
  children: React.ReactNode;
  tone?: 'default' | 'danger';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-[2rem] border bg-white shadow-soft',
        tone === 'danger' ? 'border-red/20' : 'border-rim',
        className,
      )}
    >
      {children}
    </div>
  );
}
