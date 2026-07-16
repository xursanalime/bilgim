'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Radio,
  Sparkles,
  ClipboardCheck,
  Trophy,
  MessageSquare,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '../../lib/utils';

// ═════════════════════════════════════════════════════════════════
// FeatureShowcase — interactive, theme-aware product tour.
//
// A modern split layout: a vertical list of the platform's real
// capabilities on the left; a live-updating glass preview panel on the
// right. Fully driven by semantic design tokens so it flips cleanly in
// dark mode. Pure client-side (no data) — it "opens up" what the app does.
// ═════════════════════════════════════════════════════════════════

type Accent = 'red' | 'purple' | 'blue' | 'orange' | 'teal' | 'green';

interface Feature {
  id: string;
  icon: LucideIcon;
  accent: Accent;
  title: string;
  tagline: string;
  bullets: string[];
  preview: () => JSX.Element;
}

const ACCENT: Record<Accent, { chip: string; dot: string; ring: string; text: string }> = {
  red: { chip: 'bg-red/10 text-red', dot: 'bg-red', ring: 'ring-red/30', text: 'text-red' },
  purple: { chip: 'bg-purple/10 text-purple', dot: 'bg-purple', ring: 'ring-purple/30', text: 'text-purple' },
  blue: { chip: 'bg-blue/10 text-blue', dot: 'bg-blue', ring: 'ring-blue/30', text: 'text-blue' },
  orange: { chip: 'bg-orange/10 text-orange', dot: 'bg-orange', ring: 'ring-orange/30', text: 'text-orange' },
  teal: { chip: 'bg-teal/10 text-teal', dot: 'bg-teal', ring: 'ring-teal/30', text: 'text-teal' },
  green: { chip: 'bg-green/10 text-green', dot: 'bg-green', ring: 'ring-green/30', text: 'text-green' },
};

const FEATURES: readonly Feature[] = [
  {
    id: 'live',
    icon: Radio,
    accent: 'red',
    title: 'Jonli darslar',
    tagline: 'HD video, ekran ulashish va interaktiv doska — bir oynada.',
    bullets: ['Past kechikishli video/audio', 'Birgalikda chiziladigan doska', 'Qo‘l ko‘tarish va chat'],
    preview: LivePreview,
  },
  {
    id: 'ai',
    icon: Sparkles,
    accent: 'purple',
    title: 'AI Tutor',
    tagline: 'Tayyor javob bermaydi — o‘rganishga yo‘naltiradi.',
    bullets: ['Tushuntirish va misollar', 'Tarjima va talaffuz', '24/7 yordamchi'],
    preview: AiPreview,
  },
  {
    id: 'homework',
    icon: ClipboardCheck,
    accent: 'blue',
    title: 'Uy ishlari va baholash',
    tagline: '8 ta ingliz skili bo‘yicha topshiriq va AI yordamida baholash.',
    bullets: ['Avtomatik tekshirish', 'Rubrika bo‘yicha baho', 'Fikr-mulohaza'],
    preview: HomeworkPreview,
  },
  {
    id: 'gamification',
    icon: Trophy,
    accent: 'orange',
    title: 'Geymifikatsiya',
    tagline: 'XP, darajalar, kunlik streak va nishonlar bilan motivatsiya.',
    bullets: [
      'Har bir vazifa va dars uchun XP',
      'Daraja (level) va progress chizig‘i',
      'Kunlik streak va "muzlatish" (freeze)',
      'Nishonlar (badge) va yutuqlar',
      'Haftalik reyting jadvali',
      'XP do‘koni — mukofotlarga almashtirish',
    ],
    preview: GamificationPreview,
  },
  {
    id: 'messaging',
    icon: MessageSquare,
    accent: 'teal',
    title: 'Xabarlar va guruhlar',
    tagline: 'Shaxsiy chat va Telegram uslubidagi guruhlar — bir joyda.',
    bullets: [
      'Real-time shaxsiy suhbatlar',
      'Guruh chati (Telegram uslubida)',
      'Rasm, video va fayl yuborish',
      'O‘qildi belgilari va yozilmoqda holati',
      'Push va in-app bildirishnomalar',
      'Guruh a’zolari va rollarni boshqarish',
    ],
    preview: MessagingPreview,
  },
];

