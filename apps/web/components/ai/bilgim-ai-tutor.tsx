'use client';

/**
 * BilgimAiTutor — the BilgimAI tutor chat surface (Req 11.1–11.5).
 *
 * What it delivers:
 *   - Intent selection: EXPLAIN / TRANSLATE / EXAMPLE (Req 11.1), wired
 *     to the real `/ai/tutor/*` endpoints via `lib/api/ai-tutor`.
 *   - Streamed assistant responses: the backend returns a completed
 *     JSON reply (no SSE), so we render a progressive token-by-token
 *     reveal for a streaming feel (Req 11.2), instant under
 *     `prefers-reduced-motion`.
 *   - Hint-only framing: a persistent notice plus a per-message badge
 *     when the policy rewrote a reply as a hint, and a dedicated
 *     refusal affordance for `TUTOR_REFUSED_ANSWER` (Req 11.4).
 *   - Rate-limit display: a friendly "remaining calls" chip per intent
 *     and a cooldown countdown when the per-user limit is hit (Req 11.3).
 *   - Purple AI accent throughout (Req 11.4).
 *   - Accessible: a labelled live-region message log, intent radiogroup,
 *     keyboard send (Enter), loading + error states (Req 11.5).
 *
 * Copy is in Uzbek, consistent with the rest of the BilgimAI surface.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  BookOpen,
  Languages,
  Lightbulb,
  Loader2,
  Send,
  Sparkles,
  ShieldCheck,
  Info,
  AlertTriangle,
  Clock,
  ArrowRight,
} from 'lucide-react';

import { cn } from '../../lib/utils';
import { usePrefersReducedMotion } from '../../lib/use-prefers-reduced-motion';
import {
  aiTutorApi,
  TutorRateLimitError,
  TutorRefusedError,
  TUTOR_RATE_LIMITS,
  type TutorIntent,
  type TutorLocale,
  type TutorPolicyChecks,
} from '../../lib/api/ai-tutor';

// ── Intent config ──────────────────────────────────────────────────────

interface IntentDef {
  id: TutorIntent;
  label: string;
  hint: string;
  icon: typeof BookOpen;
  placeholder: string;
}

const INTENTS: readonly IntentDef[] = [
  {
    id: 'EXPLAIN',
    label: 'Tushuntirish',
    hint: 'Qoida yoki tushunchani sodda tilda tushuntiradi',
    icon: BookOpen,
    placeholder: 'Qaysi qoidani yoki tushunchani tushuntirib beray?',
  },
  {
    id: 'TRANSLATE',
    label: 'Tarjima',
    hint: 'Matnni tillar orasida tarjima qiladi',
    icon: Languages,
    placeholder: 'Tarjima qilinadigan matnni kiriting…',
  },
  {
    id: 'EXAMPLE',
    label: 'Misol',
    hint: 'Boshqa mavzuda o‘xshash misol keltiradi',
    icon: Lightbulb,
    placeholder: 'Qaysi mavzuda o‘xshash misol kerak?',
  },
] as const;

const LOCALE_LABELS: Record<TutorLocale, string> = {
  uz: 'O‘zbekcha',
  ru: 'Ruscha',
  en: 'Inglizcha',
};

// ── Message model ──────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  intent: TutorIntent;
  /** Reveal the text progressively (only the freshest assistant reply). */
  animate?: boolean;
  policy?: TutorPolicyChecks;
  cached?: boolean;
  refused?: boolean;
  error?: boolean;
}

// ── Client-side rate-limit tracking ─────────────────────────────────────
//
// The backend exposes only a `Retry-After` header on a 429, not a live
// remaining-quota header, so we approximate "remaining calls" locally by
// logging call timestamps per intent (pruned to the 1h window). This is a
// friendly indicator (Req 11.3), not an enforcement mechanism — the server
// remains the source of truth.

const USAGE_PREFIX = 'bilgim:ai-tutor:usage:';

function readUsage(intent: TutorIntent): number[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(USAGE_PREFIX + intent);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n): n is number => typeof n === 'number');
  } catch {
    return [];
  }
}

function remainingFor(intent: TutorIntent): number {
  const { max, windowMs } = TUTOR_RATE_LIMITS[intent];
  const cutoff = Date.now() - windowMs;
  const recent = readUsage(intent).filter((t) => t >= cutoff);
  return Math.max(0, max - recent.length);
}

