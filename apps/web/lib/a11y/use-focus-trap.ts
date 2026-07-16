'use client';

import { useEffect } from 'react';
import { getTabbable } from './focus';

// ═════════════════════════════════════════════════════════════════
// useFocusTrap — focus management for CUSTOM (non-Radix) overlays only.
//
// IMPORTANT: Radix Dialog/Popover/Menu primitives already provide a focus
// trap, `Esc`-to-close, and focus restore on close out of the box. Prefer
// those primitives. Reach for this hook ONLY when building a custom overlay
// that is not based on Radix.
//
// Behavior (Requirements 7.1, 7.2, 7.3):
//   - While `active`, traps Tab/Shift+Tab focus within `ref.current`: Tab from
//     the last tabbable element wraps to the first; Shift+Tab from the first
//     wraps to the last (Req 7.1).
//   - Pressing `Esc` while active calls `opts.onClose?.()` (Req 7.2).
//   - On activation, stores the previously focused element and moves focus into
//     the container (first tabbable, else the container itself). On
//     deactivation/unmount, restores focus to the previously focused element
//     (Req 7.3).
// ═════════════════════════════════════════════════════════════════

interface FocusTrapOptions {
  /** Whether the trap is active (overlay is open). */
  readonly active: boolean;
  /** Called when `Esc` is pressed while the trap is active. */
  readonly onClose?: () => void;
}

/**
 * Trap keyboard focus within `ref` while `active`; `Esc` calls `onClose`;
 * restores focus to the previously-focused element when deactivated.
 *
 * For custom (non-Radix) overlays only — Radix primitives already handle this.
 */
export function useFocusTrap(
  ref: React.RefObject<HTMLElement>,
  opts: FocusTrapOptions,
): void {
  const { active, onClose } = opts;

  useEffect(() => {
    if (!active) {
      return;
    }

    const container = ref.current;
    if (container === null) {
      return;
    }

    // Remember where focus was so we can restore it on deactivation.
    const previouslyFocused =
      typeof document !== 'undefined'
        ? (document.activeElement as HTMLElement | null)
        : null;

    // Move focus into the overlay: first tabbable element, else the container
    // itself (consumers give a tabbable-less container `tabIndex={-1}`).
    const initial = getTabbable(container);
    if (initial.length > 0) {
      initial[0]?.focus();
    } else {
      container.focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose?.();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const tabbable = getTabbable(container);
      if (tabbable.length === 0) {
        // Nothing tabbable: keep focus pinned on the container.
        event.preventDefault();
        container.focus();
        return;
      }

      const first = tabbable[0];
      const last = tabbable[tabbable.length - 1];
      const activeEl =
        typeof document !== 'undefined'
          ? (document.activeElement as HTMLElement | null)
          : null;

      if (event.shiftKey) {
        // Shift+Tab from the first element wraps to the last.
        if (activeEl === first || !container.contains(activeEl)) {
          event.preventDefault();
          last?.focus();
        }
      } else {
        // Tab from the last element wraps to the first.
        if (activeEl === last || !container.contains(activeEl)) {
          event.preventDefault();
          first?.focus();
        }
      }
    };

    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      // Restore focus to wherever it was before the overlay opened.
      previouslyFocused?.focus();
    };
  }, [active, ref, onClose]);
}

export default useFocusTrap;
