'use client';

import { useEffect, useRef, useState } from 'react';
import { ShieldCheck, KeyRound, ArrowLeft } from 'lucide-react';

import { Button } from '../../ui/button';
import { ApiClientError } from '../../../lib/api-client';
import { extractErrorCode, getAuthErrorMessage } from '../../../lib/auth-errors';
import {
  mfaApi,
  type LoginTokens,
  type MfaChallengeRequired,
} from '../../../lib/mfa-api';

interface MfaChallengeProps {
  challenge: MfaChallengeRequired;
  locale: string;
  /** Fired with the token pair once the second factor is verified. */
  onSuccess: (tokens: LoginTokens) => void;
  /** Fired when the user abandons the challenge (back to password step). */
  onCancel: () => void;
}

type Mode = 'totp' | 'backup';

/**
 * Second-factor step shown after `/auth/login` returns
 * `{ requiresMfa: true, mfaToken, methods }`. The user enters a TOTP code or
 * a backup recovery code; both are completed via `/auth/mfa/challenge`.
 *
 * Note: WebAuthn assertions during login require an authenticated challenge
 * context that the public login surface does not expose, so the in-login
 * challenge covers TOTP + backup codes. Passkey-only accounts are guided to
 * use a backup code.
 */
export function MfaChallenge({
  challenge,
  locale,
  onSuccess,
  onCancel,
}: MfaChallengeProps) {
  const hasTotp = challenge.methods.includes('totp');
  const hasBackup = challenge.methods.includes('backup');
  const onlyWebAuthn = !hasTotp && !hasBackup;

  const [mode, setMode] = useState<Mode>(hasTotp ? 'totp' : 'backup');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  const isTotpMode = mode === 'totp';

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);

    const trimmed = code.trim();
    if (isTotpMode && !/^\d{6}$/.test(trimmed)) {
      setError(getAuthErrorMessage('INVALID_TOTP_CODE', { locale }));
      return;
    }
    if (!isTotpMode && trimmed.length < 8) {
      setError(getAuthErrorMessage('INVALID_BACKUP_CODE', { locale }));
      return;
    }

    setSubmitting(true);
    try {
      const tokens = await mfaApi.completeChallengeWithCode(
        challenge.mfaToken,
        trimmed,
      );
      onSuccess(tokens);
    } catch (err) {
      if (err instanceof ApiClientError) {
        const apiCode = extractErrorCode(err.details);
        setError(getAuthErrorMessage(apiCode, { locale, fallback: err.message }));
      } else {
        setError(getAuthErrorMessage('NETWORK_ERROR', { locale }));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue/5 text-blue">
          <ShieldCheck className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1
          className="text-2xl font-extrabold tracking-tight text-ink-strong"
          style={{ letterSpacing: '-0.03em' }}
        >
          Ikki bosqichli tasdiqlash
        </h1>
        <p className="text-sm text-ink-soft">
          {isTotpMode
            ? 'Authenticator ilovangizdagi 6 xonali kodni kiriting.'
            : 'Zaxira (backup) kodlaringizdan birini kiriting.'}
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-2xl border border-red/30 bg-red-tint p-4 text-sm text-red">
          {error}
        </div>
      )}

      {onlyWebAuthn ? (
        <div className="space-y-4">
          <p className="rounded-2xl border border-orange/30 bg-orange-tint p-4 text-sm text-orange">
            Bu hisob faqat passkey bilan himoyalangan. Brauzerda passkey bilan
            kirish hozircha qoʻllab-quvvatlanmaydi — iltimos, mobil ilovadan
            foydalaning yoki zaxira kodidan foydalaning.
          </p>
          <Button type="button" variant="secondary" fullWidth onClick={onCancel}>
            Orqaga
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <div className="space-y-2">
            <label htmlFor="mfa-code" className="sr-only">
              {isTotpMode ? 'Tasdiqlash kodi' : 'Zaxira kodi'}
            </label>
            <input
              id="mfa-code"
              ref={inputRef}
              inputMode={isTotpMode ? 'numeric' : 'text'}
              autoComplete="one-time-code"
              maxLength={isTotpMode ? 6 : 32}
              value={code}
              onChange={(e) =>
                setCode(
                  isTotpMode ? e.target.value.replace(/\D/g, '') : e.target.value,
                )
              }
              placeholder={isTotpMode ? '123456' : 'xxxx-xxxx'}
              className="w-full rounded-2xl border border-rim bg-tint/30 px-4 py-3.5 text-center font-mono text-lg tracking-[0.3em] text-ink-strong outline-none transition-all focus:border-blue/30 focus:bg-white focus:ring-4 focus:ring-blue/5"
              aria-describedby={error ? 'mfa-code-error' : undefined}
            />
          </div>

          <Button
            type="submit"
            fullWidth
            size="lg"
            loading={submitting}
            disabled={isTotpMode ? code.length !== 6 : code.trim().length < 8}
          >
            Tasdiqlash
          </Button>

          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center gap-1.5 font-semibold text-ink-soft transition-colors hover:text-ink-strong"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Orqaga
            </button>

            {hasTotp && hasBackup && (
              <button
                type="button"
                onClick={() => {
                  setMode(isTotpMode ? 'backup' : 'totp');
                  setCode('');
                  setError(null);
                }}
                className="inline-flex items-center gap-1.5 font-semibold text-blue transition-colors hover:underline"
              >
                <KeyRound className="h-4 w-4" aria-hidden="true" />
                {isTotpMode ? 'Zaxira kodi bilan kirish' : 'Authenticator kodi bilan kirish'}
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
