'use client';

import type { HTMLAttributes } from 'react';

import { Badge } from '../ui/badge';
import { cn } from '../../lib/utils';

// ═════════════════════════════════════════════════════════════════
// ProtectedContentNotice — learner-facing "protected & traceable" notice
// (Requirements 1.6, 4.4).
//
// A small, calm signal shown near Protected_Content. It is HONEST by design:
// it tells the Learner the content is protected and that their session is
// watermarked and traceable (a deterrent grounded in truth), and it NEVER
// claims that screen capture is impossible or "100%" prevented. The recorded
// honest limitation (web capture cannot be fully prevented) means this copy
// leans on traceability/accountability, not absolute prevention.
//
// Two presentations:
//   - `variant="badge"`  → a compact pill for dense placements (e.g. next to a
//                          video title).
//   - `variant="banner"` → a calm one-line banner with a short explanation,
//                          suitable above/below a player.
//
// Accessibility: rendered as a `role="note"` region with an accessible label so
// assistive tech announces the protection status once; the decorative shield
// icon is `aria-hidden`. No motion, so nothing to gate behind reduced-motion.
// ═════════════════════════════════════════════════════════════════

// Uzbek (platform primary locale) copy — kept honest: protected + traceable,
// never "impossible to capture".
const TITLE_UZ = 'Himoyalangan kontent';
const BANNER_BODY_UZ =
  'Bu dars himoyalangan. Sessiyangiz shaxsiy suvli belgi bilan belgilangan, ' +
  "shuning uchun har qanday yozib olingan nusxa aniq foydalanuvchigacha kuzatiladi.";
const ARIA_LABEL_UZ =
  'Himoyalangan kontent — sessiyangiz suvli belgi bilan belgilangan va kuzatiladi.';

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 3 4 6v6c0 4.5 3.2 7.6 8 9 4.8-1.4 8-4.5 8-9V6l-8-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export interface ProtectedContentNoticeProps extends HTMLAttributes<HTMLDivElement> {
  /** Presentation: a compact pill or a one-line banner. Defaults to `banner`. */
  variant?: 'badge' | 'banner';
}

export function ProtectedContentNotice({
  variant = 'banner',
  className,
  ...props
}: ProtectedContentNoticeProps) {
  if (variant === 'badge') {
    return (
      <Badge
        variant="blue"
        size="md"
        role="note"
        aria-label={ARIA_LABEL_UZ}
        className={cn('max-w-full', className)}
        {...(props as HTMLAttributes<HTMLSpanElement>)}
      >
        <ShieldIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{TITLE_UZ}</span>
      </Badge>
    );
  }

  return (
    <div
      role="note"
      aria-label={ARIA_LABEL_UZ}
      className={cn(
        'flex items-start gap-3 rounded-2xl border border-rim bg-blue-tint/40 px-4 py-3',
        className,
      )}
      {...props}
    >
      <span
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-tint text-blue"
        aria-hidden="true"
      >
        <ShieldIcon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink-strong">{TITLE_UZ}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">{BANNER_BODY_UZ}</p>
      </div>
    </div>
  );
}

export default ProtectedContentNotice;
