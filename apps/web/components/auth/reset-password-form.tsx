'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { FormField } from '../ui/form-field';
import { Button } from '../ui/button';
import { authApi } from '../../lib/auth-api';
import { ApiClientError } from '../../lib/api-client';
import { extractErrorCode, getAuthErrorMessage } from '../../lib/auth-errors';

const ResetPasswordSchema = z
  .object({
    password: z.string().min(8, 'Parol kamida 8 ta belgi bo\'lishi kerak'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Parollar mos kelmadi',
  });

type Values = z.infer<typeof ResetPasswordSchema>;

export function ResetPasswordForm({
  locale,
  token,
}: {
  locale: string;
  token: string | undefined;
}) {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(ResetPasswordSchema),
  });

  const onSubmit = async ({ password }: Values) => {
    if (!token) {
      setServerError(getAuthErrorMessage('INVALID_OR_EXPIRED_TOKEN', { locale }));
      return;
    }
    setServerError(null);
    try {
      await authApi.passwordResetConfirm({ token, newPassword: password });
      setSuccess(true);
    } catch (error) {
      if (error instanceof ApiClientError) {
        const code = extractErrorCode(error.details);
        setServerError(getAuthErrorMessage(code, { locale, fallback: error.message }));
      } else {
        setServerError(getAuthErrorMessage('NETWORK_ERROR', { locale }));
      }
    }
  };

  if (!token) {
    return (
      <div className="space-y-6 text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-red-tint ring-1 ring-inset ring-red/30">
          <svg
            className="h-10 w-10 text-red"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-ink-strong">Havola topilmadi</h2>
        <p className="text-ink-soft">
          Tiklash havolasini email orqali oldingiz. Iltimos, havolani bosing.
        </p>
        <Button
          variant="secondary"
          fullWidth
          size="lg"
          onClick={() => router.push(`/${locale}/forgot-password`)}
        >
          Yangi havola olish
        </Button>
      </div>
    );
  }

  if (success) {
    return (
      <div className="space-y-6 text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-green-tint ring-1 ring-inset ring-green/30">
          <svg
            className="h-10 w-10 text-green"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-ink-strong">
          Parol o&apos;zgartirildi 🎉
        </h2>
        <p className="text-ink-soft">
          Endi yangi parolingiz bilan kirishingiz mumkin.
        </p>
        <Button
          fullWidth
          size="lg"
          onClick={() => router.push(`/${locale}/login`)}
        >
          Kirish
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      {serverError && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-2xl border border-red/30 bg-red-tint p-4 text-sm text-red"
        >
          {serverError}
        </div>
      )}

      <FormField
        id="password"
        label="Yangi parol"
        type={showPassword ? 'text' : 'password'}
        autoComplete="new-password"
        required
        placeholder="Kamida 8 belgi"
        error={errors.password?.message}
        rightIcon={
          <button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            className="pointer-events-auto text-ink-faint hover:text-ink-strong"
            aria-label={showPassword ? "Parolni yashirish" : "Parolni ko'rsatish"}
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
        {...register('password')}
      />

      <FormField
        id="confirmPassword"
        label="Parolni tasdiqlang"
        type={showPassword ? 'text' : 'password'}
        autoComplete="new-password"
        required
        placeholder="Parolni qaytadan kiriting"
        error={errors.confirmPassword?.message}
        {...register('confirmPassword')}
      />

      <Button type="submit" loading={isSubmitting} fullWidth size="lg">
        Parolni yangilash
      </Button>
    </form>
  );
}
