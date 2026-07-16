'use client';

import { useState } from 'react';
import { Copy, Check, Download, ShieldAlert } from 'lucide-react';

import { Button } from '../../ui/button';

interface BackupCodesProps {
  codes: string[];
  /** Optional callback fired once the user acknowledges they saved the codes. */
  onAcknowledge?: () => void;
}

/**
 * Renders a freshly-generated batch of backup codes exactly once, with
 * copy-to-clipboard and download-as-text affordances. The codes are
 * single-use recovery codes returned by `POST /mfa/backup-codes/generate`
 * (or after TOTP enrollment) and are never retrievable again.
 */
export function BackupCodes({ codes, onAcknowledge }: BackupCodesProps) {
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const asText = codes.join('\n');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(asText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (permissions/insecure context). Fall back to
      // a manual selection prompt rather than failing silently.
      window.prompt('Kodlarni nusxalang:', asText);
    }
  };

  const handleDownload = () => {
    const blob = new Blob(
      [
        'Bilgim — zaxira kodlari (backup codes)\n',
        'Har bir kod faqat bir marta ishlatiladi. Xavfsiz joyda saqlang.\n\n',
        asText,
        '\n',
      ],
      { type: 'text/plain;charset=utf-8' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bilgim-backup-codes.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <div
        role="alert"
        className="flex items-start gap-3 rounded-2xl border border-orange/30 bg-orange-tint p-4 text-sm text-orange"
      >
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <p>
          Bu kodlar <strong>faqat bir marta</strong> koʻrsatiladi. Har biri
          bir martalik. Telefoningizni yoʻqotsangiz, hisobingizga kirish uchun
          ulardan foydalaning. Xavfsiz joyda saqlang.
        </p>
      </div>

      <ul
        className="grid grid-cols-2 gap-2 rounded-2xl border border-rim bg-tint/40 p-4 font-mono text-sm text-ink-strong"
        aria-label="Zaxira kodlari"
      >
        {codes.map((code) => (
          <li
            key={code}
            className="select-all rounded-lg bg-white px-3 py-2 text-center tracking-wider shadow-soft"
          >
            {code}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={handleCopy}
          leftIcon={
            copied ? (
              <Check className="h-4 w-4 text-green" aria-hidden="true" />
            ) : (
              <Copy className="h-4 w-4" aria-hidden="true" />
            )
          }
        >
          {copied ? 'Nusxalandi' : 'Nusxalash'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={handleDownload}
          leftIcon={<Download className="h-4 w-4" aria-hidden="true" />}
        >
          Yuklab olish
        </Button>
      </div>

      {onAcknowledge && (
        <div className="space-y-3 border-t border-rim pt-4">
          <label className="flex items-center gap-2 text-sm text-ink-soft">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-rim accent-blue"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            Zaxira kodlarini xavfsiz joyga saqladim
          </label>
          <Button
            type="button"
            size="sm"
            disabled={!acknowledged}
            onClick={onAcknowledge}
          >
            Tayyor
          </Button>
        </div>
      )}
    </div>
  );
}
