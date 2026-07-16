'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../ui/button';
import { authApi } from '../../lib/auth-api';
import { ApiClientError } from '../../lib/api-client';
import { extractErrorCode, getAuthErrorMessage } from '../../lib/auth-errors';

interface VerifyEmailClientProps {
  locale: string;
  token: string | undefined;
}

type Status = 'idle' | 'verifying' | 'success' | 'error';

export function VerifyEmailClient({ locale, token }: VerifyEmailClientProps) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    if (status !== 'idle') return;

    setStatus('verifying');
    authApi
      .verifyEmail({ token })
      .then(() => setStatus('success'))
      .catch((error) => {
        setStatus('error');
        if (error instanceof ApiClientError) {
          const code = extractErrorCode(error.details);
          setErrorMessage(getAuthErrorMessage(code, { locale, fallback: error.message }));
        } else {
          setErrorMessage(getAuthErrorMessage('NETWORK_ERROR', { locale }));
        }
      });
  }, [token, status]);

  // ── No token → instructional state ─────────────────────────────
  if (!token) {
    return (
      <div className="space-y-6 text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-blue-tint">
          <svg
            className="h-10 w-10 text-blue"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
            <polyline points="22,6 12,13 2,6" />
          </svg>
        </div>
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-ink-strong">
            Pochta qutingizni tekshiring
          </h1>
          <p className="text-ink-soft">
            Tasdiqlash havolasini email orqali yubordik. Iltimos, havolani
            bosing va akkauntni faollashtiring.
          </p>
        </div>
        <Button
          variant="secondary"
          fullWidth
          size="lg"
          onClick={() => router.push(`/${locale}/login`)}
        >
          Kirish sahifasiga o&apos;tish
        </Button>
      </div>
    );
  }

  // ── Verifying ──────────────────────────────────────────────────
  if (status === 'verifying') {
    return (
      <div className="space-y-6 text-center" role="status" aria-live="polite">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-blue-tint">
          <svg
            className="h-10 w-10 animate-spin text-blue"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <path strokeLinecap="round" d="M12 2a10 10 0 0 1 10 10" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-ink-strong">
          Tekshirilmoqda...
        </h1>
        <p className="text-ink-soft">Iltimos kuting</p>
      </div>
    );
  }

  // ── Success ────────────────────────────────────────────────────
  if (status === 'success') {
    return (
      <div className="space-y-6 text-center" role="status" aria-live="polite">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-green-tint ring-1 ring-inset ring-green/30">
          <svg
            className="h-10 w-10 text-green"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-ink-strong">
            Email tasdiqlandi! 🎉
          </h1>
          <p className="text-ink-soft">
            Akkauntingiz faollashtirildi. Endi kirishingiz mumkin.
          </p>
        </div>
        <Button
          fullWidth
          size="lg"
          onClick={() => router.push(`/${locale}/login?verified=1`)}
        >
          Kirish
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-6 text-center" role="alert" aria-live="assertive">
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-red-tint ring-1 ring-inset ring-red/30">
        <svg
          className="h-10 w-10 text-red"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      </div>
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-ink-strong">Xatolik yuz berdi</h1>
        <p className="text-ink-soft">
          {errorMessage ?? 'Tasdiqlash havolasi yaroqsiz yoki muddati tugagan.'}
        </p>
      </div>
      <div className="space-y-3">
        <Button
          variant="secondary"
          fullWidth
          size="lg"
          onClick={() => router.push(`/${locale}/login`)}
        >
          Kirish sahifasi
        </Button>
        <p className="text-sm text-ink-soft">
          Yangi tasdiqlash havolasi olish uchun{' '}
          <button
            onClick={() => router.push(`/${locale}/register`)}
            className="font-semibold text-blue underline-offset-4 hover:underline"
          >
            qayta ro&apos;yxatdan o&apos;ting
          </button>
        </p>
      </div>
    </div>
  );
}
