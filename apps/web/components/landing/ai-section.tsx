'use client';

import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import {
  Sparkles,
  Lightbulb,
  Languages,
  ShieldCheck,
  Scale,
  Lock,
  BookOpen,
  Send,
} from 'lucide-react';

/**
 * AiSection — Apple Liquid Glass + plain Uzbek copy.
 */
export function AiSection() {
  return (
    <section
      id="ai"
      className="relative isolate overflow-hidden section"
    >
      {/* Soft purple ambient */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[5%] top-[20%] h-[50vh] w-[40vw] rounded-full bg-purple/8 blur-[140px]" />
        <div className="absolute right-[10%] bottom-[10%] h-[40vh] w-[35vw] rounded-full bg-blue/8 blur-[140px]" />
      </div>

      <div className="container-aurora relative">
        <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-16">
          {/* LEFT */}
          <div className="lg:col-span-5">
            <motion.span
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-100px' }}
              transition={{ duration: 0.5 }}
              className="inline-flex items-center gap-2 rounded-full bg-purple-tint px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-purple"
            >
              <Sparkles className="h-3 w-3" strokeWidth={2.5} />
              AI Yordamchi
            </motion.span>

            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="mt-5 text-balance font-display font-extrabold text-ink-strong"
              style={{
                fontSize: 'clamp(2rem, 5vw, 4rem)',
                letterSpacing: '-0.04em',
                lineHeight: '1',
              }}
            >
              Tushuntiradi.
              <br />
              <span className="italic text-purple">Javob bermaydi.</span>
            </motion.h2>

            <motion.p
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="mt-5 text-base leading-relaxed text-ink-soft sm:text-lg"
            >
              AI yordamchi talabaga vazifa javobini{' '}
              <strong className="text-ink-strong">yozib bermaydi</strong>. Faqat
              tushuntiradi, misol keltiradi va o&apos;rgatadi. Talaba o&apos;zi
              o&apos;ylab javob topadi.
            </motion.p>

            <ul className="mt-8 space-y-4">
              {[
                {
                  icon: Lightbulb,
                  title: 'Tushuntirish va misollar',
                  desc: "Mavzularni qadamma-qadam ochib berish — talaba o'rganadi",
                },
                {
                  icon: Languages,
                  title: "So'z tarjimasi",
                  desc: "O'qish paytida so'z ustiga bosgan zahoti tarjima ko'rinadi",
                },
                {
                  icon: ShieldCheck,
                  title: 'Halollik tekshiruvi',
                  desc: 'Talaba vazifasini AI yozmaganligini tekshirish imkoni',
                },
                {
                  icon: Scale,
                  title: 'Baholash yordami',
                  desc: "O'qituvchiga xato belgilash va sharh berishda yordam",
                },
              ].map((f, i) => (
                <motion.li
                  key={f.title}
                  initial={{ opacity: 0, x: -10 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: 0.3 + i * 0.08 }}
                  className="flex items-start gap-3.5"
                >
                  <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-purple-tint">
                    <f.icon className="h-4 w-4 text-purple" strokeWidth={2.25} />
                  </span>
                  <div>
                    <p
                      className="font-bold text-ink-strong"
                      style={{ letterSpacing: '-0.02em' }}
                    >
                      {f.title}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-soft">{f.desc}</p>
                  </div>
                </motion.li>
              ))}
            </ul>

            <motion.div
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.6 }}
              className="mt-8 inline-flex items-center gap-3 rounded-2xl border border-rim bg-canvas px-4 py-3 shadow-soft"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-green-tint">
                <Lock className="h-4 w-4 text-green" strokeWidth={2.25} />
              </span>
              <div className="text-xs">
                <p className="font-bold text-ink-strong">
                  Xavfsiz va kuzatilgan
                </p>
                <p className="text-ink-soft">Har bir AI ishlatishi qayd etiladi</p>
              </div>
            </motion.div>
          </div>

          {/* RIGHT — chat demo */}
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
    const id = setInterval(() => setStep((s) => (s + 1) % 5), 2800);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className="liquid-glass-strong relative overflow-hidden rounded-[2rem]"
      style={{
        boxShadow:
          '0 0 0 1px rgba(0,0,0,0.04), 0 60px 120px -30px rgba(175, 82, 222, 0.25), 0 0 100px -20px rgba(175, 82, 222, 0.15)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-rim bg-canvas px-5 py-4">
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-2xl bg-purple text-white"
            style={{ boxShadow: '0 0 20px rgba(175, 82, 222, 0.4)' }}
          >
            <Sparkles className="h-4 w-4" strokeWidth={2.5} />
          </div>
          <div>
            <p className="text-sm font-bold text-ink-strong">EduBridge AI</p>
            <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-soft">
              <span className="h-1.5 w-1.5 rounded-full bg-green" />
              Onlayn
            </p>
          </div>
        </div>
        <span className="rounded-full border border-rim bg-canvas px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.15em] text-ink-soft">
          v1.0
        </span>
      </div>

      {/* Context bar */}
      <div className="flex items-center gap-2 border-b border-rim bg-purple-tint/40 px-5 py-2">
        <BookOpen className="h-3.5 w-3.5 text-purple" strokeWidth={2.25} />
        <span className="text-[11px] font-medium text-ink-soft">
          O&apos;qish · 5-sinf · O&apos;tgan zamon
        </span>
        <span className="ml-auto rounded-md bg-green-tint px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.15em] text-green">
          Faol
        </span>
      </div>

      {/* Messages */}
      <div className="relative h-[480px] space-y-4 overflow-hidden bg-canvas px-5 py-6">
        <Msg role="user" delay={step >= 0 ? 0 : 999}>
          O&apos;tgan zamon nima va qachon ishlatiladi?
        </Msg>
        <Msg role="ai" delay={step >= 1 ? 0 : 999}>
          <strong>O&apos;tgan zamon</strong> — bo&apos;lib o&apos;tgan
          harakatni ifodalaydi.
          <br />
          <br />
          <span className="font-mono text-[10px] text-purple">Misollar:</span>
          <br />
          • I <span className="rounded bg-green-tint px-1 font-bold text-green">went</span> to school yesterday
          <br />
          • She <span className="rounded bg-green-tint px-1 font-bold text-green">studied</span> hard
        </Msg>

        <Msg role="user" delay={step >= 2 ? 0 : 999}>
          &quot;He goes to school every day&quot; ni o&apos;tgan zamonga o&apos;tkazib bering
        </Msg>

        <Msg role="ai" delay={step >= 3 ? 0 : 999} flagged>
          Bu <strong>vazifaning yechimi</strong>. Men javobni yozib bermayman, lekin yo&apos;l ko&apos;rsataman:
          <br />
          <br />
          1. <strong>goes</strong> — hozirgi zamon
          <br />
          2. O&apos;tgan zamonda fe&apos;l shakli o&apos;zgaradi
          <br />
          3. <strong>go</strong> noto&apos;g&apos;ri fe&apos;l —{' '}
          <span className="rounded bg-green-tint px-1 font-bold text-green">
            went
          </span>
          <br />
          <br />
          Endi siz o&apos;zingiz urinib ko&apos;ring.
        </Msg>

        {step === 4 && (
          <div className="flex items-center gap-2 px-1 font-mono text-[10px] text-purple">
            <span className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-1 w-1 animate-bounce rounded-full bg-purple"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </span>
            AI yozmoqda
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-rim bg-canvas px-5 py-3">
        <div className="flex items-center gap-2 rounded-2xl border border-rim bg-tint px-3 py-2.5">
          <span className="flex-1 text-xs text-ink-soft">
            EduBridge AI dan so&apos;rang...
          </span>
          <button className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple text-white">
            <Send className="h-3.5 w-3.5" strokeWidth={2.25} />
          </button>
        </div>
      </div>
    </div>
  );
}

function Msg({
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
      className={`flex ${role === 'user' ? 'justify-end' : 'items-start gap-2.5'}`}
    >
      {role === 'ai' && (
        <span
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-purple text-white"
          style={{ boxShadow: '0 0 12px rgba(175, 82, 222, 0.4)' }}
        >
          <Sparkles className="h-3 w-3" strokeWidth={2.5} />
        </span>
      )}
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          role === 'user'
            ? 'rounded-tr-sm bg-blue-tint text-ink-strong'
            : flagged
              ? 'rounded-tl-sm border border-purple/20 bg-purple-tint text-ink-strong'
              : 'rounded-tl-sm border border-rim bg-tint text-ink-strong'
        }`}
      >
        {children}
      </div>
    </motion.div>
  );
}
