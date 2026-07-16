'use client';

import {
  NOTIFICATION_KINDS,
  NOTIFICATION_KIND_LABELS_UZ,
  type NotificationKind,
} from '../../lib/api/notifications';

interface NotificationFiltersProps {
  /** Currently active kind filter, or `null` for "all". */
  activeKind: NotificationKind | null;
  onChangeKind: (kind: NotificationKind | null) => void;
  /** Toggle "unread only" mode. */
  unreadOnly: boolean;
  onToggleUnread: (next: boolean) => void;
}

/**
 * Filter pill bar for the notification center (Task 25.6).
 *
 * Two controls:
 *   1. Kind chips — filter by `NotificationKind` or "Barchasi".
 *   2. Unread-only toggle — flips the `unreadOnly` query parameter.
 */
export function NotificationFilters({
  activeKind,
  onChangeKind,
  unreadOnly,
  onToggleUnread,
}: NotificationFiltersProps) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => onToggleUnread(!unreadOnly)}
          aria-pressed={unreadOnly}
          className={`rounded-2xl px-3 py-1.5 text-xs font-bold transition-colors ${
            unreadOnly
              ? 'bg-accent2-500/15 text-accent2-500'
              : 'border border-white/[0.07] text-cream-dim hover:text-cream'
          }`}
        >
          Faqat o&apos;qilmaganlar
        </button>
      </div>

      <nav
        aria-label="Xabarnomalar bo'yicha filtr"
        className="-mx-1 flex flex-wrap gap-1"
      >
        <FilterChip
          label="Barchasi"
          active={activeKind === null}
          onClick={() => onChangeKind(null)}
        />
        {NOTIFICATION_KINDS.map((kind) => (
          <FilterChip
            key={kind}
            label={NOTIFICATION_KIND_LABELS_UZ[kind]}
            active={activeKind === kind}
            onClick={() => onChangeKind(kind)}
          />
        ))}
      </nav>
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
        active
          ? 'bg-accent2-500/15 text-accent2-500'
          : 'border border-white/[0.07] text-cream-dim hover:text-cream'
      }`}
    >
      {label}
    </button>
  );
}
