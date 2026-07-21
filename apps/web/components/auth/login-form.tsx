'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { FormField } from '../ui/form-field';
import { Button } from '../ui/button';
import { authApi } from '../../lib/auth-api';
import { ApiClientError } from '../../lib/api-client';
import { extractErrorCode, getAuthErrorMessage } from '../../lib/auth-errors';

const LoginSchema = z.object({
  email: z.string().email("Email noto'g'ri formatda"),
  password: z.string().min(1, 'Parol talab qilinadi'),
});

type LoginFormValues = z.infer<typeof LoginSchema>;

interface LoginFormProps {
  locale: string;
}

// ═══════════════════════════════════════════════════════════════
// Simple math captcha (client-side bot deterrent, shown after password)
// ═══════════════════════════════════════════════════════════════

const CAPTCHA_OPS = ['+', '-', '×', '÷'] as const;
type CaptchaOp = (typeof CAPTCHA_OPS)[number];

interface Captcha {
  a: number;
  b: number;
  op: CaptchaOp;
  answer: number;
  question: string;
}

function generateCaptcha(): Captcha {
  const op = CAPTCHA_OPS[Math.floor(Math.random() * CAPTCHA_OPS.length)] as CaptchaOp;
  let a = 0;
  let b = 0;
  let answer = 0;

  switch (op) {
    case '+':
      a = 1 + Math.floor(Math.random() * 10);
      b = 1 + Math.floor(Math.random() * 10);
      answer = a + b;
      break;
    case '-':
      a = 1 + Math.floor(Math.random() * 10);
      b = 1 + Math.floor(Math.random() * 10);
      if (b > a) [a, b] = [b, a]; // avoid negative results
      answer = a - b;
      break;
    case '×':
      a = 1 + Math.floor(Math.random() * 9);
      b = 1 + Math.floor(Math.random() * 9);
      answer = a * b;
      break;
    case '÷': {
      b = 1 + Math.floor(Math.random() * 9);
      const q = 1 + Math.floor(Math.random() * 9);
      a = b * q; // guarantees a whole-number result
      answer = q;
      break;
    }
  }

  return { a, b, op, answer, question: `${a} ${op} ${b}` };
}

/**
 * LoginForm — email + password sign-in.
 *
 * On success:
 *  - Tokens are stored by `authApi.login` (localStorage + cookie).
 *  - User is redirected to `?callbackUrl` if present, otherwise role-based:
 *      TEACHER  -> /{locale}/dashboard
 *      STUDENT  -> /{locale}/dashboard
 *      ADMIN    -> /{locale}/admin
 *
 * On error: surfaces a friendly Uzbek message based on the backend
 * `error.code` envelope (see `lib/auth-errors.ts`).
 */
export function LoginForm({ locale }: LoginFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [remember, setRemember] = useState(false);
  // Generated client-side only (useEffect), never during the initial render —
  // Math.random() during render would mismatch the server-rendered HTML and
  // trigger a hydration error.
  const [captcha, setCaptcha] = useState<Captcha | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [captchaError, setCaptchaError] = useState<string | null>(null);

  useEffect(() => {
    setCaptcha(generateCaptcha());
  }, []);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(LoginSchema),
  });

  const verified = searchParams.get('verified') === '1';

  const refreshCaptcha = () => {
    setCaptcha(generateCaptcha());
    setCaptchaAnswer('');
    setCaptchaError(null);
  };

  const onSubmit = async (values: LoginFormValues) => {
    setServerError(null);

    if (!captcha || Number(captchaAnswer) !== captcha.answer) {
      setCaptchaError("Javob noto'g'ri, qaytadan urinib ko'ring");
      refreshCaptcha();
      return;
    }
    setCaptchaError(null);

    try {
      const result = await authApi.login(values, remember);
      const callbackUrl = searchParams.get('callbackUrl');

      if (callbackUrl && callbackUrl.startsWith('/')) {
        router.push(callbackUrl);
        return;
      }

      switch (result.user.role) {
        case 'TEACHER':
        case 'STUDENT':
          router.push(`/${locale}/dashboard`);
          break;
        case 'ADMIN':
          router.push(`/${locale}/admin`);
          break;
        default:
          router.push(`/${locale}`);
      }
    } catch (error) {
      if (error instanceof ApiClientError) {
        const code = extractErrorCode(error.details);
        setServerError(getAuthErrorMessage(code, error.message));
      } else {
        setServerError(getAuthErrorMessage('NETWORK_ERROR'));
      }
      refreshCaptcha();
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      {verified && !serverError && (
        <div
          role="status"
          className="rounded-2xl border border-green/30 bg-green-tint p-4 text-sm font-medium text-green"
        >
          Email tasdiqlandi. Endi kirishingiz mumkin.
        </div>
      )}

      {serverError && (
        <div
          role="alert"
          className="rounded-2xl border border-red/30 bg-red-tint p-4 text-sm text-red"
        >
          <div className="flex gap-2">
            <svg
              className="h-5 w-5 flex-shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{serverError}</span>
          </div>
        </div>
      )}

      <FormField
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        required
        placeholder="siz@misol.uz"
        leftIcon={
          <svg
            className="h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
            <polyline points="22,6 12,13 2,6" />
          </svg>
        }
        error={errors.email?.message}
        {...register('email')}
      />

      <FormField
        id="password"
        label="Parol"
        type={showPassword ? 'text' : 'password'}
        autoComplete="current-password"
        required
        placeholder="••••••••"
        leftIcon={
          <svg
            className="h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        }
        rightIcon={
          <button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            className="pointer-events-auto text-ink-faint transition-colors hover:text-ink-strong"
            tabIndex={-1}
            aria-label={
              showPassword ? "Parolni yashirish" : "Parolni ko'rsatish"
            }
            aria-pressed={showPassword}
          >
            {showPassword ? (
              <svg
                className="h-5 w-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
              <svg
                className="h-5 w-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        }
        error={errors.password?.message}
        {...register('password')}
      />

      <FormField
        id="captcha"
        label={
          captcha
            ? `Tasdiqlash uchun hisoblang: ${captcha.question} = ?`
            : 'Tasdiqlash yuklanmoqda...'
        }
        type="text"
        inputMode="numeric"
        autoComplete="off"
        required
        disabled={!captcha}
        placeholder="Javob"
        value={captchaAnswer}
        onChange={(e) => setCaptchaAnswer(e.target.value)}
        error={captchaError ?? undefined}
        rightIcon={
          <button
            type="button"
            onClick={refreshCaptcha}
            className="pointer-events-auto text-ink-faint transition-colors hover:text-ink-strong"
            tabIndex={-1}
            aria-label="Boshqa misol"
          >
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
        }
      />

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="h-4 w-4 rounded border-rim accent-blue"
          />
          Eslab qolish
        </label>
        <Link
          href={`/${locale}/forgot-password`}
          className="text-sm font-semibold text-ink-soft underline-offset-4 transition-colors hover:text-blue hover:underline"
        >
          Parolni unutdingizmi?
        </Link>
      </div>

      <Button type="submit" loading={isSubmitting} fullWidth size="lg">
        Kirish
      </Button>
    </form>
  );
}
