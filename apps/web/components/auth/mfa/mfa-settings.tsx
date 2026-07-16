'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Smartphone,
  KeyRound,
  Fingerprint,
  Plus,
  Trash2,
  Loader2,
  ShieldCheck,
  RefreshCw,
  Info,
} from 'lucide-react';

import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../ui/dialog';
import { ApiClientError } from '../../../lib/api-client';
import { extractErrorCode, getAuthErrorMessage } from '../../../lib/auth-errors';
import { mfaApi, type CredentialView } from '../../../lib/mfa-api';
import {
  isWebAuthnSupported,
  startRegistration,
  WebAuthnError,
} from '../../../lib/webauthn';
import { TotpSetupDialog } from './totp-setup-dialog';
import { BackupCodes } from './backup-codes';

interface MfaSettingsProps {
  locale: string;
  /** Current user's role — ADMIN/TEACHER cannot remove their last factor. */
  role: 'STUDENT' | 'TEACHER' | 'ADMIN';
}

function resolveError(err: unknown, locale: string): string {
  if (err instanceof WebAuthnError) {
    if (err.code === 'CANCELLED') {
      return getAuthErrorMessage('WEBAUTHN_VERIFICATION_FAILED', { locale });
    }
    if (err.code === 'INVALID_STATE') {
      return 'Bu qurilma allaqachon ulangan.';
    }
    return getAuthErrorMessage('WEBAUTHN_VERIFICATION_FAILED', { locale });
  }
  if (err instanceof ApiClientError) {
    const code = extractErrorCode(err.details);
    return getAuthErrorMessage(code, { locale, fallback: err.message });
  }
  return getAuthErrorMessage('NETWORK_ERROR', { locale });
}

