'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Writing module runtime (Task 25.4, Req 12.1).
 *
 * Mirrors the API's `WritingConfig` / `WritingAnswer` schemas
 * (`apps/api/src/modules/homework/runtimes/writing.runtime.ts`).
 *
 * Behaviour:
 *  - Renders the teacher's prompt + word-count target.
 *  - Stores the student's draft text locally (`useState`).
 *  - Calls `onAutosave({ text })` every 10 seconds while the text is
 *    dirty and shows a small "Saqlanyapti..." indicator while the
 *    request is in flight (Req 12.1 — autosave).
 *  - Calls `onChange` immediately so the parent knows the latest
 *    answer when the student clicks "Yuborish" (parent will pass that
 *    snapshot to `/submissions/:id/submit`).
 */

export interface WritingRuntimeConfig {
  prompt: string;
  minWords?: number | undefined;
  maxWords?: number | undefined;
  rubric?: { criteria?: { name: string; weight?: number | undefined }[] | undefined } | undefined;
}

export interface WritingRuntimeAnswer {
  text: string;
  attachments?: { mediaId: string }[] | undefined;
}

interface WritingRuntimeProps {
  config: WritingRuntimeConfig;
  initialAnswer: WritingRuntimeAnswer | null;
  /** Whether the student can still edit (DRAFT or RETURNED). */
  editable: boolean;
  /** Called on every text change (parent uses this for the submit body). */
  onChange: (answer: WritingRuntimeAnswer) => void;
  /** Called by the autosave timer. Should resolve when the save finishes. */
  onAutosave?: ((answer: WritingRuntimeAnswer) => Promise<void>) | undefined;
}

const AUTOSAVE_INTERVAL_MS = 10_000;

function countWords(text: string): number {
  if (!text) return 0;
  const trimmed = text.replace(/^\s+|\s+$/g, '');
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/u).length;
}

export function WritingRuntime({
  config,
  initialAnswer,
  editable,
  onChange,
  onAutosave,
}: WritingRuntimeProps) {
  const [text, setText] = useState(initialAnswer?.text ?? '');
  const [savingState, setSavingState] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const dirtyRef = useRef(false);
  const lastSavedRef = useRef(initialAnswer?.text ?? '');

  // Surface the latest answer to the parent on every keystroke so
  // the submit button posts a fresh body without waiting for autosave.
  useEffect(() => {
    onChange({ text });
    if (text !== lastSavedRef.current) {
      dirtyRef.current = true;
    }
  }, [text, onChange]);

  // Autosave loop — fires every 10s when dirty and editable.
  useEffect(() => {
    if (!editable || !onAutosave) return;
    const handle = window.setInterval(async () => {
      if (!dirtyRef.current) return;
      const snapshot = text;
      try {
        setSavingState('saving');
        await onAutosave({ text: snapshot });
        lastSavedRef.current = snapshot;
        // If text changed during the save, keep the dirty flag.
        dirtyRef.current = snapshot !== text;
        setSavingState('saved');
        setSavedAt(new Date());
      } catch {
        setSavingState('error');
      }
    }, AUTOSAVE_INTERVAL_MS);
    return () => window.clearInterval(handle);
  }, [editable, onAutosave, text]);

  const wordCount = useMemo(() => countWords(text), [text]);

  const wordCountState = useMemo<'ok' | 'short' | 'long'>(() => {
    if (config.minWords !== undefined && wordCount < config.minWords) {
      return 'short';
    }
    if (config.maxWords !== undefined && wordCount > config.maxWords) {
      return 'long';
    }
    return 'ok';
  }, [wordCount, config.minWords, config.maxWords]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-rim bg-tint p-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-soft">
          Vazifa matni
        </p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-strong/90">
          {config.prompt}
        </p>
        {(config.minWords !== undefined || config.maxWords !== undefined) && (
          <p className="mt-3 text-xs text-ink-soft">
            {config.minWords !== undefined && config.maxWords !== undefined
              ? `Tavsiya etilgan hajm: ${config.minWords}–${config.maxWords} so'z`
              : config.minWords !== undefined
                ? `Kamida ${config.minWords} so'z`
                : `Ko'pi bilan ${config.maxWords} so'z`}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink-soft">
            Bajarish
          </label>
          <AutosaveIndicator
            state={savingState}
            savedAt={savedAt}
            editable={editable}
          />
        </div>
        <textarea
          rows={12}
          value={text}
          disabled={!editable}
          onChange={(e) => setText(e.target.value)}
          placeholder="Javobingizni shu yerga yozing..."
          className="w-full rounded-2xl border border-rim bg-tint px-4 py-3 text-sm leading-relaxed text-ink-strong placeholder-ink-faint outline-none focus:border-blue/60 focus:bg-soft disabled:cursor-not-allowed disabled:opacity-70"
        />
        <div className="flex items-center justify-between text-xs">
          <span
            className={
              wordCountState === 'ok'
                ? 'text-ink-soft'
                : 'text-amber-300'
            }
          >
            {wordCount} so&apos;z
            {wordCountState === 'short' &&
              ` • Kamida ${config.minWords} so'z kerak`}
            {wordCountState === 'long' &&
              ` • Maksimal ${config.maxWords} so'z`}
          </span>
        </div>
      </div>

      {config.rubric?.criteria && config.rubric.criteria.length > 0 ? (
        <div className="rounded-2xl border border-rim bg-tint p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-soft">
            Baholash mezonlari
          </p>
          <ul className="mt-2 space-y-1 text-sm text-ink-strong/90">
            {config.rubric.criteria.map((c, i) => (
              <li key={i} className="flex items-center justify-between gap-3">
                <span>{c.name}</span>
                {c.weight !== undefined ? (
                  <span className="font-mono text-[11px] text-ink-soft">
                    {c.weight}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function AutosaveIndicator({
  state,
  savedAt,
  editable,
}: {
  state: 'idle' | 'saving' | 'saved' | 'error';
  savedAt: Date | null;
  editable: boolean;
}) {
  if (!editable) {
    return (
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-soft">
        Faqat o&apos;qish
      </span>
    );
  }
  if (state === 'saving') {
    return (
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-300">
        Saqlanyapti...
      </span>
    );
  }
  if (state === 'error') {
    return (
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-rose-300">
        Saqlash xatosi
      </span>
    );
  }
  if (state === 'saved' && savedAt) {
    return (
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-blue">
        Saqlandi {savedAt.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })}
      </span>
    );
  }
  return (
    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-soft">
      Avtomatik saqlash
    </span>
  );
}
