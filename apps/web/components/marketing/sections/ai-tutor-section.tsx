'use client';

import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { AuroraBg } from '../effects/aurora-bg';

/**
 * AiTutorSection — Claude AI tutor showcase.
 *
 * Asosiy qoida: AI talabaga JAVOB BERMAYDI, faqat tushuntiradi.
 * Bu Anti-cheating prinsipi va Claude prompt hardening bilan ta'minlangan.
 */
export function AiTutorSection() {
  return (
    <section
      id="ai-tutor"
      className="relative isolate overflow-hidden bg-ink py-24 sm:py-32"
    >
      <AuroraBg variant="green" />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-16">
          {/* Left — text content */}
          <div className="lg:col-span-5">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-100px' }}
              transition={{ duration: 0.6 }}
            >
              <span className="inline-flex items-center gap-2 rounded-full border border-accent2-500/30 bg-accent2-500/10 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-accent2-500">
                <SparkIcon />
                AI Tutor
              </span>
            </motion.div>

            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="mt-5 text-balance font-extrabold tracking-tight text-cream"
              style={{
                fontSize: 'clamp(2.25rem, 5vw, 4rem)',
                letterSpacing: '-0.04em',
              }}
            >
              Tushuntiradi.{' '}
              <span className="block text-accent2-500">Javob bermaydi.</span>
            </motion.h2>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="mt-5 text-base leading-relaxed text-cream-dim sm:text-lg"
            >
              Claude AI bilan jihozlangan tutor talabaga vazifa javobini
              YOZIB BERMAYDI. Faqat tushuntiradi, misol keltiradi va
              o&apos;rgatadi. Plagiat oldini olish va o&apos;quv samaradorligi
              uchun.
            </motion.p>

            {/* Feature checklist */}
            <motion.ul
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="mt-8 space-y-3"
            >
              {[
                {
                  icon: '💡',
                  title: 'Tushunish va tushuntirish',
                  desc: 'Mavzularni qadamma-qadam tushuntirish, misollar bilan',
                },
                {
                  icon: '🌐',
                  title: 'Tarjima yordamida',
                  desc: "So'z va jumla tarjimasi (uz, ru, en) — Reading modulda",
                },
                {
                  icon: '🛡️',
                  title: 'Plagiat tekshiruvi',
                  desc: 'AI-text detector orqali submission integriteti',
                },
                {
                  icon: '⚖️',
                  title: 'Grading assistant',
                  desc: "O'qituvchi uchun precheck va xatolarni belgilash",
                },
              ].map((f) => (
                <li key={f.title} className="flex items-start gap-3">
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-accent2-500/10 ring-1 ring-inset ring-accent2-500/30">
                    <span className="text-base">{f.icon}</span>
                  </span>
                  <div>
                    <p
                      className="font-bold text-cream"
                      style={{ letterSpacing: '-0.02em' }}
                    >
                      {f.title}
                    </p>
                    <p className="text-sm text-cream-dim">{f.desc}</p>
                  </div>
                </li>
              ))}
            </motion.ul>

            <motion.div
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.4 }}
              className="mt-8 flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3"
            >
              <span className="text-2xl">🔒</span>
              <div className="text-xs">
                <p className="font-bold text-cream">Audit + cost tracking</p>
                <p className="text-cream-dim">
                  Har bir AI chaqiruv qayd etiladi
                </p>
              </div>
            </motion.div>
          </div>

          {/* Right — chat mockup */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, margin: '-100px' }}
            transition={{ duration: 0.7 }}
            className="lg:col-span-7"
          >
            <ChatDemo />
          </motion.div>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────

