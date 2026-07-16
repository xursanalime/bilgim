'use client';

/**
 * AiChatWidget — the consistent, app-wide BilgimAI entry point (Req 11.5).
 *
 * Mounted in both authenticated shells ((dashboard) and (dashboard-full)
 * layouts), this floating launcher is the single discoverable way to reach
 * BilgimAI from anywhere. The panel hosts the full {@link BilgimAiTutor}
 * surface — intent selection, hint-only framing, rate-limit display and the
 * streaming reveal all live there, so the launcher and the dedicated
 * `/bilgim-ai` route share one implementation.
 *
 * The export name / signature are preserved so the shell layouts that mount
 * `<AiChatWidget role={...} />` need no changes.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, ChevronDown, Maximize2 } from 'lucide-react';

import { BilgimAiTutor } from './bilgim-ai-tutor';

export function AiChatWidget({ role }: { role: 'STUDENT' | 'TEACHER' | 'ADMIN' }) {
  const [open, setOpen] = useState(false);
  const params = useParams();
  const locale = typeof params?.locale === 'string' ? params.locale : 'uz';

  const launcherRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // Close on Escape for keyboard users.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // When the panel closes, return focus to the launcher that opened it (Req 7.3).
  useEffect(() => {
    if (wasOpen.current && !open) launcherRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  return (
    <>
      {/* Floating launcher — purple AI accent (Req 11.4, 11.5) */}
      <div className="fixed bottom-6 right-6 z-[300] print:hidden">
        <AnimatePresence>
          {!open && (
            <motion.button
              type="button"
              ref={launcherRef}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              onClick={() => setOpen(true)}
              aria-label="BilgimAI repetitorini ochish"
              className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-purple to-blue text-white shadow-[0_8px_30px_rgba(175,82,222,0.45)] transition-transform hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/60 focus-visible:ring-offset-2"
            >
              <Sparkles className="h-6 w-6" aria-hidden="true" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Tutor panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-modal="false"
            aria-label="BilgimAI repetitori"
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.96 }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed bottom-6 right-6 z-[300] flex h-[600px] max-h-[calc(100vh-3rem)] w-[400px] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-[1.75rem] border border-rim bg-canvas shadow-[0_30px_80px_-10px_rgba(0,0,0,0.35)] print:hidden"
          >
            {/* Panel controls */}
            <div className="absolute right-3 top-3 z-10 flex items-center gap-1">
              <Link
                href={`/${locale}/bilgim-ai`}
                onClick={() => setOpen(false)}
                aria-label="To‘liq ekranda ochish"
                title="To‘liq ekran"
                className="flex h-8 w-8 items-center justify-center rounded-xl text-ink-faint transition-colors hover:bg-purple-tint hover:text-purple focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/50"
              >
                <Maximize2 className="h-4 w-4" aria-hidden="true" />
              </Link>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Yopish"
                className="flex h-8 w-8 items-center justify-center rounded-xl text-ink-faint transition-colors hover:bg-tint hover:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/50"
              >
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <BilgimAiTutor locale={locale} role={role} variant="panel" className="h-full" />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
