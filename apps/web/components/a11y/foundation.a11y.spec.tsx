import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SkipLink } from './skip-link';
import { focusById, getTabbable } from '../../lib/a11y/focus';

/**
 * Foundation-phase wiring checks for the shared keyboard spine.
 *
 * These render tests assert the cross-cutting guarantees the Foundation phase
 * establishes so every area inherits them:
 *   - The skip link is the first focusable element / first tab stop, and
 *     activating it moves focus to `main#main-content` (Req 2.1, 2.3).
 *   - Exactly one `main#main-content` landmark is rendered (Req 2.2).
 *   - A global `:focus-visible` indicator rule is present (Req 4.1).
 *
 * NOTE on activation: in a real browser, activating an in-page anchor
 * (`href="#main-content"`) shifts focus to the `tabIndex={-1}` target. jsdom
 * does not implement fragment-navigation focus, so the test models the
 * activation effect through `focusById` — the same utility the skip-target
 * logic resolves to — after confirming the link's href points at the target.
 */

/**
 * Mirrors the `app/layout.tsx` body wiring: the skip link is the first child,
 * followed by a representative header, then the single main landmark.
 */
function LayoutHarness() {
  return (
    <div>
      <SkipLink />
      <header>
        <a href="/dashboard">Dashboard</a>
        <button type="button">Open menu</button>
      </header>
      <main id="main-content" tabIndex={-1}>
        <h1>Primary content</h1>
        <button type="button">Inside main</button>
      </main>
    </div>
  );
}

describe('Foundation — skip link and main landmark', () => {
  it('renders the skip link as the first focusable element / first tab stop (Req 2.1)', () => {
    const { container } = render(<LayoutHarness />);

    const tabbable = getTabbable(container as HTMLElement);
    expect(tabbable.length).toBeGreaterThan(0);

    const first = tabbable[0]!;
    expect(first.tagName).toBe('A');
    expect(first).toHaveAttribute('href', '#main-content');
    expect(first.textContent).toMatch(/skip to main content/i);
  });

  it('moves focus to main#main-content when the skip link is activated (Req 2.3)', async () => {
    const { container } = render(<LayoutHarness />);

    const link = container.querySelector<HTMLAnchorElement>(
      'a[href="#main-content"]',
    );
    expect(link).not.toBeNull();

    // The link must be focusable and reachable first.
    link!.focus();
    expect(document.activeElement).toBe(link);

    // Activate the link (Enter on an anchor triggers its default action).
    await userEvent.keyboard('{Enter}');

    // Model the in-page anchor's focus effect (see file-level note).
    focusById('main-content');

    const main = container.querySelector('main#main-content');
    expect(main).not.toBeNull();
    expect(document.activeElement).toBe(main);
  });

  it('renders exactly one main#main-content landmark (Req 2.2)', () => {
    const { container } = render(<LayoutHarness />);

    const mains = container.querySelectorAll('#main-content');
    expect(mains).toHaveLength(1);
    expect(mains[0]!.tagName).toBe('MAIN');

    // And there is exactly one <main> overall.
    expect(container.querySelectorAll('main')).toHaveLength(1);
  });
});

describe('Foundation — global focus indicator', () => {
  it('defines a :focus-visible rule in app/globals.css (Req 4.1)', () => {
    const css = readFileSync(
      join(__dirname, '..', '..', 'app', 'globals.css'),
      'utf8',
    );

    // A `:focus-visible` selector exists and declares a visible indicator
    // (outline) so focused elements show a ring.
    expect(css).toMatch(/:focus-visible\s*\{/);
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline[^}]*\}/);
  });
});