export function FeatureShowcase({ locale: _locale }: { locale: string }) {
  const [activeId, setActiveId] = useState(FEATURES[0]!.id);
  const active = FEATURES.find((f) => f.id === activeId) ?? FEATURES[0]!;
  const Preview = active.preview;

  return (
    <section id="showcase" className="relative overflow-hidden py-20 sm:py-28">
      <div className="pointer-events-none absolute inset-0 bg-dotgrid opacity-[0.15]" />

      <div className="container-aurora relative">
        {/* Heading */}
        <div className="mx-auto max-w-2xl text-center">
          <span className="liquid-glass inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-[0.18em] text-ink-soft">
            <Sparkles className="h-3.5 w-3.5 text-blue" /> Platforma imkoniyatlari
          </span>
          <h2
            className="mt-5 font-display font-extrabold tracking-tight text-ink-strong"
            style={{ fontSize: 'clamp(2rem, 4.5vw, 3.25rem)', letterSpacing: '-0.04em' }}
          >
            Bitta tizimda — barcha kerakli vositalar
          </h2>
          <p className="mt-4 text-base leading-relaxed text-ink-soft sm:text-lg">
            Jonli dars, AI yordamchi, uy ishlari va geymifikatsiya —
            o‘qitish va o‘rganish uchun zarur hamma narsa.
          </p>
        </div>

        {/* Split layout */}
        <div className="mt-14 grid gap-6 lg:grid-cols-12 lg:gap-8">
          {/* Feature list */}
          <div className="lg:col-span-5">
            <ul className="space-y-2.5">
              {FEATURES.map((f) => {
                const Icon = f.icon;
                const a = ACCENT[f.accent];
                const isActive = f.id === activeId;
                return (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => setActiveId(f.id)}
                      aria-pressed={isActive}
                      className={cn(
                        'group flex w-full items-start gap-4 rounded-3xl border p-4 text-left transition-all outline-none focus-visible:ring-2 focus-visible:ring-blue',
                        isActive
                          ? 'border-rim-2 bg-canvas shadow-medium'
                          : 'border-rim bg-canvas/40 hover:bg-canvas/70',
                      )}
                    >
                      <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl', a.chip)}>
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="text-base font-extrabold tracking-tight text-ink-strong">
                            {f.title}
                          </span>
                          {isActive && (
                            <span className={cn('h-1.5 w-1.5 rounded-full', a.dot)} aria-hidden="true" />
                          )}
                        </span>
                        <span className="mt-0.5 block text-sm text-ink-soft">{f.tagline}</span>
                        <AnimatePresence initial={false}>
                          {isActive && (
                            <motion.span
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.25 }}
                              className="mt-3 block overflow-hidden"
                            >
                              <span className="flex flex-wrap gap-2">
                                {f.bullets.map((b) => (
                                  <span
                                    key={b}
                                    className="inline-flex items-center gap-1.5 rounded-full bg-tint px-2.5 py-1 text-xs font-medium text-ink-soft"
                                  >
                                    <span className={cn('h-1 w-1 rounded-full', a.dot)} />
                                    {b}
                                  </span>
                                ))}
                              </span>
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Preview panel */}
          <div className="lg:col-span-7">
            <div className="liquid-glass-strong relative h-full min-h-[420px] overflow-hidden rounded-[2rem] p-3 sm:p-4">
              {/* Window chrome */}
              <div className="flex items-center justify-between rounded-2xl border-b border-rim/60 bg-canvas px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-red" />
                  <span className="h-2.5 w-2.5 rounded-full bg-orange" />
                  <span className="h-2.5 w-2.5 rounded-full bg-green" />
                </div>
                <span className="hidden font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint sm:inline">
                  bilgim.uz / {active.id}
                </span>
                <span className={cn('rounded-full px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.15em]', ACCENT[active.accent].chip)}>
                  {active.title}
                </span>
              </div>

              <div className="p-4 sm:p-6">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={active.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12 }}
                    transition={{ duration: 0.3 }}
                  >
                    <Preview />
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────
// Preview panels — lightweight, token-driven mock UIs
// ─────────────────────────────────────────────────────────────────

function LivePreview() {
  return (
    <div className="space-y-3">
      <div className="relative aspect-video overflow-hidden rounded-2xl bg-ink-strong">
        {/* Real footage so it reads like an actual live broadcast in progress. */}
        <video
          className="absolute inset-0 h-full w-full object-cover"
          src="https://assets.mixkit.co/videos/28287/28287-720.mp4"
          poster="https://images.unsplash.com/photo-1580894732444-8ecded7900cd?auto=format&fit=crop&w=1200&q=80"
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          aria-hidden="true"
        />
        <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1 backdrop-blur">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red opacity-75" />
            <span className="relative h-1.5 w-1.5 rounded-full bg-red" />
          </span>
          <span className="font-mono text-[9px] font-bold uppercase tracking-[0.15em] text-white/90">Jonli · 42</span>
        </div>
        {/* Participant strip — small student tiles overlapping the stage. */}
        <div className="absolute bottom-3 right-3 flex items-center gap-1.5">
          {['/videos/student-1.mp4', '/videos/student-2.mp4', '/videos/student-3.mp4'].map((src) => (
            <span key={src} className="relative h-12 w-16 overflow-hidden rounded-lg border border-white/20 shadow-lg">
              <video className="h-full w-full object-cover" src={src} autoPlay loop muted playsInline aria-hidden="true" />
            </span>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {['Doska', 'Chat', 'Ishtirokchilar'].map((t) => (
          <div key={t} className="rounded-xl border border-rim bg-canvas px-3 py-2 text-center text-xs font-semibold text-ink-soft">
            {t}
          </div>
        ))}
      </div>
    </div>
  );
}

function AiPreview() {
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-blue px-4 py-2.5 text-sm font-medium text-white">
          Present Perfect ni tushuntirib bering
        </div>
      </div>
      <div className="flex items-start gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-purple text-white">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="max-w-[85%] rounded-2xl rounded-tl-sm border border-rim bg-canvas px-4 py-3 text-sm leading-relaxed text-ink-soft">
          Present Perfect o‘tmishda boshlanib hozirgacha aloqador ish-harakatni bildiradi.
          Keling, avval bitta misol bilan o‘zingiz urinib ko‘ring 👇
        </div>
      </div>
      <div className="flex flex-wrap gap-2 pl-10">
        {['Misol bering', 'Tarjima qiling', 'Mashq'].map((t) => (
          <span key={t} className="rounded-full bg-purple/10 px-3 py-1 text-xs font-semibold text-purple">{t}</span>
        ))}
      </div>
    </div>
  );
}

function HomeworkPreview() {
  const skills: { name: string; pct: number; tone: Accent }[] = [
    { name: 'Writing', pct: 88, tone: 'blue' },
    { name: 'Grammar', pct: 72, tone: 'purple' },
    { name: 'Vocabulary', pct: 95, tone: 'green' },
    { name: 'Listening', pct: 64, tone: 'orange' },
  ];
  return (
    <div className="space-y-3">
      {skills.map((s) => (
        <div key={s.name} className="rounded-xl border border-rim bg-canvas p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-ink-strong">{s.name}</span>
            <span className={cn('text-xs font-extrabold', ACCENT[s.tone].text)}>{s.pct}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-soft">
            <div className={cn('h-full rounded-full', ACCENT[s.tone].dot)} style={{ width: `${s.pct}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function GamificationPreview() {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 rounded-2xl border border-orange/20 bg-orange/[0.05] p-4">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-orange/15 text-orange">
          <Trophy className="h-7 w-7" />
        </span>
        <div className="flex-1">
          <p className="text-sm font-bold text-ink-strong">5-daraja · 600 / 800 XP</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-soft">
            <div className="h-full rounded-full bg-orange" style={{ width: '75%' }} />
          </div>
          <p className="mt-1 text-[11px] text-ink-faint">6-darajagacha 200 XP qoldi</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[{ l: 'Streak', v: '12 kun' }, { l: 'Nishonlar', v: '8' }, { l: 'Reyting', v: '#3' }].map((x) => (
          <div key={x.l} className="rounded-xl border border-rim bg-canvas p-3 text-center">
            <p className="text-lg font-extrabold text-ink-strong">{x.v}</p>
            <p className="font-mono text-[9px] uppercase tracking-widest text-ink-faint">{x.l}</p>
          </div>
        ))}
      </div>
      {/* Badges row */}
      <div className="flex items-center gap-2 rounded-xl border border-rim bg-canvas p-3">
        {['🏆', '🔥', '⭐', '📚', '🎯'].map((b) => (
          <span key={b} className="flex h-9 w-9 items-center justify-center rounded-xl bg-tint text-lg">{b}</span>
        ))}
        <span className="ml-auto text-[11px] font-semibold text-ink-soft">+3 nishon</span>
      </div>
      {/* Mini leaderboard */}
      <div className="rounded-xl border border-rim bg-canvas p-3">
        <p className="mb-2 font-mono text-[9px] uppercase tracking-widest text-ink-faint">Haftalik reyting</p>
        {[
          { r: 1, n: 'Diyora', xp: '1 240', me: false },
          { r: 2, n: 'Sardor', xp: '1 110', me: false },
          { r: 3, n: 'Siz', xp: '980', me: true },
        ].map((p) => (
          <div key={p.r} className={cn('flex items-center justify-between rounded-lg px-2 py-1 text-xs', p.me ? 'bg-orange/10 font-bold text-orange' : 'text-ink-soft')}>
            <span>{p.r}. {p.n}</span>
            <span className="font-mono">{p.xp} XP</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MessagingPreview() {
  return (
    <div className="space-y-3">
      {/* Group chat header (Telegram-style) */}
      <div className="flex items-center gap-3 rounded-2xl border border-rim bg-canvas p-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal/15 text-teal">
          <MessageSquare className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-ink-strong">IELTS Speaking · Guruh</p>
          <p className="truncate text-[11px] text-ink-soft">24 a’zo · 3 ta yozmoqda…</p>
        </div>
        <div className="flex -space-x-1.5">
          {['from-blue-400 to-blue-600', 'from-green-400 to-green-600', 'from-purple-400 to-purple-600'].map((g) => (
            <span key={g} className={`h-6 w-6 rounded-full border-2 border-canvas bg-gradient-to-br ${g}`} />
          ))}
        </div>
      </div>
      <div className="flex items-start gap-2.5">
        <span className="h-8 w-8 shrink-0 rounded-full bg-gradient-to-br from-blue-400 to-blue-600" />
        <div className="rounded-2xl rounded-tl-sm border border-rim bg-canvas px-4 py-2.5 text-sm text-ink-soft">
          <span className="mb-0.5 block text-[11px] font-bold text-blue">Sevara opa</span>
          Bugungi dars soat 18:00 da. Tayyor bo‘ling 🙌
        </div>
      </div>
      <div className="flex items-start justify-end gap-2.5">
        <div className="rounded-2xl rounded-tr-sm bg-teal px-4 py-2.5 text-sm font-medium text-white">
          Rahmat! Albatta qatnashaman ✅
        </div>
      </div>
      <div className="flex items-center gap-2 rounded-full border border-rim bg-canvas px-4 py-2.5">
        <span className="flex-1 text-sm text-ink-faint">Xabar yozing…</span>
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal text-white">
          <MessageSquare className="h-3.5 w-3.5" />
        </span>
      </div>
    </div>
  );
}
