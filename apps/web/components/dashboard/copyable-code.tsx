'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Link as LinkIcon } from 'lucide-react';

import { cn } from '../../lib/utils';

interface CopyableCodeProps {
  /** The join code itself, e.g. "DBVJTN". */
  code: string;
  label?: string;
}

/**
 * The group join code, click-to-copy.
 *
 * It was previously plain text: the teacher had to select six characters by
 * hand every time they wanted to send it to a student.
 *
 * `navigator.clipboard` needs a secure context, so it is absent over plain
 * HTTP on a LAN address. The `execCommand` path keeps the button working
 * there instead of failing silently.
 */
export function CopyableCode({ code, label = 'Guruh kodi' }: CopyableCodeProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(code);
        ok = true;
      }
    } catch {
      ok = false;
    }

    if (!ok) {
      // Fallback for non-secure origins (http://192.168.x.x during testing).
      const ta = document.createElement('textarea');
      ta.value = code;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      document.body.removeChild(ta);
    }

    if (!ok) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={`${label}ni nusxalash`}
      aria-label={`${label} ${code} — nusxalash`}
      className="group flex items-center gap-2.5 rounded-2xl px-2 py-1 -mx-2 text-left transition-colors hover:bg-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue/40"
    >
      <span
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors',
          copied ? 'bg-teal-tint text-teal' : 'bg-blue/5 text-blue',
        )}
      >
        {copied ? (
          <Check className="h-4.5 w-4.5" />
        ) : (
          <LinkIcon className="h-4.5 w-4.5" />
        )}
      </span>

      <span className="min-w-0">
        <span className="block text-[10px] font-bold uppercase tracking-wider text-ink-faint">
          {label}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-sm font-black uppercase tracking-widest text-ink-strong">
            {code}
          </span>
          {copied ? (
            <span className="text-[10px] font-bold text-teal">
              nusxalandi
            </span>
          ) : (
            <Copy className="h-3 w-3 text-ink-faint opacity-0 transition-opacity group-hover:opacity-100" />
          )}
        </span>
      </span>
    </button>
  );
}
