'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '../../../lib/api-client';
import { Loader2, X, BookOpen, Volume2 } from 'lucide-react';

export interface ReadingQuestion {
  id: string;
  prompt: string;
  kind: 'mcq' | 'short' | 'true_false';
  choices?: string[] | undefined;
  answer?: string | string[] | undefined;
}

export interface ReadingRuntimeConfig {
  passage: string;
  questions: ReadingQuestion[];
}

export interface ReadingRuntimeAnswer {
  responses: Record<string, { value: string | string[] }>;
}

interface ReadingRuntimeProps {
  config: ReadingRuntimeConfig;
  initialAnswer: ReadingRuntimeAnswer | null;
  editable: boolean;
  onChange: (answer: ReadingRuntimeAnswer) => void;
}

// ── Word tooltip ────────────────────────────────────────────────────

interface WordTooltip {
  word: string;
  sentence: string;
  x: number;
  y: number;
}

interface WordTranslation {
  translation: string;
  partOfSpeech?: string;
  examples: string[];
  note?: string;
}

function WordTooltipPopup({
  tooltip,
  onClose,
}: {
  tooltip: WordTooltip;
  onClose: () => void;
}) {
  const [data, setData] = useState<WordTranslation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setData(null);

    apiClient
      .post<WordTranslation>('/ai/translate-word', {
        word: tooltip.word,
        contextSentence: tooltip.sentence,
        locale: 'uz',
      })
      .then(setData)
      .catch(() => setError("Tarjima qilib bo'lmadi"))
      .finally(() => setLoading(false));
  }, [tooltip.word, tooltip.sentence]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Position popup above/below click point
  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(tooltip.x, window.innerWidth - 280),
    top: tooltip.y + 20,
    zIndex: 9999,
  };

  return (
    <div
      ref={ref}
      style={style}
      className="w-64 rounded-2xl border border-white/10 bg-[#1a1a2e] p-4 shadow-2xl shadow-black/60 backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-150"
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <span className="text-base font-black text-white">{tooltip.word}</span>
          {data?.partOfSpeech && (
            <span className="ml-2 text-[10px] font-bold uppercase tracking-widest text-blue/70">
              {data.partOfSpeech}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-white/30 hover:text-white/60 transition-colors -mr-1"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-white/40 text-xs">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Tarjima qilinmoqda...
        </div>
      )}

      {error && <p className="text-xs text-red/80">{error}</p>}

      {data && !loading && (
        <div className="space-y-2">
          <div className="rounded-xl bg-white/5 px-3 py-2">
            <p className="text-sm font-bold text-white/90">{data.translation}</p>
          </div>
          {data.note && (
            <p className="text-[11px] text-white/40 italic">{data.note}</p>
          )}
          {data.examples.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-black uppercase tracking-widest text-white/30">Misol</p>
              {data.examples.slice(0, 2).map((ex, i) => (
                <p key={i} className="text-[11px] text-white/50 italic leading-relaxed">
                  "{ex}"
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-white/5 flex items-center gap-1">
        <BookOpen className="h-3 w-3 text-blue/40" />
        <span className="text-[9px] font-bold uppercase tracking-widest text-white/20">BilgimAI Lug'at</span>
      </div>
    </div>
  );
}

// ── Clickable passage ────────────────────────────────────────────────

function ClickablePassage({
  text,
  onWordClick,
  editable,
}: {
  text: string;
  onWordClick: (word: string, sentence: string, x: number, y: number) => void;
  editable: boolean;
}) {
  const sentences = useMemo(
    () =>
      text
        .split(/(?<=[.!?])\s+/)
        .filter(Boolean)
        .flatMap((s) => [s, ' ']),
    [text],
  );

  const handleWordClick = useCallback(
    (
      word: string,
      sentence: string,
      e: React.MouseEvent<HTMLSpanElement>,
    ) => {
      const clean = word.replace(/[^a-zA-ZА-Яа-яёЁ'ʻʼЀ-ӿĀ-ſ]/g, '');
      if (!clean || clean.length < 2) return;
      e.stopPropagation();
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      onWordClick(clean, sentence, rect.left, rect.bottom);
    },
    [onWordClick],
  );

  return (
    <div className="space-y-3 whitespace-pre-wrap text-[15px] leading-[1.9] text-ink-strong/90 select-text">
      {sentences.map((sentence, si) => {
        if (sentence === ' ') return <span key={`sp-${si}`}> </span>;
        const words = sentence.split(/(\s+)/);
        return (
          <span key={si}>
            {words.map((token, wi) => {
              if (/^\s+$/.test(token)) return <span key={wi}>{token}</span>;
              const bare = token.replace(/[^a-zA-ZА-Яа-яёЁ'ʻʼЀ-ӿĀ-ſ]/g, '');
              if (!bare || bare.length < 2 || !editable) {
                return <span key={wi}>{token}</span>;
              }
              return (
                <span
                  key={wi}
                  onClick={(e) => handleWordClick(token, sentence, e)}
                  className="cursor-pointer rounded px-0.5 transition-colors hover:bg-blue/20 hover:text-white active:bg-blue/30"
                  title="Tarjimani ko'rish uchun bosing"
                >
                  {token}
                </span>
              );
            })}
          </span>
        );
      })}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────

export function ReadingRuntime({
  config,
  initialAnswer,
  editable,
  onChange,
}: ReadingRuntimeProps) {
  const [responses, setResponses] = useState<
    Record<string, { value: string | string[] }>
  >(() => initialAnswer?.responses ?? {});

  const [tooltip, setTooltip] = useState<WordTooltip | null>(null);

  useEffect(() => {
    onChange({ responses });
  }, [responses, onChange]);

  function setSingle(qid: string, value: string) {
    setResponses((prev) => ({ ...prev, [qid]: { value } }));
  }

  function toggleMulti(qid: string, choice: string) {
    setResponses((prev) => {
      const existing = prev[qid]?.value;
      const list = Array.isArray(existing) ? existing : existing ? [existing] : [];
      const next = list.includes(choice)
        ? list.filter((c) => c !== choice)
        : [...list, choice];
      return { ...prev, [qid]: { value: next } };
    });
  }

  const handleWordClick = useCallback(
    (word: string, sentence: string, x: number, y: number) => {
      setTooltip({ word, sentence, x, y });
    },
    [],
  );

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      {/* Passage */}
      <article className="rounded-2xl border border-rim bg-tint p-5 lg:col-span-3 relative">
        <div className="flex items-center gap-2 mb-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-soft">
            Matn
          </p>
          {editable ? (
            <span className="text-[9px] text-blue/50 font-bold">• So'zga bosing = tarjima</span>
          ) : null}
        </div>
        <ClickablePassage text={config.passage} onWordClick={handleWordClick} editable={editable} />
      </article>

      {/* Questions */}
      <div className="space-y-4 lg:col-span-2">
        {config.questions.map((q, idx) => (
          <ReadingQuestionItem
            key={q.id}
            index={idx + 1}
            question={q}
            response={responses[q.id]}
            editable={editable}
            onSingleChange={(value) => setSingle(q.id, value)}
            onMultiToggle={(choice) => toggleMulti(q.id, choice)}
          />
        ))}
      </div>

      {/* Word tooltip popup */}
      {tooltip && (
        <WordTooltipPopup
          tooltip={tooltip}
          onClose={() => setTooltip(null)}
        />
      )}
    </div>
  );
}

interface ReadingQuestionItemProps {
  index: number;
  question: ReadingQuestion;
  response: { value: string | string[] } | undefined;
  editable: boolean;
  onSingleChange: (value: string) => void;
  onMultiToggle: (choice: string) => void;
}

function ReadingQuestionItem({
  index,
  question,
  response,
  editable,
  onSingleChange,
  onMultiToggle,
}: ReadingQuestionItemProps) {
  const isMulti = useMemo(
    () => question.kind === 'mcq' && Array.isArray(question.answer),
    [question.kind, question.answer],
  );
  const value = response?.value;

  return (
    <div className="rounded-2xl border border-rim bg-canvas p-4">
      <p className="text-sm font-semibold text-ink-strong">
        <span className="mr-2 font-mono text-[11px] text-ink-soft">{index}.</span>
        {question.prompt}
      </p>

      <div className="mt-3 space-y-2">
        {question.kind === 'mcq' && question.choices
          ? question.choices.map((choice) => {
              const checked = isMulti
                ? Array.isArray(value) && value.includes(choice)
                : value === choice;
              return (
                <label
                  key={choice}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm transition-colors ${
                    checked
                      ? 'border-blue/40 bg-blue/10 text-ink-strong'
                      : 'border-rim bg-tint text-ink-soft hover:border-blue/30 hover:text-ink-strong'
                  } ${editable ? '' : 'cursor-not-allowed opacity-70'}`}
                >
                  <input
                    type={isMulti ? 'checkbox' : 'radio'}
                    name={question.id}
                    value={choice}
                    checked={checked}
                    disabled={!editable}
                    onChange={() =>
                      isMulti ? onMultiToggle(choice) : onSingleChange(choice)
                    }
                    className="h-4 w-4 accent-blue"
                  />
                  <span>{choice}</span>
                </label>
              );
            })
          : null}

        {question.kind === 'true_false' ? (
          <div className="flex gap-3">
            {['true', 'false'].map((choice) => {
              const checked = value === choice;
              return (
                <label
                  key={choice}
                  className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${
                    checked
                      ? 'border-blue/40 bg-blue/10 text-ink-strong'
                      : 'border-rim bg-tint text-ink-soft hover:border-blue/30 hover:text-ink-strong'
                  } ${editable ? '' : 'cursor-not-allowed opacity-70'}`}
                >
                  <input
                    type="radio"
                    name={question.id}
                    value={choice}
                    checked={checked}
                    disabled={!editable}
                    onChange={() => onSingleChange(choice)}
                    className="sr-only"
                  />
                  {choice === 'true' ? "To'g'ri" : "Noto'g'ri"}
                </label>
              );
            })}
          </div>
        ) : null}

        {question.kind === 'short' ? (
          <textarea
            rows={3}
            value={typeof value === 'string' ? value : ''}
            disabled={!editable}
            onChange={(e) => onSingleChange(e.target.value)}
            placeholder="Javobingizni yozing..."
            className="w-full rounded-2xl border border-rim bg-tint px-4 py-3 text-sm text-ink-strong placeholder-ink-faint outline-none focus:border-blue/60 focus:bg-soft disabled:cursor-not-allowed disabled:opacity-70"
          />
        ) : null}
      </div>
    </div>
  );
}