function recordUsage(intent: TutorIntent): void {
  if (typeof window === 'undefined') return;
  const { windowMs } = TUTOR_RATE_LIMITS[intent];
  const cutoff = Date.now() - windowMs;
  const recent = readUsage(intent).filter((t) => t >= cutoff);
  recent.push(Date.now());
  try {
    window.localStorage.setItem(USAGE_PREFIX + intent, JSON.stringify(recent));
  } catch {
    /* storage full / unavailable — non-fatal */
  }
}

// ── Progressive reveal (streaming feel) ─────────────────────────────────

function StreamingText({
  text,
  animate,
  onAdvance,
}: {
  text: string;
  animate: boolean;
  onAdvance?: () => void;
}) {
  const reduced = usePrefersReducedMotion();
  const [count, setCount] = useState(animate && !reduced ? 0 : text.length);

  useEffect(() => {
    if (!animate || reduced) {
      setCount(text.length);
      return;
    }
    setCount(0);
    let current = 0;
    // Reveal ~2.5% of the reply per tick (min 2 chars), ~24ms cadence —
    // a quick, legible "typing" effect that never lags long replies.
    const step = Math.max(2, Math.round(text.length / 40));
    const timer = window.setInterval(() => {
      current = Math.min(text.length, current + step);
      setCount(current);
      onAdvance?.();
      if (current >= text.length) window.clearInterval(timer);
    }, 24);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, animate, reduced]);

  const shown = text.slice(0, count);
  const streaming = count < text.length;
  return (
    <span>
      {renderInlineMarkdown(shown)}
      {streaming && (
        <span
          aria-hidden="true"
          className="ml-0.5 inline-block h-3.5 w-[2px] -mb-0.5 animate-pulse bg-purple"
        />
      )}
    </span>
  );
}

/**
 * Minimal, safe inline markdown: **bold**, `code`, and newlines. Plain
 * text is rendered as text nodes (no `dangerouslySetInnerHTML`), so model
 * output can never inject markup.
 */
function renderInlineMarkdown(text: string): React.ReactNode[] {
  const lines = text.split('\n');
  return lines.map((line, li) => (
    <span key={li}>
      {tokenizeLine(line)}
      {li < lines.length - 1 && <br />}
    </span>
  ));
}

