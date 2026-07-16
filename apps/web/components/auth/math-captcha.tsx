'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Check } from 'lucide-react';

import { cn } from '../../lib/utils';

// ═════════════════════════════════════════════════════════════════
// MathCaptcha — a lightweight "are you human?" check.
//
// Generates a simple arithmetic problem (+, −, ×, ÷) the user must solve
// before the form submits. Division problems always yield a whole number
// and subtraction never goes negative, so answers are always integers.
// Theme-aware (semantic tokens) and accessible. Calls `onVerifiedChange`
// whenever the solved state flips.
// ═════════════════════════════════════════════════════════════════

type Op = '+' | '−' | '×' | '÷';

interface Problem {
  a: number;
  b: number;
  op: Op;
  answer: number;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateProblem(): Problem {
  const op = (['+', '−', '×', '÷'] as const)[randInt(0, 3)]!;
  switch (op) {
    case '+': {
      const a = randInt(1, 20);
      const b = randInt(1, 20);
      return { a, b, op, answer: a + b };
    }
    case '−': {
      const a = randInt(10, 30);
      const b = randInt(1, a); // never negative
      return { a, b, op, answer: a - b };
    }
    case '×': {
      const a = randInt(2, 9);
      const b = randInt(2, 9);
      return { a, b, op, answer: a * b };
    }
    case '÷':
    default: {
      // Build a clean division: answer × b = a (integer result).
      const b = randInt(2, 9);
      const answer = randInt(2, 9);
      const a = b * answer;
      return { a, b, op, answer };
    }
  }
}

interface MathCaptchaProps {
  /** Called whenever the verified (correctly solved) state changes. */
  onVerifiedChange: (verified: boolean) => void;
  /** Optional id for the input (label association). */
  id?: string;
  className?: string;
}

export function MathCaptcha({ onVerifiedChange, id = 'math-captcha', className }: MathCaptchaProps) {
  // Generate only on the client (after mount) so SSR and first client render
  // match — otherwise the random numbers differ and React throws a hydration
  // "text content does not match" error.
  const [problem, setProblem] = useState<Problem | null>(null);
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    setProblem(generateProblem());
  }, []);

  const solved = useMemo(() => {
    if (!problem || value.trim() === '') return false;
    return Number(value) === problem.answer;
  }, [value, problem]);

  useEffect(() => {
    onVerifiedChange(solved);
  }, [solved, onVerifiedChange]);

  const refresh = useCallback(() => {
    setProblem(generateProblem());
    setValue('');
    setTouched(false);
  }, []);

  const showError = touched && value.trim() !== '' && !solved;

  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-sm font-semibold text-ink-strong">
        Robot emasligingizni tasdiqlang
      </label>
      <div
        className={cn(
          'flex items-center gap-3 rounded-2xl border bg-tint px-4 py-3 transition-all',
          solved
            ? 'border-green/50 bg-green-tint/40'
            : showError
              ? 'border-red/50'
              : 'border-rim',
        )}
      >
        <span
          className="select-none font-mono text-base font-bold tracking-wider text-ink-strong"
          aria-hidden="true"
        >
          {problem ? `${problem.a} ${problem.op} ${problem.b} =` : '… ='}
        </span>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => setTouched(true)}
          disabled={!problem}
          aria-label={problem ? `Hisoblang: ${problem.a} ${problem.op} ${problem.b}` : 'Yuklanmoqda'}
          aria-invalid={showError || undefined}
          className="w-20 rounded-xl border border-rim bg-canvas px-3 py-1.5 text-center text-base font-bold text-ink-strong outline-none focus:border-blue/60 focus:ring-2 focus:ring-blue/20"
          placeholder="?"
        />
        {solved ? (
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-green text-white" aria-label="To'g'ri">
            <Check className="h-4 w-4" />
          </span>
        ) : (
          <button
            type="button"
            onClick={refresh}
            aria-label="Yangi misol"
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-canvas hover:text-ink-strong"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        )}
      </div>
      {showError && (
        <p className="text-xs font-medium text-red">Javob noto&apos;g&apos;ri. Qaytadan urinib ko&apos;ring.</p>
      )}
    </div>
  );
}
