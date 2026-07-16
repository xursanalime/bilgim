'use client';

import { motion } from 'framer-motion';

/**
 * HeroVisual — animated product mockup, dark theme with green accents.
 * Shows a stack of floating cards: dashboard, AI tutor chat, and stats.
 */
export function HeroVisual() {
  return (
    <div className="relative mx-auto h-[480px] w-full max-w-md sm:h-[560px]">
      {/* Background green glow */}
      <div className="pointer-events-none absolute inset-0 rounded-[3rem] bg-accent2-500/15 blur-3xl" />

      {/* Main dashboard card */}
      <motion.div
        initial={{ opacity: 0, y: 40, rotate: -2 }}
        animate={{ opacity: 1, y: 0, rotate: -2 }}
        transition={{ duration: 0.8, delay: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="absolute left-0 top-8 w-[88%] origin-bottom-left"
      >
        <div className="overflow-hidden rounded-3xl border border-white/[0.07] bg-ink-surface shadow-2xl">
          {/* Browser chrome */}
          <div className="flex items-center gap-1.5 border-b border-white/[0.07] bg-white/[0.02] px-4 py-3">
            <div className="h-2.5 w-2.5 rounded-full bg-white/10" />
            <div className="h-2.5 w-2.5 rounded-full bg-white/10" />
            <div className="h-2.5 w-2.5 rounded-full bg-accent2-500/60" />
            <div className="ml-3 h-5 flex-1 rounded-md bg-white/[0.04]" />
          </div>

          {/* Dashboard content */}
          <div className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-cream-dim">
                  Mening kursim
                </div>
                <div className="mt-1 text-base font-extrabold tracking-tight text-cream">
                  English Pre-Intermediate
                </div>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent2-500 text-sm font-bold text-ink">
                S
              </div>
            </div>

            {/* Live indicator */}
            <div className="mt-4 flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3">
              <div className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
              </div>
              <div className="flex-1">
                <div className="text-xs font-bold text-cream">
                  Hozir jonli efir
                </div>
                <div className="text-[10px] text-cream-dim">
                  Lesson 12 · 47 talaba ko&apos;rmoqda
                </div>
              </div>
              {/* Decorative mockup button — no action; kept out of the tab
                  order and a11y tree. */}
              <button
                aria-hidden="true"
                tabIndex={-1}
                className="rounded-full bg-accent2-500 px-3 py-1 text-[10px] font-bold text-ink"
              >
                Qo&apos;shilish
              </button>
            </div>

            {/* Progress */}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-cream-dim">
                  Bajarilgan
                </div>
                <div className="mt-1 text-xl font-extrabold tracking-tight text-cream">
                  12/20
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: '60%' }}
                    transition={{ duration: 1.5, delay: 1.2 }}
                    className="h-full rounded-full bg-accent2-500"
                  />
                </div>
              </div>
              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-cream-dim">
                  Baho
                </div>
                <div className="mt-1 text-xl font-extrabold tracking-tight text-cream">
                  8.5
                </div>
                <div className="mt-2 flex gap-0.5">
                  {[...Array(5)].map((_, i) => (
                    <svg
                      key={i}
                      viewBox="0 0 24 24"
                      fill={i < 4 ? 'currentColor' : 'none'}
                      stroke="currentColor"
                      strokeWidth="2"
                      className={`h-3 w-3 ${
                        i < 4 ? 'text-accent2-500' : 'text-white/10'
                      }`}
                    >
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Floating AI chat card */}
      <motion.div
        initial={{ opacity: 0, y: 60, rotate: 5 }}
        animate={{ opacity: 1, y: 0, rotate: 5 }}
        transition={{ duration: 0.8, delay: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className="absolute -right-2 bottom-12 w-[64%] origin-bottom-right"
      >
        <div className="rounded-3xl border border-white/[0.07] bg-ink-surface p-4 shadow-2xl">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent2-500 shadow-[0_0_12px_rgba(0,232,122,0.5)]">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4 text-ink"
              >
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
            </div>
            <div className="text-xs font-bold text-cream">AI Tutor</div>
            <div className="ml-auto rounded-full bg-accent2-500/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-accent2-500">
              Online
            </div>
          </div>

          <div className="mt-3 space-y-2">
            <div className="rounded-2xl rounded-tl-sm bg-white/[0.04] p-2.5">
              <div className="text-[11px] leading-snug text-cream">
                &ldquo;Present Perfect&rdquo; ni tushuntir
              </div>
            </div>

            <div className="rounded-2xl rounded-tr-sm bg-accent2-500 p-2.5">
              <div className="text-[11px] leading-snug text-ink">
                Ushbu zamon o&apos;tmishda boshlangan, hozirgacha davom etayotgan
                harakat uchun ishlatiladi...
              </div>
            </div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.5 }}
              className="flex items-center gap-1 text-[10px] text-cream-dim"
            >
              <span className="flex gap-0.5">
                <span className="h-1 w-1 animate-bounce rounded-full bg-accent2-500" />
                <span
                  className="h-1 w-1 animate-bounce rounded-full bg-accent2-500"
                  style={{ animationDelay: '0.15s' }}
                />
                <span
                  className="h-1 w-1 animate-bounce rounded-full bg-accent2-500"
                  style={{ animationDelay: '0.3s' }}
                />
              </span>
              yozmoqda...
            </motion.div>
          </div>
        </div>
      </motion.div>

      {/* Stats badge — top right */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8, rotate: -8 }}
        animate={{ opacity: 1, scale: 1, rotate: -8 }}
        transition={{ duration: 0.6, delay: 1, type: 'spring', stiffness: 200 }}
        className="absolute -right-4 top-4 animate-float"
      >
        <div className="rounded-2xl border border-accent2-500/30 bg-accent2-500/10 px-4 py-3 shadow-[0_0_24px_rgba(0,232,122,0.4)] backdrop-blur-md">
          <div className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-accent2-500">
            Bu hafta
          </div>
          <div className="text-2xl font-extrabold tracking-tight text-cream">
            +24%
          </div>
        </div>
      </motion.div>

      {/* Notification toast — bottom left */}
      <motion.div
        initial={{ opacity: 0, x: -40 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6, delay: 1.4 }}
        className="absolute -bottom-2 left-2 max-w-[180px]"
      >
        <div className="rounded-2xl border border-white/[0.07] bg-ink-surface p-3 shadow-xl">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent2-500/10 ring-1 ring-inset ring-accent2-500/30">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                className="h-3.5 w-3.5 text-accent2-500"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <div>
              <div className="text-[10px] font-bold text-cream">
                Uy vazifasi qabul
              </div>
              <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-cream-dim">
                2 daqiqa oldin
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
