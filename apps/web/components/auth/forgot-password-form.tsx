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

const ForgotPasswordSchema = z.object({
  email: z.string().email('Email noto\'g\'ri formatda'),
});

type Values = z.infer<typeof ForgotPasswordSchema>;

export function ForgotPasswordForm({ locale }: { locale: string }) {
  const router = useRouter();
  const [success, setSuccess] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(ForgotPasswordSchema),
  });

  const onSubmit = async ({ email }: Values) => {
    setServerError(null);
    try {
      await authApi.passwordResetRequest({ email });
      // Anti-enumeration: always confirm success regardless of whether the
      // email exists in the system.
      setSuccess(email);
    } catch (error) {
      if (error instanceof ApiClientError) {
        const code = extractErrorCode(error.details);
        // Surface throttling / server problems so the request isn't a silent
        // failure. For any other API error, preserve the anti-enumeration
        // success response.
        if (
          code === 'RATE_LIMITED' ||
          code === 'TOO_MANY_REQUESTS' ||
          error.statusCode === 429 ||
          error.statusCode >= 500
        ) {
          setServerError(getAuthErrorMessage(code, { locale, fallback: error.message }));
          return;
        }
        setSuccess(email);
      } else {
        setServerError(getAuthErrorMessage('NETWORK_ERROR', { locale }));
      }
    }
  };

  if (success) {
    return (
      <div className="space-y-6 text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-green-tint ring-1 ring-inset ring-green/30">
          <svg
            className="h-10 w-10 text-green"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
            <polyline points="22,6 12,13 2,6" />
          </svg>
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-ink-strong">
            Havola yuborildi
          </h2>
          <p className="text-ink-soft">
            Agar <span className="font-semibold text-ink-strong">{success}</span> manzili
            bizning tizimda mavjud bo&apos;lsa, tiklash havolasini yubordik.
            Pochta qutingizni tekshiring.
          </p>
        </div>
        <Button
          variant="secondary"
          fullWidth
          size="lg"
          onClick={() => router.push(`/${locale}/login`)}
        >
          Kirish sahifasiga qaytish
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
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        required
        placeholder="siz@misol.uz"
        error={errors.email?.message}
        {...register('email')}
      />
      <Button type="submit" loading={isSubmitting} fullWidth size="lg">
        Tiklash havolasini yuborish
      </Button>
    </form>
  );
}
