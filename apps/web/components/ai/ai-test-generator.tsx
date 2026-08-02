'use client';

import { useState } from 'react';
import { Sparkles, Loader2, CheckCircle2, ChevronDown, ChevronUp, Plus, RefreshCw } from 'lucide-react';
import { apiClient } from '../../lib/api-client';
import { cn } from '../../lib/utils';

interface GeneratedQuestion {
  type: 'mcq' | 'true_false' | 'short';
  prompt: string;
  choices?: string[];
  answer: string | string[];
  explanation?: string;
}

interface GenerateTestResult {
  questions: GeneratedQuestion[];
  topic: string;
  difficulty: string;
}

interface AiTestGeneratorProps {
  onApply: (questions: GeneratedQuestion[], passage: string) => void;
}

const TYPE_LABELS: Record<string, string> = {
  mcq: "Ko'p tanlovli",
  true_false: "To'g'ri/Noto'g'ri",
  short: 'Qisqa javob',
};

const DIFFICULTY_LABELS: Record<string, string> = {
  easy: 'Oson',
  medium: "O'rtacha",
  hard: 'Qiyin',
};

export function AiTestGenerator({ onApply }: AiTestGeneratorProps) {
  const [expanded, setExpanded] = useState(false);
  const [content, setContent] = useState('');
  const [passage, setPassage] = useState('');
  const [questionCount, setQuestionCount] = useState(5);
  const [types, setTypes] = useState<string[]>(['mcq', 'true_false']);
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [locale, setLocale] = useState<'uz' | 'ru' | 'en'>('uz');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GenerateTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggleType = (t: string) => {
    setTypes((prev) =>
      prev.includes(t) ? (prev.length > 1 ? prev.filter((x) => x !== t) : prev) : [...prev, t],
    );
  };

  const handleGenerate = async () => {
    if (!content.trim()) {
      setError("Matn kiriting — AI shu asosida savollar tuzadi");
      return;
    }
    setError(null);
    setLoading(true);
    setResult(null);
    try {
      const data = await apiClient.post<GenerateTestResult>('/ai/generate-test', {
        content: content.trim(),
        questionCount,
        types,
        difficulty,
        locale,
      });
      setResult(data);
      if (!passage.trim()) setPassage(content.trim().slice(0, 1500));
    } catch (err: any) {
      setError(err?.message ?? "Savollar yaratib bo'lmadi");
    } finally {
      setLoading(false);
    }
  };

  const handleApply = () => {
    if (!result) return;
    onApply(result.questions, passage || content.slice(0, 1500));
    setExpanded(false);
  };

  return (
    <div className="rounded-2xl border border-blue/20 bg-blue/[0.03] overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-blue/[0.05] transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-blue to-purple flex items-center justify-center shadow-lg shadow-blue/20">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-black text-ink-strong">AI bilan test yaratish</p>
            <p className="text-[11px] text-ink-soft">Matn kiriting — AI avtomatik savollar tuzadi</p>
          </div>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-ink-soft" />
        ) : (
          <ChevronDown className="h-4 w-4 text-ink-soft" />
        )}
      </button>

      {/* Body */}
      {expanded && (
        <div className="px-5 pb-5 space-y-5 border-t border-rim">
          <div className="pt-4 space-y-1">
            <label className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-soft">
              Dars matni / materiallari
            </label>
            <textarea
              rows={5}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Bu yerga dars matnini, mavzuni yoki materiallarni kiriting. AI shu asosida savollar tuzadi..."
              className="w-full rounded-2xl border border-rim bg-tint px-4 py-3 text-sm text-ink-strong placeholder-ink-faint/50 outline-none focus:border-blue/40 focus:bg-soft resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="space-y-1">
              <label className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-soft">
                Savollar soni
              </label>
              <select
                value={questionCount}
                onChange={(e) => setQuestionCount(Number(e.target.value))}
                className="w-full rounded-xl border border-rim bg-tint px-3 py-2 text-sm text-ink-strong outline-none focus:border-blue/40"
              >
                {[3, 5, 8, 10, 15].map((n) => (
                  <option key={n} value={n} className="bg-canvas">
                    {n} ta
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-soft">
                Qiyinlik
              </label>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as any)}
                className="w-full rounded-xl border border-rim bg-tint px-3 py-2 text-sm text-ink-strong outline-none focus:border-blue/40"
              >
                {Object.entries(DIFFICULTY_LABELS).map(([k, v]) => (
                  <option key={k} value={k} className="bg-canvas">
                    {v}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-soft">
                Til
              </label>
              <select
                value={locale}
                onChange={(e) => setLocale(e.target.value as any)}
                className="w-full rounded-xl border border-rim bg-tint px-3 py-2 text-sm text-ink-strong outline-none focus:border-blue/40"
              >
                <option value="uz" className="bg-canvas">O'zbek</option>
                <option value="ru" className="bg-canvas">Русский</option>
                <option value="en" className="bg-canvas">English</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-soft">
                Savol turi
              </label>
              <div className="flex flex-col gap-1">
                {Object.entries(TYPE_LABELS).map(([k, v]) => (
                  <label key={k} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={types.includes(k)}
                      onChange={() => toggleType(k)}
                      className="h-3 w-3 rounded accent-blue"
                    />
                    <span className="text-[11px] text-ink-soft">{v}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {error && (
            <p className="text-xs text-red/80 bg-red/10 rounded-xl px-3 py-2">{error}</p>
          )}

          <button
            type="button"
            onClick={handleGenerate}
            disabled={loading || !content.trim()}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue to-purple px-5 py-2.5 text-sm font-black text-white shadow-lg shadow-blue/20 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                AI savollar tuzmoqda...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Savollar yaratish
              </>
            )}
          </button>

          {/* Generated questions preview */}
          {result && (
            <div className="space-y-3 border-t border-rim pt-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-teal" />
                  <p className="text-sm font-black text-ink-strong">
                    {result.questions.length} ta savol yaratildi
                  </p>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-ink-soft">
                    • {result.topic} • {DIFFICULTY_LABELS[result.difficulty]}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={loading}
                  className="flex items-center gap-1 text-[11px] font-bold text-blue hover:text-blue/70 transition-colors"
                >
                  <RefreshCw className="h-3 w-3" />
                  Qayta
                </button>
              </div>

              <div className="space-y-2 max-h-60 overflow-y-auto scrollbar-hide pr-1">
                {result.questions.map((q, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-rim bg-tint px-4 py-3"
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-[10px] font-black uppercase tracking-widest text-blue/60 mt-0.5 shrink-0">
                        {i + 1}. {TYPE_LABELS[q.type]}
                      </span>
                      <p className="text-sm text-ink-strong leading-relaxed">{q.prompt}</p>
                    </div>
                    {q.choices && q.choices.length > 0 && (
                      <div className="mt-2 ml-14 space-y-1">
                        {q.choices.map((c, ci) => (
                          <div
                            key={ci}
                            className={cn(
                              'text-xs px-2 py-1 rounded-lg',
                              (Array.isArray(q.answer) ? q.answer.includes(c) : q.answer === c)
                                ? 'bg-teal/10 text-teal font-bold'
                                : 'text-ink-soft',
                            )}
                          >
                            {c}
                          </div>
                        ))}
                      </div>
                    )}
                    {q.explanation && (
                      <p className="mt-2 ml-14 text-[11px] text-ink-soft italic">{q.explanation}</p>
                    )}
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <label className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-soft">
                  O'qish matni (Reading moduliga qo'shiladi)
                </label>
                <textarea
                  rows={3}
                  value={passage}
                  onChange={(e) => setPassage(e.target.value)}
                  placeholder="Talabalar o'qiydigan matn (content dan avtomatik olingan, o'zgartirish mumkin)..."
                  className="w-full rounded-xl border border-rim bg-tint px-4 py-3 text-sm text-ink-strong placeholder-ink-faint/50 outline-none focus:border-blue/40 resize-none"
                />
              </div>

              <button
                type="button"
                onClick={handleApply}
                className="flex items-center gap-2 rounded-xl bg-teal/20 border border-teal/30 text-teal px-5 py-2.5 text-sm font-black transition-all hover:bg-teal/30 active:scale-95"
              >
                <Plus className="h-4 w-4" />
                Reading moduliga qo'shish
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
