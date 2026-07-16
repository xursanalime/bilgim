'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Volume2, Check } from 'lucide-react';

import { cn } from '../../../lib/utils';

/**
 * Spelling module runtime (frontend-redesign Req 10.2 / 10.3, Task 6.2).
 *
 * Mirrors the teacher builder's SPELLING `configJson`
 * (`assignment-builder-config.ts`): `{ words: string[]; instructions? }`.
 *
 * Dictation experience — the target word is NOT shown. The learner
 * presses "Tinglash" to hear the word (Web Speech `speechSynthesis`)
 * and types what they heard. Answers bubble up via `onChange`; the
 * parent `AssignmentRunner` owns autosave (debounced PATCH
 * `/submissions/:id`), so this component is purely presentational +
 * local state.
 */

export interface SpellingRuntimeConfig {
  words: string[];
  instructions?: string | undefined;
}

export interface SpellingRuntimeAnswer {
  /** Keyed by word index (stringified) → the learner's typed spelling. */
  responses: Record<string, string>;
}

interface SpellingRuntimeProps {
  config: SpellingRuntimeConfig;
  initialAnswer: SpellingRuntimeAnswer | null;
  editable: boolean;
  onChange: (answer: SpellingRuntimeAnswer) => void;
}

export function SpellingRuntime({
  config,
  initialAnswer,
  editable,
  onChange,
}: SpellingRuntimeProps) {
  const words = useMemo(() => config.words ?? [], [config.words]);
  const [responses, setResponses] = useState<Record<string, string>>(
    () => initialAnswer?.responses ?? {},
  );

  useEffect(() => {
    onChange({ responses });
  }, [responses, onChange]);

  const speak = useCallback((text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.8;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, []);

  const setValue = (index: number, value: string) => {
    setResponses((prev) => ({ ...prev, [String(index)]: value }));
  };

  const filledCount = words.reduce(
    (acc, _word, i) => (responses[String(i)]?.trim() ? acc + 1 : acc),
    0,
  );

  if (words.length === 0) {
    return (
      <p className="text-sm text-cream-dim">
        Bu modulda hali so&apos;zlar qo&apos;shilmagan.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {config.instructions ? (
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cream-dim">
            Ko&apos;rsatma
          </p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-cream/90">
            {config.instructions}
          </p>
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <p className="text-xs text-cream-dim">
          So&apos;zni eshiting va to&apos;g&apos;ri yozing
        </p>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-cream-dim">
          {filledCount}/{words.length} bajarildi
        </span>
      </div>

      <ol className="space-y-3">
        {words.map((word, i) => {
          const value = responses[String(i)] ?? '';
          const done = value.trim().length > 0;
          return (
            <li
              key={`${word}-${i}`}
              className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-ink-surface p-3"
            >
              <span className="font-mono text-[11px] text-cream-dim">
                {i + 1}.
              </span>
              <button
                type="button"
                onClick={() => speak(word)}
                aria-label={`${i + 1}-so'zni tinglash`}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent2-500/30 bg-accent2-500/10 text-accent2-500 transition-colors hover:bg-accent2-500/20"
              >
                <Volume2 className="h-4 w-4" />
              </button>
              <input
                type="text"
                value={value}
                disabled={!editable}
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                onChange={(e) => setValue(i, e.target.value)}
                placeholder="Eshitgan so'zingizni yozing..."
                className="min-w-0 flex-1 rounded-xl border border-ink-line bg-white/[0.04] px-4 py-2.5 text-sm text-cream placeholder-cream-dim/60 outline-none focus:border-accent2-500/60 focus:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-70"
              />
              <span
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors',
                  done
                    ? 'bg-accent2-500/15 text-accent2-500'
                    : 'bg-white/[0.04] text-cream-dim/40',
                )}
                aria-hidden="true"
              >
                <Check className="h-3.5 w-3.5" />
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
