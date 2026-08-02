'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, XCircle, RotateCcw, Eye } from 'lucide-react';
import { cn } from '../../../lib/utils';

export interface GapFillSentence {
  id: string;
  template: string;   // e.g. "She ___ to school every day."
  answers: string[];  // correct answers for each gap e.g. ["goes"]
  wordBank?: string[]; // optional drag/click word bank
  hint?: string;
}

export interface GapFillRuntimeConfig {
  sentences: GapFillSentence[];
  mode: 'type' | 'choose';
  showWordBank?: boolean;
}

export interface GapFillRuntimeAnswer {
  responses: Record<string, { values: string[]; checked: boolean; correct?: boolean }>;
}

interface Props {
  config: GapFillRuntimeConfig;
  initialAnswer: GapFillRuntimeAnswer | null;
  editable: boolean;
  onChange: (answer: GapFillRuntimeAnswer) => void;
}

// Parse template into parts: text & gaps
function parseTemplate(template: string): Array<{ type: 'text' | 'gap'; content: string }> {
  const parts: Array<{ type: 'text' | 'gap'; content: string }> = [];
  const regex = /___+/g;
  let last = 0;
  let match;
  while ((match = regex.exec(template)) !== null) {
    if (match.index > last) {
      parts.push({ type: 'text', content: template.slice(last, match.index) });
    }
    parts.push({ type: 'gap', content: '' });
    last = match.index + match[0].length;
  }
  if (last < template.length) {
    parts.push({ type: 'text', content: template.slice(last) });
  }
  return parts;
}

