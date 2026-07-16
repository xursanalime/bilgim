'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, ChevronRight, BookOpen, Lightbulb } from 'lucide-react';
import { cn } from '../../../lib/utils';

export interface GrammarRule {
  title: string;
  explanation: string;
  formula?: string;
  examples: Array<{ correct: string; incorrect?: string; note?: string }>;
}

export interface GrammarExercise {
  id: string;
  type: 'choose_correct' | 'error_correction' | 'transformation' | 'fill_blank';
  prompt: string;
  options?: string[];
  answer: string;
  explanation?: string;
}

export interface GrammarRuntimeConfig {
  rule: GrammarRule;
  exercises: GrammarExercise[];
}

export interface GrammarRuntimeAnswer {
  responses: Record<string, { value: string; checked: boolean; correct?: boolean }>;
}

interface Props {
  config: GrammarRuntimeConfig;
  initialAnswer: GrammarRuntimeAnswer | null;
  editable: boolean;
  onChange: (answer: GrammarRuntimeAnswer) => void;
}

export function GrammarRuntime({ config, initialAnswer, editable, onChange }: Props) {
  const [responses, setResponses] = useState<Record<string, { value: string; checked: boolean; correct?: boolean }>>(
    initialAnswer?.responses ?? {}
  );
  const [phase, setPhase] = useState<'learn' | 'practice'>('learn');

  useEffect(() => {
    onChange({ responses });
  }, [responses]); // eslint-disable-line

  const checkAnswer = (ex: GrammarExercise) => {
    const resp = responses[ex.id];
    if (!resp?.value.trim()) return;
    const correct = resp.value.trim().toLowerCase() === ex.answer.trim().toLowerCase();
    setResponses((p) => ({
      ...p,
      [ex.id]: { ...p[ex.id]!, checked: true, correct },
    }));
  };

  const setValue = (id: string, value: string) => {
    setResponses((p) => ({ ...p, [id]: { value, checked: false } }));
  };

  const allChecked = config.exercises.every((ex) => responses[ex.id]?.checked);
  const correctCount = Object.values(responses).filter((r) => r.checked && r.correct).length;

  return (
    <div className="space-y-6">
      {/* Phase tabs */}
      <div className="flex rounded-2xl border border-white/[0.07] bg-white/[0.03] p-1 gap-1">
        {(['learn', 'practice'] as const).map((p) => (
          <button
            type="button"
            key={p}
            onClick={() => setPhase(p)}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-black transition-all',
              phase === p
                ? 'bg-blue text-white shadow-sm'
                : 'text-white/40 hover:text-white/60'
            )}
          >
            {p === 'learn' ? <BookOpen className="h-3.5 w-3.5" /> : <Lightbulb className="h-3.5 w-3.5" />}
            {p === 'learn' ? "Qoida" : "Mashq"}
            {p === 'practice' && allChecked && (
              <span className="ml-1 text-[10px] font-black bg-white/20 rounded-full px-1.5">
                {correctCount}/{config.exercises.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Learn phase — grammar rule */}
      {phase === 'learn' && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-blue/20 bg-blue/5 p-5">
            <h3 className="text-base font-black text-white mb-3">{config.rule.title}</h3>
            <p className="text-sm text-white/70 leading-relaxed">{config.rule.explanation}</p>

            {config.rule.formula && (
              <div className="mt-4 rounded-xl bg-white/[0.06] border border-white/[0.08] px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-white/30 mb-1">Formula</p>
                <p className="text-sm font-mono font-bold text-blue">{config.rule.formula}</p>
              </div>
            )}
          </div>

          {/* Examples */}
          <div className="space-y-3">
            <p className="text-[11px] font-black uppercase tracking-widest text-white/30">Misollar</p>
            {config.rule.examples.map((ex, i) => (
              <div key={i} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-2">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-4 w-4 text-green shrink-0 mt-0.5" />
                  <p className="text-sm text-white">{ex.correct}</p>
                </div>
                {ex.incorrect && (
                  <div className="flex items-start gap-3">
                    <XCircle className="h-4 w-4 text-red shrink-0 mt-0.5" />
                    <p className="text-sm text-white/50 line-through">{ex.incorrect}</p>
                  </div>
                )}
                {ex.note && (
                  <p className="text-xs text-white/40 italic pl-7">{ex.note}</p>
                )}
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setPhase('practice')}
            className="w-full flex items-center justify-center gap-2 rounded-2xl bg-blue py-3.5 text-sm font-black text-white hover:bg-blue/90 transition-all active:scale-[0.98] shadow-lg shadow-blue/20"
          >
            Mashqga o'tish <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Practice phase */}
      {phase === 'practice' && (
        <div className="space-y-4">
          {config.exercises.map((ex, idx) => {
            const resp = responses[ex.id];
            const checked = resp?.checked ?? false;
            const correct = resp?.correct;

            return (
              <div
                key={ex.id}
                className={cn(
                  'rounded-2xl border p-5 space-y-3 transition-colors',
                  checked
                    ? correct
                      ? 'border-green/25 bg-green/5'
                      : 'border-red/25 bg-red/5'
                    : 'border-white/[0.07] bg-white/[0.02]'
                )}
              >
                <p className="text-sm font-semibold text-white">
                  <span className="font-mono text-[11px] text-white/30 mr-2">{idx + 1}.</span>
                  {ex.prompt}
                </p>

                {/* Choose correct */}
                {ex.type === 'choose_correct' && ex.options && (
                  <div className="flex flex-wrap gap-2">
                    {ex.options.map((opt) => (
                      <button
                        type="button"
                        key={opt}
                        disabled={!editable || checked}
                        onClick={() => setValue(ex.id, opt)}
                        className={cn(
                          'rounded-xl border px-4 py-2 text-sm font-medium transition-all',
                          resp?.value === opt
                            ? checked
                              ? correct
                                ? 'border-green/40 bg-green/15 text-green'
                                : 'border-red/40 bg-red/15 text-red'
                              : 'border-blue/40 bg-blue/15 text-blue'
                            : checked && opt === ex.answer
                            ? 'border-green/40 bg-green/10 text-green'
                            : 'border-white/[0.08] text-white/50 hover:border-white/[0.15] hover:text-white',
                          (!editable || checked) && 'cursor-not-allowed'
                        )}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                )}

                {/* Fill blank / transformation / error correction */}
                {(ex.type === 'fill_blank' || ex.type === 'transformation' || ex.type === 'error_correction') && (
                  <input
                    type="text"
                    value={resp?.value ?? ''}
                    disabled={!editable || checked}
                    onChange={(e) => setValue(ex.id, e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !checked) checkAnswer(ex); }}
                    placeholder="Javobingizni yozing..."
                    className={cn(
                      'w-full rounded-xl border bg-white/[0.04] px-4 py-2.5 text-sm text-white placeholder-white/20 outline-none transition-colors',
                      checked
                        ? correct
                          ? 'border-green/40'
                          : 'border-red/40'
                        : 'border-white/[0.08] focus:border-blue/40'
                    )}
                  />
                )}

                {/* Feedback */}
                {checked && (
                  <div className={cn(
                    'flex items-start gap-2 rounded-xl p-3 text-sm',
                    correct ? 'bg-green/10' : 'bg-red/10'
                  )}>
                    {correct
                      ? <CheckCircle2 className="h-4 w-4 text-green shrink-0 mt-0.5" />
                      : <XCircle className="h-4 w-4 text-red shrink-0 mt-0.5" />
                    }
                    <div className="space-y-1">
                      {!correct && (
                        <p className="font-bold text-white">
                          To'g'ri javob: <span className="text-green">{ex.answer}</span>
                        </p>
                      )}
                      {correct && <p className="font-bold text-green">Ajoyib! To'g'ri!</p>}
                      {ex.explanation && (
                        <p className="text-white/60 text-xs">{ex.explanation}</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Check button */}
                {!checked && editable && resp?.value && (
                  <button
                    type="button"
                    onClick={() => checkAnswer(ex)}
                    className="rounded-xl bg-blue/20 border border-blue/30 px-4 py-2 text-sm font-bold text-blue hover:bg-blue/30 transition-all"
                  >
                    Tekshirish
                  </button>
                )}
              </div>
            );
          })}

          {/* Summary */}
          {allChecked && (
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 text-center">
              <p className="text-2xl font-black text-white mb-1">
                {correctCount}/{config.exercises.length}
              </p>
              <p className="text-sm text-white/50">
                {correctCount === config.exercises.length
                  ? "Barcha savollar to'g'ri! Zo'r ish!"
                  : `${config.exercises.length - correctCount} ta xato bor — qoidani qayta ko'ring`}
              </p>
              {correctCount < config.exercises.length && (
                <button
                  type="button"
                  onClick={() => setPhase('learn')}
                  className="mt-4 flex items-center gap-2 mx-auto text-sm font-bold text-blue hover:text-blue/70 transition-colors"
                >
                  <BookOpen className="h-4 w-4" /> Qoidani qayta o'qish
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