function ChatDemo() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setStep((s) => (s + 1) % 6);
    }, 2500);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-ink-surface/60 backdrop-blur-xl"
      style={{
        boxShadow:
          '0 0 0 1px rgba(255,255,255,0.05), 0 50px 120px -30px rgba(0,232,122,0.4), inset 0 0 60px rgba(0,232,122,0.04)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
        <div className="flex items-center gap-3">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent2-500 text-ink"
            style={{ boxShadow: '0 0 16px rgba(0,232,122,0.5)' }}
          >
            <SparkIcon />
          </div>
          <div>
            <p className="text-sm font-bold text-cream">Bilgim AI Tutor</p>
            <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-cream-dim">
              <span className="h-1.5 w-1.5 rounded-full bg-accent2-500" />
              Onlayn · Claude API
            </p>
          </div>
        </div>
        <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.15em] text-cream-dim">
          v3.5 Sonnet
        </span>
      </div>

      {/* Messages */}
      <div className="relative h-[460px] space-y-4 overflow-hidden px-5 py-6">
        {/* Subject context */}
        <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
          <span className="text-base">📖</span>
          <span className="text-xs font-medium text-cream-dim">
            Reading · 5-sinf · Past Tense
          </span>
        </div>

        {/* Q1 */}
        <ChatMessage role="user" delay={step >= 0 ? 0 : 999}>
          Past tense nima va qachon ishlatiladi?
        </ChatMessage>

        {/* AI response 1 */}
        <ChatMessage role="ai" delay={step >= 1 ? 0 : 999}>
          Past tense — ingliz tilidagi o&apos;tgan zamon. U bo&apos;lib
          o&apos;tgan harakat yoki holatni ifodalaydi.
          <br />
          <br />
          <span className="font-mono text-[10px] text-accent2-500">
            Misollar:
          </span>
          <br />
          • I <span className="font-bold">went</span> to school yesterday
          <br />
          • She <span className="font-bold">studied</span> hard
        </ChatMessage>

        {/* Q2 — student tries to cheat */}
        <ChatMessage role="user" delay={step >= 2 ? 0 : 999}>
          &quot;He goes to school every day&quot; gapini past tense ga
          o&apos;tkazib bering
        </ChatMessage>

        {/* AI refusal */}
        <ChatMessage role="ai" delay={step >= 3 ? 0 : 999} flagged>
          🛡️ Bu vazifaning yechimi. Men javobni yozib bera olmayman, lekin
          o&apos;rgataman:
          <br />
          <br />
          1. <span className="font-bold">goes</span> — bu hozirgi zamon (3-shaxs
          birlik)
          <br />
          2. Past tense da fe&apos;l shakli o&apos;zgaradi
          <br />
          3. <span className="font-bold">go</span> noregular fe&apos;l —
          uchinchi shakli{' '}
          <span className="font-mono text-accent2-500">went</span>
          <br />
          <br />
          Endi siz o&apos;zingiz urinib ko&apos;ring 💪
        </ChatMessage>

        {/* Bottom indicator */}
        {step < 5 && (
          <div
            className="absolute bottom-6 left-5 flex items-center gap-2 font-mono text-[10px] text-cream-dim"
            style={{
              opacity: step === 4 || step === 5 ? 1 : 0,
              transition: 'opacity 0.3s',
            }}
          >
            <span className="flex gap-1">
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
            AI yozmoqda
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-white/[0.07] bg-ink/40 px-5 py-3">
        <div className="flex items-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-3 py-2">
          <span className="flex-1 text-xs text-cream-dim">
            Bilgim AI dan so&apos;rang...
          </span>
          <button className="flex h-7 w-7 items-center justify-center rounded-xl bg-accent2-500 text-ink">
            <svg
              className="h-3 w-3"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="m3 11 18-8-8 18-2-7-8-3z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function ChatMessage({
  role,
  children,
  delay,
  flagged,
}: {
  role: 'user' | 'ai';
  children: React.ReactNode;
  delay: number;
  flagged?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: delay === 999 ? 0 : 1, y: delay === 999 ? 10 : 0 }}
      transition={{ duration: 0.4 }}
      className={`flex ${role === 'user' ? 'justify-end' : 'items-start gap-2'}`}
    >
      {role === 'ai' && (
        <div
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-accent2-500 text-[11px] font-bold text-ink"
          style={{ boxShadow: '0 0 12px rgba(0,232,122,0.4)' }}
        >
          AI
        </div>
      )}
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          role === 'user'
            ? 'rounded-tr-sm bg-accent2-500/15 text-cream'
            : flagged
              ? 'rounded-tl-sm border border-accent2-500/30 bg-accent2-500/[0.05] text-cream'
              : 'rounded-tl-sm border border-white/[0.07] bg-white/[0.03] text-cream'
        }`}
      >
        {children}
      </div>
    </motion.div>
  );
}

function SparkIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
    </svg>
  );
}