function SentenceItem({
  sentence,
  mode,
  showWordBank,
  editable,
  response,
  onUpdate,
}: {
  sentence: GapFillSentence;
  mode: 'type' | 'choose';
  showWordBank: boolean;
  editable: boolean;
  response: { values: string[]; checked: boolean; correct?: boolean } | undefined;
  onUpdate: (values: string[], checked: boolean, correct?: boolean) => void;
}) {
  const parts = useMemo(() => parseTemplate(sentence.template), [sentence.template]);
  const gapCount = parts.filter((p) => p.type === 'gap').length;
  const values = response?.values ?? Array(gapCount).fill('');
  const checked = response?.checked ?? false;
  const correct = response?.correct;

  const [usedBank, setUsedBank] = useState<string[]>([]);

  // Available words from bank (not yet used)
  const availableBank = useMemo(() => {
    if (!sentence.wordBank) return [];
    return sentence.wordBank.filter((w) => !values.includes(w));
  }, [sentence.wordBank, values]);

  const setGapValue = (gapIdx: number, val: string) => {
    const next = [...values];
    next[gapIdx] = val;
    onUpdate(next, false, undefined);
  };

  const clickWordFromBank = (word: string, gapIdx: number) => {
    // Fill next empty gap or targeted gap
    const next = [...values];
    next[gapIdx] = word;
    onUpdate(next, false, undefined);
  };

  const removeFromGap = (gapIdx: number) => {
    const next = [...values];
    next[gapIdx] = '';
    onUpdate(next, false, undefined);
  };

  const check = () => {
    const isCorrect = sentence.answers.every((ans, i) =>
      (values[i] ?? '').trim().toLowerCase() === ans.trim().toLowerCase()
    );
    onUpdate(values, true, isCorrect);
  };

  const reset = () => {
    onUpdate(Array(gapCount).fill(''), false, undefined);
  };

  let gapIdx = 0;

  return (
    <div className={cn(
      'rounded-2xl border p-5 space-y-4 transition-colors',
      checked
        ? correct ? 'border-teal/25 bg-teal/5' : 'border-red/25 bg-red/5'
        : 'border-rim bg-tint'
    )}>
      {/* Sentence with gaps */}
      <div className="flex flex-wrap items-center gap-y-2 gap-x-1 text-sm leading-loose">
        {parts.map((part, pi) => {
          if (part.type === 'text') {
            return <span key={pi} className="text-white/80">{part.content}</span>;
          }
          const gi = gapIdx++;
          const val = values[gi] ?? '';

          return mode === 'choose' && sentence.wordBank ? (
            <button
              key={pi}
              onClick={() => val ? removeFromGap(gi) : undefined}
              disabled={!editable || checked}
              className={cn(
                'min-w-[80px] rounded-xl border px-3 py-1 text-sm font-bold text-center transition-all',
                val
                  ? checked
                    ? correct ? 'border-teal/40 bg-teal/15 text-teal' : 'border-red/40 bg-red/15 text-red'
                    : 'border-blue/40 bg-blue/15 text-blue cursor-pointer hover:bg-blue/20'
                  : 'border-dashed border-rim text-white/20',
                (!editable || checked) && 'cursor-not-allowed'
              )}
            >
              {val || '___'}
            </button>
          ) : (
            <input
              key={pi}
              type="text"
              value={val}
              disabled={!editable || checked}
              onChange={(e) => setGapValue(gi, e.target.value)}
              className={cn(
                'w-24 rounded-xl border bg-tint px-3 py-1 text-sm font-bold text-center outline-none transition-colors',
                checked
                  ? correct ? 'border-teal/40 text-teal' : 'border-red/40 text-red'
                  : 'border-rim text-white focus:border-blue/40',
                (!editable || checked) && 'cursor-not-allowed'
              )}
            />
          );
        })}
      </div>

      {/* Word bank */}
      {showWordBank && sentence.wordBank && !checked && editable && (
        <div className="flex flex-wrap gap-2">
          {availableBank.map((word) => {
            const firstEmpty = values.findIndex((v) => !v);
            return (
              <button
                key={word}
                onClick={() => firstEmpty >= 0 && clickWordFromBank(word, firstEmpty)}
                disabled={firstEmpty < 0}
                className="rounded-xl border border-rim bg-tint px-3 py-1.5 text-sm font-bold text-white/70 hover:border-blue/40 hover:text-blue hover:bg-blue/10 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {word}
              </button>
            );
          })}
        </div>
      )}

      {/* Hint */}
      {sentence.hint && !checked && (
        <p className="text-xs text-white/30 italic">{sentence.hint}</p>
      )}

      {/* Feedback */}
      {checked && (
        <div className={cn(
          'flex items-start gap-2 rounded-xl p-3 text-sm',
          correct ? 'bg-teal/10' : 'bg-red/10'
        )}>
          {correct
            ? <CheckCircle2 className="h-4 w-4 text-teal shrink-0 mt-0.5" />
            : <XCircle className="h-4 w-4 text-red shrink-0 mt-0.5" />
          }
          <div>
            {correct
              ? <p className="font-bold text-teal">To'g'ri!</p>
              : <p className="font-bold text-white">
                  To'g'ri javob: <span className="text-teal">{sentence.answers.join(', ')}</span>
                </p>
            }
          </div>
        </div>
      )}

      {/* Actions */}
      {editable && (
        <div className="flex gap-2">
          {!checked && values.some((v) => v) && (
            <button
              onClick={check}
              className="rounded-xl bg-blue/20 border border-blue/30 px-4 py-2 text-sm font-bold text-blue hover:bg-blue/30 transition-all"
            >
              Tekshirish
            </button>
          )}
          {(checked || values.some((v) => v)) && (
            <button
              onClick={reset}
              className="flex items-center gap-1.5 rounded-xl border border-rim px-3 py-2 text-sm font-bold text-white/40 hover:text-white/60 transition-all"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Qayta
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function GapFillRuntime({ config, initialAnswer, editable, onChange }: Props) {
  const [responses, setResponses] = useState<
    Record<string, { values: string[]; checked: boolean; correct?: boolean }>
  >(initialAnswer?.responses ?? {});

  useEffect(() => {
    onChange({ responses });
  }, [responses]); // eslint-disable-line

  const totalChecked = Object.values(responses).filter((r) => r.checked).length;
  const totalCorrect = Object.values(responses).filter((r) => r.correct).length;
  const allDone = totalChecked === config.sentences.length;

  return (
    <div className="space-y-4">
      {/* Progress */}
      {totalChecked > 0 && (
        <div className="flex items-center gap-3 text-xs font-bold text-white/40">
          <div className="flex-1 h-1.5 rounded-full bg-soft overflow-hidden">
            <div
              className="h-full rounded-full bg-blue transition-all"
              style={{ width: `${(totalChecked / config.sentences.length) * 100}%` }}
            />
          </div>
          <span>{totalChecked}/{config.sentences.length}</span>
        </div>
      )}

      {config.sentences.map((sentence, idx) => (
        <SentenceItem
          key={sentence.id}
          sentence={sentence}
          mode={config.mode}
          showWordBank={config.showWordBank ?? true}
          editable={editable}
          response={responses[sentence.id]}
          onUpdate={(values, checked, correct) => {
            const id = sentence.id;
            setResponses((p) => {
              const next = { ...p };
              next[id] = { values, checked, ...(correct !== undefined ? { correct } : {}) };
              return next;
            });
          }}
        />
      ))}

      {/* Final score */}
      {allDone && (
        <div className="rounded-2xl border border-rim bg-tint p-5 text-center">
          <p className="text-3xl font-black text-white mb-1">
            {totalCorrect}/{config.sentences.length}
          </p>
          <p className="text-sm text-white/50">
            {totalCorrect === config.sentences.length
              ? 'Hammasi to\'g\'ri! Zo\'r!'
              : `${config.sentences.length - totalCorrect} ta xato — qayta ko'rib chiqing`}
          </p>
        </div>
      )}
    </div>
  );
}
