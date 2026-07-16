'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play,
  X,
  ArrowRight,
  ArrowLeft,
  Radio,
  Sparkles,
  ClipboardCheck,
  Trophy,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '../../lib/utils';
import { useFocusTrap } from '../../lib/a11y/use-focus-trap';

// ═════════════════════════════════════════════════════════════════
// DemoButton + DemoModal — a lightweight "demo mode" for the landing page.
//
// Clicking the hero's secondary CTA opens a guided, stepped product tour
// (no login, no data). Each step highlights a real capability with a
// theme-aware mock preview, prev/next navigation, and a final register CTA.
// ═════════════════════════════════════════════════════════════════

type Accent = 'red' | 'purple' | 'blue' | 'orange' | 'green';

interface Step {
  icon: LucideIcon;
  accent: Accent;
  title: string;
  body: string;
  visual: () => JSX.Element;
}

const ACCENT: Record<Accent, { chip: string; dot: string; grad: string }> = {
  red: { chip: 'bg-red/10 text-red', dot: 'bg-red', grad: 'from-red/30' },
  purple: { chip: 'bg-purple/10 text-purple', dot: 'bg-purple', grad: 'from-purple/30' },
  blue: { chip: 'bg-blue/10 text-blue', dot: 'bg-blue', grad: 'from-blue/30' },
  orange: { chip: 'bg-orange/10 text-orange', dot: 'bg-orange', grad: 'from-orange/30' },
  green: { chip: 'bg-green/10 text-green', dot: 'bg-green', grad: 'from-green/30' },
};

const STEPS: readonly Step[] = [
  {
    icon: Radio,
    accent: 'red',
    title: 'Jonli dars o‘ting',
    body: 'HD video, ekran ulashish va interaktiv doska bilan real vaqtda dars o‘ting. Talabalar bir bosishda qo‘shiladi.',
    visual: VisualLive,
  },
  {
    icon: Sparkles,
    accent: 'purple',
    title: 'AI Tutor bilan o‘rganing',
    body: 'AI tayyor javob bermaydi — tushuntiradi, misol beradi va o‘rganishga yo‘naltiradi. 24/7 ishlaydi.',
    visual: VisualAi,
  },
  {
    icon: ClipboardCheck,
    accent: 'blue',
    title: 'Uy ishlarini baholang',
    body: '8 ta ingliz skili bo‘yicha topshiriqlar yarating; AI yordamida tez va adolatli baholang.',
    visual: VisualHomework,
  },
  {
    icon: Trophy,
    accent: 'orange',
    title: 'Motivatsiyani oshiring',
    body: 'XP, darajalar, kunlik streak va nishonlar talabalarni har kuni qaytishga undaydi.',
    visual: VisualGamify,
  },
];

