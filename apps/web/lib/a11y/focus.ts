// ═════════════════════════════════════════════════════════════════
// Focus utilities — dependency-free DOM helpers for keyboard a11y.
//
// `focusById`  — moves programmatic focus to an element by id (skip-link
//                target + focus-trap edges). No-op (dev-only warning) when the
//                target is missing.
// `getTabbable` — ordered list of the tabbable elements within a container
//                (visible, not disabled, `tabindex !== -1`), in DOM order.
//                Backs both the skip-target logic and the focus trap.
//
// These are additive and have no runtime dependencies. See the
// web-accessibility design doc (Requirements 2.3, 5.1).
// ═════════════════════════════════════════════════════════════════

/**
 * Move programmatic focus to the element with the given `id`.
 *
 * - No-op (dev-only `console.warn`) when no element with that id exists.
 * - Ensures the target can receive programmatic focus: if it is not natively
 *   focusable and has no `tabindex`, a `tabindex="-1"` is applied first (the
 *   skip-link target already declares `tabIndex={-1}`, so this is a safety net).
 */
export function focusById(id: string): void {
  if (typeof document === 'undefined') return;

  const target = document.getElementById(id);
  if (!target) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn(`focusById: no element found with id "${id}".`);
    }
    return;
  }

  // Make sure the element is focusable before focusing it.
  if (!target.hasAttribute('tabindex') && !isNativelyFocusable(target)) {
    target.setAttribute('tabindex', '-1');
  }

  target.focus();
}

/**
 * Return the tabbable elements within `container`, in DOM order.
 *
 * An element is tabbable when it is an interactive element (or otherwise
 * focusable) AND it is:
 *  - visible (not `display:none`, not `hidden`, not `aria-hidden="true"`),
 *  - not disabled,
 *  - not opted out of the tab sequence via `tabindex="-1"`.
 */
export function getTabbable(container: HTMLElement): HTMLElement[] {
  const candidates = Array.from(
    container.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR),
  );

  return candidates.filter((el) => {
    // Explicitly removed from the tab order.
    if (el.tabIndex < 0) return false;
    if (isDisabled(el)) return false;
    if (!isVisible(el)) return false;
    return true;
  });
}

// ── Internal helpers ──────────────────────────────────────────────

/**
 * Selector for elements that participate in the tab order: natively
 * interactive elements plus anything carrying an explicit `tabindex`.
 * Elements with `tabindex="-1"` are matched here but filtered out by
 * `getTabbable` so the visibility/disabled checks still apply consistently.
 */
const TABBABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button',
  'input',
  'select',
  'textarea',
  'iframe',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]',
].join(',');

const NATIVELY_FOCUSABLE = new Set([
  'a',
  'area',
  'button',
  'input',
  'select',
  'textarea',
  'iframe',
]);

function isNativelyFocusable(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === 'a' || tag === 'area') return el.hasAttribute('href');
  return NATIVELY_FOCUSABLE.has(tag);
}

function isDisabled(el: HTMLElement): boolean {
  if ((el as HTMLElement & { disabled?: boolean }).disabled === true) return true;
  if (el.getAttribute('aria-disabled') === 'true') return true;
  // A control inside a disabled <fieldset> is also disabled.
  const fieldset = el.closest('fieldset[disabled]');
  if (fieldset) {
    const legend = fieldset.querySelector('legend');
    // Controls in the first <legend> remain enabled per the HTML spec.
    if (!legend || !legend.contains(el)) return true;
  }
  return false;
}

function isVisible(el: HTMLElement): boolean {
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (!(node instanceof HTMLElement)) break;
    if (node.hasAttribute('hidden')) return false;
    if (node.getAttribute('aria-hidden') === 'true') return false;

    const style = getComputedStyle(node);
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden' || style.visibility === 'collapse') {
      return false;
    }
  }
  return true;
}