function tokenizeLine(line: string): React.ReactNode[] {
  const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={i} className="font-bold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={i}
          className="rounded bg-purple-tint px-1 py-0.5 font-mono text-[0.85em] text-purple-700"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

// ── Props ────────────────────────────────────────────────────────────────

export interface BilgimAiTutorProps {
  /** Active app locale; used as the tutor `locale` for EXPLAIN/EXAMPLE. */
  locale?: string;
  /** Caller role — admins are gently told the tutor is for learners. */
  role?: 'STUDENT' | 'TEACHER' | 'ADMIN';
  /** Visual density: 'panel' for the floating launcher, 'page' for full screen. */
  variant?: 'panel' | 'page';
  className?: string;
}

function normalizeLocale(locale: string | undefined): TutorLocale {
  return locale === 'ru' || locale === 'en' ? locale : 'uz';
}

// ── Component ──────────────────────────────────────────────────────────

export function BilgimAiTutor({
  locale,
  role = 'STUDENT',
  variant = 'page',
  className,
}: BilgimAiTutorProps) {
  const appLocale = normalizeLocale(locale);

  const [intent, setIntent] = useState<TutorIntent>('EXPLAIN');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [fromLocale, setFromLocale] = useState<TutorLocale>(appLocale === 'en' ? 'uz' : appLocale);
  const [toLocale, setToLocale] = useState<TutorLocale>('en');
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Bumped after each call so the remaining-calls chip recomputes.
  const [usageTick, setUsageTick] = useState(0);

  const bottomRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const activeIntent = INTENTS.find((m) => m.id === intent) ?? INTENTS[0]!;
  const isAdmin = role === 'ADMIN';

  // Keep the cooldown countdown and the remaining-calls window fresh.
  useEffect(() => {
    if (cooldownUntil === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);

  useEffect(() => {
    const timer = window.setInterval(() => setUsageTick((t) => t + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, sending, scrollToBottom]);

  const cooldownMsLeft = cooldownUntil !== null ? Math.max(0, cooldownUntil - now) : 0;
  const cooldownActive = cooldownMsLeft > 0;
  useEffect(() => {
    if (cooldownUntil !== null && cooldownMsLeft === 0) setCooldownUntil(null);
  }, [cooldownUntil, cooldownMsLeft]);

  const remaining = useMemo(
    () => remainingFor(intent),
    // usageTick + sending changes force a recompute after each call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intent, usageTick, sending],
  );
  const intentMax = TUTOR_RATE_LIMITS[intent].max;
  const lowQuota = remaining <= 3;

  const pushAssistant = useCallback(
    (
      content: string,
      extra: Partial<Pick<ChatMessage, 'policy' | 'cached' | 'refused' | 'error'>>,
      msgIntent: TutorIntent,
    ) => {
      setMessages((prev) => [
        ...prev.map((m) => ({ ...m, animate: false })),
        {
          id: `a-${Date.now()}`,
          role: 'assistant' as const,
          content,
          intent: msgIntent,
          animate: !extra.error,
          ...extra,
        },
      ]);
    },
    [],
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending || cooldownActive) return;

    const sentIntent = intent;
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
      intent: sentIntent,
    };
    setMessages((prev) => [...prev.map((m) => ({ ...m, animate: false })), userMsg]);
    setInput('');
    setSending(true);
    if (taRef.current) taRef.current.style.height = 'auto';

    recordUsage(sentIntent);
    setUsageTick((t) => t + 1);

    try {
      if (sentIntent === 'EXPLAIN') {
        const r = await aiTutorApi.explain({ question: text, locale: appLocale });
        pushAssistant(r.reply, { policy: r.policyChecks }, sentIntent);
      } else if (sentIntent === 'EXAMPLE') {
        const r = await aiTutorApi.example({ question: text, locale: appLocale });
        pushAssistant(r.reply, { policy: r.policyChecks }, sentIntent);
      } else {
        const r = await aiTutorApi.translate({
          text,
          sourceLocale: fromLocale,
          targetLocale: toLocale,
        });
        pushAssistant(r.translation, { cached: r.cached }, sentIntent);
      }
    } catch (err) {
      if (err instanceof TutorRateLimitError) {
        setCooldownUntil(Date.now() + err.retryAfterMs);
        setNow(Date.now());
        pushAssistant(
          'So‘rovlar chekloviga yetdingiz. Biroz kutib, qaytadan urinib ko‘ring.',
          { error: true },
          sentIntent,
        );
      } else if (err instanceof TutorRefusedError) {
        pushAssistant(
          'Men faol uy vazifangizning tayyor javobini bera olmayman — bu sizning o‘rganishingizga yordam bermaydi. Lekin qoidani tushuntirib berishim, o‘xshash misol ko‘rsatishim yoki yo‘l-yo‘riq berishim mumkin.',
          { refused: true },
          sentIntent,
        );
      } else {
        pushAssistant(
          'Kechirasiz, xatolik yuz berdi. Qaytadan urinib ko‘ring.',
          { error: true },
          sentIntent,
        );
      }
    } finally {
      setSending(false);
      setUsageTick((t) => t + 1);
    }
  }, [
    input,
    sending,
    cooldownActive,
    intent,
    appLocale,
    fromLocale,
    toLocale,
    pushAssistant,
  ]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const swapLocales = () => {
    setFromLocale(toLocale);
    setToLocale(fromLocale);
  };

  const canSend = input.trim().length > 0 && !sending && !cooldownActive;

  return (
    <div
      className={cn(
        'flex h-full min-h-0 flex-col bg-base text-ink-strong',
        className,
      )}
    >
      {/* Header — purple AI accent + hint-only framing (Req 11.4) */}
      <header className="shrink-0 border-b border-rim bg-canvas px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-purple to-blue text-white shadow-sm shadow-purple/30"
            aria-hidden="true"
          >
            <Sparkles className="h-4.5 w-4.5" style={{ width: '1.125rem', height: '1.125rem' }} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-black leading-tight text-ink-strong">BilgimAI</p>
            <p className="text-[11px] font-semibold text-purple">Ingliz tili repetitori</p>
          </div>
        </div>

        <p className="mt-3 flex items-start gap-2 rounded-2xl bg-purple-tint px-3 py-2 text-[11px] font-semibold leading-snug text-purple-800">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-purple" aria-hidden="true" />
          <span>
            BilgimAI yo‘l-yo‘riq va maslahat beradi — uy vazifangizning tayyor javobini bermaydi.
          </span>
        </p>

        {isAdmin && (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-ink-soft">
            <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Repetitor o‘quvchi va o‘qituvchilar uchun mo‘ljallangan.
          </p>
        )}
      </header>

      {/* Intent selector (Req 11.1) */}
      <div
        role="radiogroup"
        aria-label="BilgimAI rejimi"
        className="shrink-0 flex flex-wrap gap-2 border-b border-rim bg-canvas px-4 py-2.5 sm:px-6"
      >
        {INTENTS.map((m) => {
          const Icon = m.icon;
          const active = m.id === intent;
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={active}
              title={m.hint}
              onClick={() => setIntent(m.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/50',
                active
                  ? 'border-purple bg-purple text-white shadow-sm shadow-purple/30'
                  : 'border-rim bg-tint text-ink-soft hover:border-purple/40 hover:text-purple',
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {m.label}
            </button>
          );
        })}
      </div>

      {/* Translate language pickers */}
      {intent === 'TRANSLATE' && (
        <div className="shrink-0 flex items-center gap-2 border-b border-rim bg-canvas px-4 py-2 sm:px-6">
          <label className="sr-only" htmlFor="tutor-from">
            Qaysi tildan
          </label>
          <select
            id="tutor-from"
            value={fromLocale}
            onChange={(e) => setFromLocale(e.target.value as TutorLocale)}
            className="rounded-xl border border-rim bg-tint px-2.5 py-1.5 text-xs font-semibold text-ink-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/50"
          >
            {(Object.keys(LOCALE_LABELS) as TutorLocale[]).map((l) => (
              <option key={l} value={l}>
                {LOCALE_LABELS[l]}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={swapLocales}
            aria-label="Tillarni almashtirish"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-purple hover:bg-purple-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/50"
          >
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <label className="sr-only" htmlFor="tutor-to">
            Qaysi tilga
          </label>
          <select
            id="tutor-to"
            value={toLocale}
            onChange={(e) => setToLocale(e.target.value as TutorLocale)}
            className="rounded-xl border border-rim bg-tint px-2.5 py-1.5 text-xs font-semibold text-ink-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/50"
          >
            {(Object.keys(LOCALE_LABELS) as TutorLocale[]).map((l) => (
              <option key={l} value={l} disabled={l === fromLocale}>
                {LOCALE_LABELS[l]}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Message log — live region (Req 11.5 a11y) */}
      <div
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-label="BilgimAI suhbati"
        className="flex-1 min-h-0 overflow-y-auto px-4 py-4 sm:px-6"
      >
        {messages.length === 0 ? (
          <EmptyState intent={activeIntent} />
        ) : (
          <ul className="space-y-4">
            {messages.map((m) => (
              <li key={m.id}>
                <MessageBubble message={m} onAdvance={scrollToBottom} />
              </li>
            ))}
          </ul>
        )}

        {sending && (
          <div className="mt-4 flex items-center gap-2" aria-label="BilgimAI yozmoqda">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-purple to-blue text-white"
              aria-hidden="true"
            >
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            <span className="flex items-center gap-1 rounded-2xl rounded-tl-sm bg-canvas border border-rim px-3 py-2.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 rounded-full bg-purple/60 motion-safe:animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Rate-limit indicator (Req 11.3) */}
      <div
        className="shrink-0 flex items-center justify-between gap-2 border-t border-rim bg-canvas px-4 pt-2 sm:px-6"
        aria-live="polite"
      >
        {cooldownActive ? (
          <span className="flex items-center gap-1.5 text-[11px] font-bold text-orange-600">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            So‘rov chekloviga yetildi · {Math.ceil(cooldownMsLeft / 1000)}s kuting
          </span>
        ) : (
          <span
            className={cn(
              'flex items-center gap-1.5 text-[11px] font-semibold',
              lowQuota ? 'text-orange-600' : 'text-ink-faint',
            )}
          >
            {lowQuota && <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />}
            {activeIntent.label}: {remaining}/{intentMax} so‘rov qoldi
          </span>
        )}
      </div>

      {/* Composer */}
      <div className="shrink-0 px-4 pb-4 pt-2 sm:px-6">
        <div className="flex items-end gap-2 rounded-2xl border border-rim bg-canvas px-3 py-2 focus-within:border-purple/50 focus-within:ring-2 focus-within:ring-purple/20">
          <label className="sr-only" htmlFor="tutor-input">
            BilgimAI uchun savol
          </label>
          <textarea
            id="tutor-input"
            ref={taRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={(e) => {
              const t = e.target as HTMLTextAreaElement;
              t.style.height = 'auto';
              t.style.height = `${Math.min(t.scrollHeight, 160)}px`;
            }}
            rows={1}
            maxLength={4000}
            placeholder={activeIntent.placeholder}
            disabled={cooldownActive}
            className="max-h-40 flex-1 resize-none bg-transparent text-sm leading-relaxed text-ink-strong placeholder-ink-faint outline-none disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!canSend}
            aria-label="Yuborish"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-purple text-white transition-all hover:bg-purple-600 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/50"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
        <p className="mt-2 text-center text-[10px] font-bold uppercase tracking-widest text-ink-faint">
          BilgimAI • Enter = yuborish
        </p>
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────

function EmptyState({ intent }: { intent: IntentDef }) {
  const Icon = intent.icon;
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <span
        className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-purple to-blue text-white shadow-md shadow-purple/30"
        aria-hidden="true"
      >
        <Icon className="h-6 w-6" />
      </span>
      <p className="text-sm font-black text-ink-strong">{intent.label} rejimi</p>
      <p className="mt-1 max-w-xs text-xs font-medium text-ink-soft">{intent.hint}</p>
      <p className="mt-3 max-w-xs text-[11px] font-medium text-ink-faint">
        Savolingizni yozing — BilgimAI yo‘l-yo‘riq beradi, tayyor javob bermaydi.
      </p>
    </div>
  );
}

function MessageBubble({
  message,
  onAdvance,
}: {
  message: ChatMessage;
  onAdvance: () => void;
}) {
  const isUser = message.role === 'user';
  const rewroteAsHint = message.policy?.rewroteAsHint === true;

  return (
    <div className={cn('flex gap-2.5', isUser ? 'flex-row-reverse' : 'flex-row')}>
      <span
        className={cn(
          'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white',
          isUser ? 'bg-blue' : 'bg-gradient-to-br from-purple to-blue',
        )}
        aria-hidden="true"
      >
        {isUser ? (
          <span className="text-[11px] font-black">Siz</span>
        ) : (
          <Sparkles className="h-3.5 w-3.5" />
        )}
      </span>

      <div className={cn('flex max-w-[82%] flex-col gap-1', isUser ? 'items-end' : 'items-start')}>
        <div
          className={cn(
            'rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed',
            isUser
              ? 'rounded-tr-sm bg-blue text-white'
              : message.error
                ? 'rounded-tl-sm border border-red/30 bg-red-tint text-red-700'
                : message.refused
                  ? 'rounded-tl-sm border border-purple/30 bg-purple-tint text-purple-900'
                  : 'rounded-tl-sm border border-rim bg-canvas text-ink-strong',
          )}
        >
          {isUser ? (
            <span className="whitespace-pre-wrap">{message.content}</span>
          ) : (
            <StreamingText
              text={message.content}
              animate={message.animate === true}
              onAdvance={onAdvance}
            />
          )}
        </div>

        {/* Hint-only badge (Req 11.4) */}
        {!isUser && rewroteAsHint && (
          <span className="flex items-center gap-1 rounded-full bg-purple-tint px-2 py-0.5 text-[10px] font-bold text-purple-700">
            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
            Maslahat sifatida qayta yozildi
          </span>
        )}
        {!isUser && message.refused && (
          <span className="flex items-center gap-1 rounded-full bg-purple-tint px-2 py-0.5 text-[10px] font-bold text-purple-700">
            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
            Tayyor javob berilmaydi
          </span>
        )}
        {!isUser && message.cached && (
          <span className="text-[10px] font-medium text-ink-faint">Keshdan</span>
        )}
      </div>
    </div>
  );
}

export default BilgimAiTutor;
