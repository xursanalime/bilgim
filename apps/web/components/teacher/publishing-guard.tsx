'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Lock } from 'lucide-react';

import { cn } from '../../lib/utils';
import { usePublishingAllowed } from '../../hooks/use-publishing-allowed';

// ═════════════════════════════════════════════════════════════════
// Publishing guard helpers (Req 8.7).
//
// `usePublishingGuard` resolves whether the current teacher may publish
// plus the localized blocked reason and the link to resolve it. Publish
// buttons call it to disable themselves and render `PublishingBlockedNotice`
// — a compact inline message that links to the subscription settings page.
// ═════════════════════════════════════════════════════════════════

export interface PublishingGuardState {
  allowed: boolean;
  blocked: boolean;
  reason: string | null;
  isLoading: boolean;
  /** Path to the billing/subscription settings page. */
  href: string;
}

export function usePublishingGuard(): PublishingGuardState {
  const params = useParams();
  const rawLocale = params?.locale;
  const locale = Array.isArray(rawLocale) ? rawLocale[0] : rawLocale;
  const { allowed, blocked, reason, isLoading } = usePublishingAllowed();

  return {
    allowed,
    blocked,
    reason,
    isLoading,
    href: `/${locale ?? 'uz'}/settings/subscription`,
  };
}

export interface PublishingBlockedNoticeProps {
  reason: string | null;
  href: string;
  className?: string;
}

/**
 * Inline notice rendered next to a disabled publish action, explaining the
 * subscription restriction and linking to the subscription settings page.
 */
export function PublishingBlockedNotice({
  reason,
  href,
  className,
}: PublishingBlockedNoticeProps) {
  return (
    <p
      role="alert"
      className={cn(
        'flex flex-wrap items-center gap-1.5 text-xs text-ink-soft',
        className,
      )}
    >
      <Lock className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden="true" />
      <span>{reason ?? 'Obuna faol emas. Nashr qilish vaqtincha mavjud emas.'}</span>
      <Link
        href={href}
        className="font-bold text-blue underline-offset-2 hover:underline"
      >
        Obunani boshqarish
      </Link>
    </p>
  );
}
