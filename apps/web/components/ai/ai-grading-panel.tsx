'use client';

import { useState } from 'react';
import {
  Sparkles, Loader2, AlertTriangle, CheckCircle2,
  ChevronDown, ChevronUp, Shield, BarChart3,
} from 'lucide-react';
import { apiClient } from '../../lib/api-client';
import { cn } from '../../lib/utils';

interface PrecheckResult {
  score: number;
  summary: string;
  highlights: Array<{
    from: number;
    to: number;
    severity: 'info' | 'warning' | 'error';
    reason: string;
  }>;
  aiLikelihood: number;
  aiFlagged: boolean;
}

interface AiGradingPanelProps {
  submissionId: string;
  submissionText: string;
  onApplyScore?: (score: number, feedback: string) => void;
  totalPoints: number;
}

const SEVERITY_STYLES = {
  info: 'bg-blue/10 border-blue/20 text-blue',
  warning: 'bg-yellow-400/10 border-yellow-400/20 text-yellow-400',
  error: 'bg-red/10 border-red/20 text-red',
};

const SEVERITY_LABELS = {
  info: 'Izoh',
  warning: 'Ogoh',
  error: 'Xato',
};

export function AiGradingPanel({
  submissionId,
  submissionText,
  onApplyScore,
  totalPoints,
}: AiGradingPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PrecheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handlePrecheck = async () => {
    if (!submissionText.trim()) {
      setError("Baholash uchun matn topilmadi");
      return;
    }
    setError(null);
    setLoading(true);
    setResult(null);
    try {
      const data = await apiClient.post<PrecheckResult>('/ai/grade/precheck', {
        submissionId,
        text: submissionText,
        rubric: 'Evaluate the quality, accuracy, and clarity of the student submission.',
        language: 'uz',
      });
      setResult(data);
      setExpanded(true);
    } catch (err: any) {
      setError(err?.message ?? "AI baholash amalga oshmadi");
    } finally {
      setLoading(false);
    }
  };

  const handleApply = () => {
    if (!result || !onApplyScore) return;
    const suggestedScore = Math.round(result.score * totalPoints);
    const feedback = result.summary + (result.highlights.length > 0
      ? '\n\nMuhim nuqtalar:\n' + result.highlights
          .filter(h => h.severity !== 'info')
          .map(h => `• ${h.reason}`)
          .join('\n')
      : '');
    onApplyScore(suggestedScore, feedback);
  };

  const aiRisk = result
    ? result.aiFlagged
      ? 'high'
      : result.aiLikelihood > 0.4
      ? 'medium'
      : 'low'
    : null;

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-ink-surface overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-blue to-purple flex items-center justify-center">
            <Sparkles className="h-3.5 w-3.5 text-white" />
          </div>
          <p className="text-sm font-black text-cream">AI Baholash</p>
          {result && (
            <span className={cn(
              'text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full',
              aiRisk === 'high' ? 'bg-red/10 text-red' :
              aiRisk === 'medium' ? 'bg-yellow-400/10 text-yellow-400' :
              'bg-green/10 text-green',
            )}>
              {aiRisk === 'high' ? 'AI shubhali' : aiRisk === 'medium' ? "O'rtacha" : 'Yaxshi'}
            </span>
          )}
        </div>
        {result && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-cream-dim hover:text-cream transition-colors"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        )}
      </div>

      <div className="p-4 space-y-4">
        {/* Score preview */}
        {result && (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-white/[0.04] border border-white/[0.06] p-3 text-center">
              <p className="text-[10px] font-black uppercase tracking-widest text-cream-dim mb-1">AI Ball</p>
              <p className="text-2xl font-black text-cream">
                {Math.round(result.score * totalPoints)}
                <span className="text-sm text-cream-dim font-medium">/{totalPoints}</span>
              </p>
            </div>
            <div className="rounded-xl bg-white/[0.04] border border-white/[0.06] p-3 text-center">
              <p className="text-[10px] font-black uppercase tracking-widest text-cream-dim mb-1">AI Ehtimol</p>
              <div className="flex items-center justify-center gap-1.5">
                <Shield className={cn(
                  'h-4 w-4',
                  result.aiFlagged ? 'text-red' : 'text-green',
                )} />
                <p className="text-2xl font-black text-cream">
                  {Math.round(result.aiLikelihood * 100)}%
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Expanded details */}
        {result && expanded && (
          <div className="space-y-3">
            {result.summary && (
              <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-cream-dim mb-2 flex items-center gap-1.5">
                  <BarChart3 className="h-3 w-3" /> AI Xulosa
                </p>
                <p className="text-sm text-cream/80 leading-relaxed">{result.summary}</p>
              </div>
            )}

            {result.highlights.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-cream-dim">Belgilangan joylar</p>
                {result.highlights.map((h, i) => (
                  <div
                    key={i}
                    className={cn(
                      'rounded-xl border px-3 py-2 text-xs',
                      SEVERITY_STYLES[h.severity],
                    )}
                  >
                    <span className="font-black uppercase tracking-widest text-[9px] mr-2">
                      {SEVERITY_LABELS[h.severity]}
                    </span>
                    {h.reason}
                  </div>
                ))}
              </div>
            )}

            {onApplyScore && (
              <button
                type="button"
                onClick={handleApply}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-blue/20 border border-blue/30 text-blue px-4 py-2.5 text-sm font-black transition-all hover:bg-blue/30 active:scale-95"
              >
                <CheckCircle2 className="h-4 w-4" />
                AI ballini qo'llash ({Math.round(result.score * totalPoints)}/{totalPoints})
              </button>
            )}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-xl bg-red/10 border border-red/20 px-3 py-2.5 text-xs text-red">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={handlePrecheck}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.04] px-4 py-2.5 text-sm font-black text-cream-dim hover:bg-white/[0.07] hover:text-cream transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              AI tekshirmoqda...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              {result ? 'Qayta tekshirish' : 'AI bilan tekshirish'}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
