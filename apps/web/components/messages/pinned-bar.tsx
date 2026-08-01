'use client';

import React from 'react';
import { Pin, X } from 'lucide-react';

interface PinnedBarMessage {
  id: string;
  text: string;
}

/**
 * Sticky bar under the thread header showing the most recently pinned
 * message (+ a count when there's more than one). Shared between
 * `message-thread.tsx` (DM) and `group-chat-thread.tsx` (group) — same
 * shape, same backend contract (`GET .../pinned`, most-recent first).
 *
 * Deliberately shows only the latest pin rather than a full pinned-list
 * panel: jumping to an arbitrary earlier message needs a "scroll to
 * seq" capability the message list doesn't have yet (no virtualized
 * jump-to infra). Renders nothing when there are no pinned messages.
 */
export function PinnedBar({
  pinnedMessages,
  onUnpin,
  canUnpin,
}: {
  pinnedMessages: PinnedBarMessage[];
  onUnpin?: (messageId: string) => void;
  canUnpin: boolean;
}): React.ReactElement | null {
  const latest = pinnedMessages[0];
  if (!latest) return null;

  return (
    <div className="flex items-center gap-3 border-b border-rim bg-blue-tint/30 px-6 py-2.5">
      <Pin className="h-4 w-4 shrink-0 text-blue" />
      <div className="min-w-0 flex-1">
        {pinnedMessages.length > 1 && (
          <p className="text-[9px] font-bold uppercase tracking-wider text-blue/70">
            {pinnedMessages.length} ta xabar qadalgan
          </p>
        )}
        <p className="truncate text-xs font-bold text-ink-strong">
          {latest.text || 'Fayl'}
        </p>
      </div>
      {canUnpin && onUnpin && (
        <button
          type="button"
          onClick={() => onUnpin(latest.id)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-blue/60 transition-colors hover:bg-blue/10 hover:text-blue"
          aria-label="Qadashni bekor qilish"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
