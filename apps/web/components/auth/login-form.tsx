'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { FormField } from '../ui/form-field';
import { Button } from '../ui/button';
import { HCaptchaWidget } from './hcaptcha-widget';
import { authApi } from '../../lib/auth-api';
import { ApiClientError } from '../../lib/api-client';
import { extractErrorCode, getAuthErrorMessage } from '../../lib/auth-errors';
import {
  isMfaChallengeRequired,
  type LoginTokens,
  type MfaChallengeRequired,
} from '../../lib/mfa-api';
import { MfaChallenge } from './mfa/mfa-challenge';

const LoginSchema = z.object({
  email: z.string().email("Email noto'g'ri formatda"),
  password: z.string().min(1, 'Parol talab qilinadi'),
});

type LoginFormValues = z.infer<typeof LoginSchema>;

interface LoginFormProps {
  locale: string;
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
  const [challenge, setChallenge] = useState<MfaChallengeRequired | null>(null);
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [hCaptchaToken, setHCaptchaToken] = useState<string | null>(null);
  const [rememberMe, setRememberMe] = useState(true);

  const REMEMBER_KEY = 'bilgim.remember_email';

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(LoginSchema),
  });

  // "Remember me": prefill the saved email on mount.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(REMEMBER_KEY);
      if (saved) {
        setValue('email', saved);
        setRememberMe(true);
      }
    } catch {
      /* ignore storage errors */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const verified = searchParams.get('verified') === '1';
  const sessionExpired = searchParams.get('reason') === 'session_expired';

  const redirectAfterAuth = (role: 'STUDENT' | 'TEACHER' | 'ADMIN') => {
    const callbackUrl = searchParams.get('callbackUrl');
    if (callbackUrl && callbackUrl.startsWith('/')) {
      router.push(callbackUrl);
      return;
    }
    switch (role) {
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
  };

  const handleChallengeSuccess = (tokens: LoginTokens) => {
    setChallenge(null);
    redirectAfterAuth(tokens.user.role);
  };

  const onSubmit = async (values: LoginFormValues) => {
    setServerError(null);
    if (captchaRequired && !hCaptchaToken) {
      setServerError(getAuthErrorMessage('CAPTCHA_REQUIRED', { locale }));
      return;
    }
    // "Remember me": persist or clear the saved email for next time.
    try {
      if (rememberMe) {
        window.localStorage.setItem(REMEMBER_KEY, values.email);
      } else {
        window.localStorage.removeItem(REMEMBER_KEY);
      }
    } catch {
      /* ignore storage errors */
    }
    try {
      const result = await authApi.login({
        ...values,
        ...(hCaptchaToken ? { hCaptchaToken } : {}),
      });

      if (isMfaChallengeRequired(result)) {
        setChallenge(result);
        return;
      }

      redirectAfterAuth(result.user.role);
    } catch (error) {
      if (error instanceof ApiClientError) {
        const code = extractErrorCode(error.details);
        if (code === 'CAPTCHA_REQUIRED') {
          setCaptchaRequired(true);
          setHCaptchaToken(null);
        }
        setServerError(getAuthErrorMessage(code, { locale, fallback: error.message }));
      } else {
        setServerError(getAuthErrorMessage('NETWORK_ERROR', { locale }));
      }
    }
  };

  // Second-factor step — replaces the password form once login pivots to MFA.
  if (challenge) {
    return (
      <MfaChallenge
        challenge={challenge}
        locale={locale}
        onSuccess={handleChallengeSuccess}
        onCancel={() => {
          setChallenge(null);
          setServerError(null);
        }}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      {sessionExpired && !serverError && (
        <div
          role="status"
          className="rounded-2xl border border-orange/30 bg-orange-tint p-4 text-sm font-medium text-orange"
        >
          {getAuthErrorMessage('INVALID_REFRESH_TOKEN', { locale })}
        </div>
      )}

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

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
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

      {captchaRequired && (
        <HCaptchaWidget onVerify={setHCaptchaToken} onExpire={() => setHCaptchaToken(null)} />
      )}

      <Button
        type="submit"
        loading={isSubmitting}
        disabled={captchaRequired && !hCaptchaToken}
        fullWidth
        size="lg"
      >
        Kirish
      </Button>
    </form>
  );
}
