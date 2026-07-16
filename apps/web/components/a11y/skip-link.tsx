import type { AnchorHTMLAttributes } from 'react';

import { cn } from '../../lib/utils';

// ═════════════════════════════════════════════════════════════════
// SkipLink — a "skip to main content" bypass link (WCAG 2.4.1).
//
// Visually hidden until it receives keyboard focus, at which point it
// becomes a clearly visible, focusable control pinned to the top-left of
// the viewport. This lets keyboard and screen-reader users jump straight
// past repeated navigation/landmarks to the primary content.
//
// Mounting (handled by a layout-owning task, not this one):
//   - Render <SkipLink /> as the FIRST focusable element inside <body>,
//     before the header/nav, so it is the first Tab stop.
//   - Give the primary content container a matching id, e.g.
//       <main id="main-content" tabIndex={-1}>…</main>
//     The `tabIndex={-1}` lets the target receive programmatic focus after
//     the link is activated.
//
// A11y notes:
//   - Uses the global focus-visible ring tokens for a consistent indicator.
//   - The visible-on-focus pattern relies on `sr-only` + `focus:not-sr-only`
//     so the link occupies no layout space until focused.
//
// Requirements 19.1 (semantics), 19.2 (keyboard), 19.3 (AA contrast).
// ═════════════════════════════════════════════════════════════════

export interface SkipLinkProps
  extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  /** The id of the main-content target (without the leading `#`). */
  targetId?: string;
}

export function SkipLink({
  targetId = 'main-content',
  children = 'Skip to main content',
  className,
  ...props
}: SkipLinkProps) {
  return (
    <a
      href={`#${targetId}`}
      className={cn(
        // Hidden until focused — takes no layout space when not focused.
        'sr-only',
        // On focus: a real, visible control pinned top-left above all content.
        'focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100]',
        'focus:flex focus:items-center focus:rounded-lg focus:bg-blue focus:px-4 focus:py-2',
        'focus:text-sm focus:font-semibold focus:text-white focus:shadow-lg',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue focus-visible:ring-offset-2',
        className,
      )}
      {...props}
    >
      {children}
    </a>
  );
}

export default SkipLink;
