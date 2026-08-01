'use client';

import React, { useState } from 'react';
import { SmilePlus } from 'lucide-react';

import { cn } from '../../lib/utils';

/** Quick-pick row shown by the reaction picker — mirrors Telegram's default set. */
export const QUICK_REACTIONS = ['👍', '❤️', '🔥', '😁', '😮', '😢', '🙏'];

export interface MessageReactionSummary {
  emoji: string;
  count: number;
  reactedByMe: boolean;
}

/**
 * Reaction pills + "add reaction" trigger for a message bubble. Shared
 * between `message-thread.tsx` (DM) and `group-chat-thread.tsx` (group)
 * since both render identical reaction UI against the same backend
 * shape (`MessageReactionSummary`, `PUT .../reactions` toggle).
 *
 * Must be rendered inside an ancestor with the `group` Tailwind class —
 * the "+" trigger only reveals on `group-hover` so it doesn't clutter
 * every bubble at rest, matching the existing hover-only edit/delete
 * icons in the same row.
 */
export function MessageReactions({
  reactions,
  onToggle,
  align,
}: {
  reactions: MessageReactionSummary[];
  onToggle: (emoji: string) => void;
  /** Which side the picker popover opens toward — should match the bubble's own alignment (isMine). */
  align: 'left' | 'right';
}): React.ReactElement {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-1 px-1',
        align === 'right' ? 'justify-end' : 'justify-start',
      )}
    >
      {reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          onClick={() => onToggle(r.emoji)}
          className={cn(
            'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold transition-all active:scale-95',
            r.reactedByMe
              ? 'border-blue/30 bg-blue/10 text-blue'
              : 'border-rim bg-white text-ink-faint hover:border-blue/20 hover:text-blue',
          )}
        >
          <span>{r.emoji}</span>
          <span>{r.count}</span>
        </button>
      ))}

      <div className="relative">
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-full text-ink-faint transition-all hover:bg-tint hover:text-blue',
            reactions.length === 0 && 'opacity-0 group-hover:opacity-100',
          )}
          aria-label="Reaksiya qo'shish"
        >
          <SmilePlus className="h-3.5 w-3.5" />
        </button>

        {pickerOpen && (
          <>
            {/* Click-outside overlay to close the picker. */}
            <div
              className="fixed inset-0 z-30"
              onClick={() => setPickerOpen(false)}
            />
            <div
              className={cn(
                'absolute bottom-8 z-40 flex items-center gap-1 rounded-2xl border border-rim bg-white p-1.5 shadow-xl',
                align === 'right' ? 'right-0' : 'left-0',
              )}
            >
              {QUICK_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    onToggle(emoji);
                    setPickerOpen(false);
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-xl text-lg transition-transform hover:scale-125 active:scale-95"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
