'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Check, Loader2, ShieldCheck } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../ui/dialog';
import { Button } from '../../ui/button';
import { ApiClientError } from '../../../lib/api-client';
import { extractErrorCode, getAuthErrorMessage } from '../../../lib/auth-errors';
import { mfaApi, type TotpSetupResult } from '../../../lib/mfa-api';
import { BackupCodes } from './backup-codes';

type Step = 'loading' | 'scan' | 'backup' | 'error';

interface TotpSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: string;
  /** Called once the factor is verified (so the parent can refresh the list). */
  onEnrolled: () => void;
}

/**
 * Multi-step TOTP enrollment dialog:
 *   1. Request a setup secret + QR (`/mfa/totp/setup`).
 *   2. User scans the QR (or copies the secret) and enters the 6-digit code.
 *   3. Verify (`/mfa/totp/verify`); on success, generate and display backup
 *      codes once (`/mfa/backup-codes/generate`).
 */
export function TotpSetupDialog({
  open,
  onOpenChange,
  locale,
  onEnrolled,
}: TotpSetupDialogProps) {
  const [step, setStep] = useState<Step>('loading');
  const [setup, setSetup] = useState<TotpSetupResult | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const enrolledRef = useRef(false);

  const beginSetup = useCallback(async () => {
    setStep('loading');
    setError(null);
    try {
      const result = await mfaApi.setupTotp();
      setSetup(result);
      setStep('scan');
    } catch (err) {
      setError(resolveError(err, locale));
      setStep('error');
    }
  }, [locale]);

  // Kick off setup each time the dialog opens; reset state on close.
  useEffect(() => {
    if (open) {
      enrolledRef.current = false;
      setCode('');
      setBackupCodes([]);
      void beginSetup();
    } else {
      setSetup(null);
      setStep('loading');
    }
  }, [open, beginSetup]);

  const handleVerify = async () => {
    setError(null);
    if (!/^\d{6}$/.test(code.trim())) {
      setError(getAuthErrorMessage('VALIDATION_FAILED', { locale }));
      return;
    }
    setVerifying(true);
    try {
      await mfaApi.verifyTotp(code.trim());
      enrolledRef.current = true;
      onEnrolled();
      // Generate backup codes immediately after the first factor is enabled.
      try {
        const result = await mfaApi.generateBackupCodes();
        setBackupCodes(result.codes);
      } catch {
        // If backup-code generation fails the factor is still enabled; the
        // user can regenerate them from the settings panel.
        setBackupCodes([]);
      }
      setStep('backup');
    } catch (err) {
      setError(resolveError(err, locale));
    } finally {
      setVerifying(false);
    }
  };

  const handleCopySecret = async () => {
    if (!setup) return;
    try {
      await navigator.clipboard.writeText(setup.secret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Maxfiy kalit:', setup.secret);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" aria-describedby="totp-setup-desc">
        <DialogHeader>
          <DialogTitle>Authenticator ilovasini ulash</DialogTitle>
          <DialogDescription id="totp-setup-desc">
            Google Authenticator, 1Password yoki shunga oʻxshash ilovada QR
            kodni skanerlang, soʻngra koʻrsatilgan kodni kiriting.
          </DialogDescription>
        </DialogHeader>

        {step === 'loading' && (
          <div className="flex items-center justify-center py-12 text-ink-soft">
            <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
            <span className="sr-only">Yuklanmoqda</span>
          </div>
        )}

        {step === 'error' && (
          <div className="space-y-4">
            <p role="alert" className="rounded-2xl border border-red/30 bg-red-tint p-4 text-sm text-red">
              {error}
            </p>
            <Button type="button" variant="secondary" onClick={beginSetup} fullWidth>
              Qayta urinish
            </Button>
          </div>
        )}

        {step === 'scan' && setup && (
          <div className="space-y-5">
            <div className="flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={setup.qrDataUrl}
                alt="TOTP QR kodi"
                width={192}
                height={192}
                className="rounded-2xl border border-rim bg-white p-3"
              />
            </div>

            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wider text-ink-strong">
                Yoki kalitni qoʻlda kiriting
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 select-all break-all rounded-xl border border-rim bg-tint/40 px-3 py-2 font-mono text-sm text-ink-strong">
                  {setup.secret}
                </code>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  onClick={handleCopySecret}
                  aria-label="Maxfiy kalitni nusxalash"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-green" aria-hidden="true" />
                  ) : (
                    <Copy className="h-4 w-4" aria-hidden="true" />
                  )}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="totp-code"
                className="block text-xs font-bold uppercase tracking-wider text-ink-strong"
              >
                Tasdiqlash kodi
              </label>
              <input
                id="totp-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleVerify();
                  }
                }}
                placeholder="123456"
                className="w-full rounded-2xl border border-rim bg-tint/30 px-4 py-3 text-center font-mono text-lg tracking-[0.4em] text-ink-strong outline-none transition-all focus:border-blue/30 focus:bg-white focus:ring-4 focus:ring-blue/5"
                aria-describedby={error ? 'totp-code-error' : undefined}
              />
              {error && (
                <p id="totp-code-error" role="alert" className="text-xs font-medium text-red">
                  {error}
                </p>
              )}
            </div>

            <Button
              type="button"
              fullWidth
              onClick={handleVerify}
              loading={verifying}
              disabled={code.length !== 6}
              leftIcon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
            >
              Tasdiqlash va yoqish
            </Button>
          </div>
        )}

        {step === 'backup' && (
          <div className="space-y-5">
            <div className="flex items-center gap-2 rounded-2xl border border-green/30 bg-green-tint p-4 text-sm font-medium text-green">
              <ShieldCheck className="h-5 w-5 shrink-0" aria-hidden="true" />
              Ikki bosqichli himoya yoqildi.
            </div>
            {backupCodes.length > 0 ? (
              <BackupCodes
                codes={backupCodes}
                onAcknowledge={() => onOpenChange(false)}
              />
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-ink-soft">
                  Zaxira kodlarini yaratib boʻlmadi. Ularni xavfsizlik
                  boʻlimidan keyinroq yaratishingiz mumkin.
                </p>
                <Button type="button" fullWidth onClick={() => onOpenChange(false)}>
                  Yopish
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function resolveError(err: unknown, locale: string): string {
  if (err instanceof ApiClientError) {
    const code = extractErrorCode(err.details);
    return getAuthErrorMessage(code, { locale, fallback: err.message });
  }
  return getAuthErrorMessage('NETWORK_ERROR', { locale });
}