export function DemoButton({ locale }: { locale: string }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);

  useFocusTrap(dialogRef, { active: open, onClose: () => setOpen(false) });

  const close = () => {
    setOpen(false);
    setStep(0);
  };

  const current = STEPS[step]!;
  const Visual = current.visual;
  const a = ACCENT[current.accent];
  const isLast = step === STEPS.length - 1;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group inline-flex items-center justify-center gap-2.5 rounded-full border border-rim-2 bg-canvas px-6 py-3.5 text-sm font-bold text-ink-strong shadow-soft transition-all hover:border-blue/40 hover:bg-blue-tint hover:shadow-medium active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue focus-visible:ring-offset-2 sm:text-base"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue text-white shadow-[0_4px_12px_-2px_rgba(0,113,227,0.5)] transition-transform group-hover:scale-110">
          <Play className="h-3 w-3 translate-x-[1px] fill-white" />
        </span>
        Demo ko&apos;rish
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-md"
            onClick={(e) => {
              if (e.target === e.currentTarget) close();
            }}
          >
            <motion.div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-label="Bilgim demo"
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              transition={{ duration: 0.25 }}
              className="relative w-full max-w-3xl overflow-hidden rounded-[2rem] border border-rim bg-canvas shadow-2xl"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-rim px-6 py-4">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue text-white">
                    <Play className="h-4 w-4 fill-white" />
                  </span>
                  <div>
                    <p className="text-sm font-extrabold tracking-tight text-ink-strong">Bilgim demo</p>
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
                      {step + 1} / {STEPS.length}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Yopish"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-tint hover:text-ink-strong"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Body */}
              <div className="grid gap-6 p-6 sm:grid-cols-2 sm:p-8">
                {/* Visual */}
                <div className="order-1 sm:order-none">
                  <div className="relative overflow-hidden rounded-2xl border border-rim bg-ink-strong">
                    <div className={cn('absolute inset-0 bg-gradient-to-br to-transparent', a.grad)} />
                    <div className="relative p-4">
                      <AnimatePresence mode="wait">
                        <motion.div
                          key={step}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          transition={{ duration: 0.25 }}
                        >
                          <Visual />
                        </motion.div>
                      </AnimatePresence>
                    </div>
                  </div>
                </div>

                {/* Copy */}
                <div className="flex flex-col">
                  <span className={cn('inline-flex w-fit items-center gap-2 rounded-full px-3 py-1 text-xs font-bold', a.chip)}>
                    <current.icon className="h-3.5 w-3.5" /> Imkoniyat
                  </span>
                  <h3 className="mt-3 text-2xl font-extrabold tracking-tight text-ink-strong">
                    {current.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-soft">{current.body}</p>

                  {/* Dots */}
                  <div className="mt-5 flex items-center gap-1.5">
                    {STEPS.map((_, i) => (
                      <button
                        key={i}
                        type="button"
                        aria-label={`${i + 1}-qadam`}
                        onClick={() => setStep(i)}
                        className={cn(
                          'h-1.5 rounded-full transition-all',
                          i === step ? cn('w-6', a.dot) : 'w-1.5 bg-soft hover:bg-ink-faint',
                        )}
                      />
                    ))}
                  </div>

                  {/* Nav */}
                  <div className="mt-auto flex items-center justify-between gap-3 pt-6">
                    <button
                      type="button"
                      onClick={() => setStep((s) => Math.max(0, s - 1))}
                      disabled={step === 0}
                      className="inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-semibold text-ink-soft transition-colors hover:bg-tint disabled:opacity-40"
                    >
                      <ArrowLeft className="h-4 w-4" /> Orqaga
                    </button>

                    {isLast ? (
                      <Link
                        href={`/${locale}/register?role=teacher`}
                        className="inline-flex items-center gap-2 rounded-full bg-blue px-5 py-2.5 text-sm font-bold text-white transition-all hover:bg-blue-600 active:scale-[0.97]"
                      >
                        Bepul boshlash <ArrowRight className="h-4 w-4" />
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
                        className="inline-flex items-center gap-2 rounded-full bg-blue px-5 py-2.5 text-sm font-bold text-white transition-all hover:bg-blue-600 active:scale-[0.97]"
                      >
                        Keyingi <ArrowRight className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ─── Step visuals (compact, theme-aware) ──────────────────────────

function VisualLive() {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1 w-fit">
        <span className="h-1.5 w-1.5 rounded-full bg-red animate-pulse" />
        <span className="font-mono text-[9px] font-bold uppercase tracking-[0.15em] text-white/80">Jonli · 42</span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <span key={i} className="aspect-video rounded-lg bg-white/10" />
        ))}
      </div>
    </div>
  );
}

function VisualAi() {
  return (
    <div className="space-y-2">
      <div className="ml-auto w-fit rounded-xl rounded-tr-sm bg-blue px-3 py-2 text-[11px] font-medium text-white">
        Past tense?
      </div>
      <div className="flex items-start gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple text-white">
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        <div className="rounded-xl rounded-tl-sm bg-white/10 px-3 py-2 text-[11px] text-white/80">
          Avval bitta misol bilan urinib ko‘ring 👇
        </div>
      </div>
    </div>
  );
}

function VisualHomework() {
  return (
    <div className="space-y-2">
      {[88, 72, 95].map((p, i) => (
        <div key={i}>
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-blue" style={{ width: `${p}%` }} />
          </div>
        </div>
      ))}
      <p className="font-mono text-[9px] uppercase tracking-widest text-white/50">AI baholash · 3 skill</p>
    </div>
  );
}

function VisualGamify() {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Trophy className="h-6 w-6 text-orange" />
        <span className="text-xs font-bold text-white/90">5-daraja</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-orange" style={{ width: '75%' }} />
      </div>
      <div className="flex gap-1.5">
        {['🔥 12', '🏅 8', '#3'].map((t) => (
          <span key={t} className="rounded-md bg-white/10 px-2 py-1 text-[10px] font-bold text-white/80">{t}</span>
        ))}
      </div>
    </div>
  );
}