export function MfaSettings({ locale, role }: MfaSettingsProps) {
  const [credentials, setCredentials] = useState<CredentialView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [totpDialogOpen, setTotpDialogOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [backupDialogOpen, setBackupDialogOpen] = useState(false);
  const [freshBackupCodes, setFreshBackupCodes] = useState<string[]>([]);
  const [addingPasskey, setAddingPasskey] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const webauthnSupported = isWebAuthnSupported();

  const refresh = useCallback(async () => {
    try {
      const rows = await mfaApi.listCredentials();
      setCredentials(rows);
      setLoadError(null);
    } catch (err) {
      setLoadError(resolveError(err, locale));
      setCredentials([]);
    }
  }, [locale]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const totp = credentials?.find((c) => c.type === 'TOTP' && c.verifiedAt);
  const passkeys =
    credentials?.filter((c) => c.type === 'WEBAUTHN' && c.verifiedAt) ?? [];
  const hasAnyFactor = Boolean(totp) || passkeys.length > 0;
  const isLastFactor = (role === 'ADMIN' || role === 'TEACHER') &&
    [...(totp ? [totp] : []), ...passkeys].length <= 1;

  const handleAddPasskey = async () => {
    setActionError(null);
    setAddingPasskey(true);
    try {
      const options = await mfaApi.webauthnRegistrationOptions();
      const response = await startRegistration(options);
      await mfaApi.webauthnRegistrationFinish(response);
      await refresh();
    } catch (err) {
      if (!(err instanceof WebAuthnError && err.code === 'CANCELLED')) {
        setActionError(resolveError(err, locale));
      }
    } finally {
      setAddingPasskey(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setActionError(null);
    setRevokingId(id);
    try {
      await mfaApi.revokeCredential(id);
      await refresh();
    } catch (err) {
      setActionError(resolveError(err, locale));
    } finally {
      setRevokingId(null);
    }
  };

  const handleRegenerateBackupCodes = async () => {
    setActionError(null);
    try {
      const result = await mfaApi.generateBackupCodes();
      setFreshBackupCodes(result.codes);
      setBackupDialogOpen(true);
    } catch (err) {
      setActionError(resolveError(err, locale));
    }
  };

  return (
    <section className="overflow-hidden rounded-[2.5rem] border border-rim bg-white shadow-soft">
      <div className="border-b border-rim bg-tint/30 px-8 py-5">
        <h3 className="flex items-center gap-2 font-display text-base font-extrabold text-ink-strong">
          <ShieldCheck className="h-4.5 w-4.5 text-blue" aria-hidden="true" />
          Ikki bosqichli himoya (MFA)
        </h3>
        <p className="mt-1 text-xs text-ink-faint">
          Hisobingizni qoʻshimcha tasdiqlash bosqichi bilan himoyalang.
        </p>
      </div>

      <div className="space-y-6 p-6 sm:p-8">
        {loadError ? (
          <p role="alert" className="rounded-2xl border border-red/30 bg-red-tint p-4 text-sm text-red">
            {loadError}
          </p>
        ) : null}

        {actionError ? (
          <p role="alert" className="rounded-2xl border border-red/30 bg-red-tint p-4 text-sm text-red">
            {actionError}
          </p>
        ) : null}

        {credentials === null ? (
          <div className="flex items-center justify-center py-10 text-ink-soft">
            <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
            <span className="sr-only">Yuklanmoqda</span>
          </div>
        ) : (
          <>
            {/* TOTP / Authenticator app */}
            <div className="flex flex-col gap-4 rounded-2xl border border-rim p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue/5 text-blue">
                  <Smartphone className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-ink-strong">Authenticator ilovasi</p>
                    {totp ? (
                      <Badge variant="green" size="sm">Yoqilgan</Badge>
                    ) : (
                      <Badge variant="neutral" size="sm">Oʻchirilgan</Badge>
                    )}
                  </div>
                  <p className="text-xs text-ink-soft">
                    Vaqt asosidagi bir martalik kodlar (TOTP).
                  </p>
                </div>
              </div>
              <div className="shrink-0">
                {totp ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setDisableOpen(true)}
                  >
                    Oʻchirish
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setTotpDialogOpen(true)}
                    leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
                  >
                    Ulash
                  </Button>
                )}
              </div>
            </div>

            {/* WebAuthn / Passkeys */}
            <div className="rounded-2xl border border-rim p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple/5 text-purple">
                    <Fingerprint className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-ink-strong">Passkey / xavfsizlik kaliti</p>
                      {passkeys.length > 0 ? (
                        <Badge variant="green" size="sm">{passkeys.length} ta</Badge>
                      ) : null}
                    </div>
                    <p className="text-xs text-ink-soft">
                      Barmoq izi, Face ID yoki FIDO2 qurilmasi (WebAuthn).
                    </p>
                  </div>
                </div>
                <div className="shrink-0">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={handleAddPasskey}
                    loading={addingPasskey}
                    disabled={!webauthnSupported}
                    leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
                  >
                    Passkey qoʻshish
                  </Button>
                </div>
              </div>

              {!webauthnSupported && (
                <p className="mt-3 flex items-start gap-2 rounded-xl bg-tint/50 p-3 text-xs text-ink-soft">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Brauzeringiz passkey (WebAuthn) ni qoʻllab-quvvatlamaydi yoki
                  xavfsiz ulanish (HTTPS) talab qilinadi.
                </p>
              )}

              {passkeys.length > 0 && (
                <ul className="mt-4 space-y-2 border-t border-rim pt-4">
                  {passkeys.map((pk) => (
                    <li
                      key={pk.id}
                      className="flex items-center justify-between gap-3 rounded-xl bg-tint/30 px-4 py-2.5"
                    >
                      <span className="text-sm font-medium text-ink-strong">
                        {pk.label ?? 'Xavfsizlik kaliti'}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRevoke(pk.id)}
                        loading={revokingId === pk.id}
                        aria-label="Passkeyni oʻchirish"
                        className="text-red hover:bg-red/5"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Backup codes */}
            <div className="flex flex-col gap-4 rounded-2xl border border-rim p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange/5 text-orange">
                  <KeyRound className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="space-y-1">
                  <p className="text-sm font-bold text-ink-strong">Zaxira kodlari</p>
                  <p className="text-xs text-ink-soft">
                    Authenticator ilovangizdan ayrilsangiz ishlatiladigan
                    bir martalik kodlar.
                  </p>
                </div>
              </div>
              <div className="shrink-0">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleRegenerateBackupCodes}
                  disabled={!hasAnyFactor}
                  leftIcon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
                >
                  Yangilash
                </Button>
              </div>
            </div>

            {isLastFactor && hasAnyFactor && (
              <p className="flex items-start gap-2 text-xs text-ink-faint">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Rolingiz uchun kamida bitta MFA vositasi talab qilinadi —
                oxirgisini oʻchirib boʻlmaydi.
              </p>
            )}
          </>
        )}
      </div>

      <TotpSetupDialog
        open={totpDialogOpen}
        onOpenChange={setTotpDialogOpen}
        locale={locale}
        onEnrolled={() => void refresh()}
      />

      <DisableTotpDialog
        open={disableOpen}
        onOpenChange={setDisableOpen}
        locale={locale}
        onDisabled={() => void refresh()}
      />

      {/* Regenerated backup codes */}
      <Dialog open={backupDialogOpen} onOpenChange={setBackupDialogOpen}>
        <DialogContent size="md" aria-describedby="backup-regen-desc">
          <DialogHeader>
            <DialogTitle>Yangi zaxira kodlari</DialogTitle>
            <DialogDescription id="backup-regen-desc">
              Eski kodlar bekor qilindi. Yangi kodlarni saqlab qoʻying.
            </DialogDescription>
          </DialogHeader>
          <BackupCodes
            codes={freshBackupCodes}
            onAcknowledge={() => setBackupDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Disable TOTP dialog — requires current password + a fresh code.
// ─────────────────────────────────────────────────────────────────────────

interface DisableTotpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: string;
  onDisabled: () => void;
}

function DisableTotpDialog({
  open,
  onOpenChange,
  locale,
  onDisabled,
}: DisableTotpDialogProps) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setPassword('');
      setCode('');
      setError(null);
    }
  }, [open]);

  const handleSubmit = async () => {
    setError(null);
    if (!password || !/^\d{6}$/.test(code.trim())) {
      setError(getAuthErrorMessage('VALIDATION_FAILED', { locale }));
      return;
    }
    setSubmitting(true);
    try {
      await mfaApi.disableTotp(password, code.trim());
      onDisabled();
      onOpenChange(false);
    } catch (err) {
      setError(resolveError(err, locale));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" aria-describedby="disable-totp-desc">
        <DialogHeader>
          <DialogTitle>Authenticator’ni oʻchirish</DialogTitle>
          <DialogDescription id="disable-totp-desc">
            Tasdiqlash uchun joriy parolingiz va amaldagi kodni kiriting.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="disable-pw" className="block text-xs font-bold uppercase tracking-wider text-ink-strong">
              Joriy parol
            </label>
            <input
              id="disable-pw"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-2xl border border-rim bg-tint/30 px-4 py-3 text-sm font-medium text-ink-strong outline-none transition-all focus:border-blue/30 focus:bg-white focus:ring-4 focus:ring-blue/5"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="disable-code" className="block text-xs font-bold uppercase tracking-wider text-ink-strong">
              Tasdiqlash kodi
            </label>
            <input
              id="disable-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="123456"
              className="w-full rounded-2xl border border-rim bg-tint/30 px-4 py-3 text-center font-mono text-lg tracking-[0.4em] text-ink-strong outline-none transition-all focus:border-blue/30 focus:bg-white focus:ring-4 focus:ring-blue/5"
            />
          </div>
          {error && (
            <p role="alert" className="text-xs font-medium text-red">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Bekor qilish
          </Button>
          <Button type="button" variant="danger" onClick={handleSubmit} loading={submitting}>
            Oʻchirish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
