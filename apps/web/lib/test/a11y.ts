// ═════════════════════════════════════════════════════════════════
// Lightweight, dependency-free accessibility assertions for jsdom tests.
//
// WHY THIS EXISTS (and not jest-axe):
//   `jest-axe` / `axe-core` are NOT currently dependencies of apps/web, and
//   adding a dependency is a deliberate decision the team should make (bundle
//   audit, CI cost, version pinning). Until that decision is taken, this
//   helper provides a reusable, zero-dependency baseline of the most common
//   WCAG failures using only the DOM + @testing-library that are already set
//   up. See apps/web/ACCESSIBILITY.md → "Automated checks (follow-up)".
//
//   When the team adopts axe, prefer it for breadth; this helper can remain as
//   a fast structural smoke check or be retired.
//
// USAGE:
//   import { render } from '@testing-library/react';
//   import { findBasicA11yViolations, expectNoBasicA11yViolations } from '../lib/test/a11y';
//
//   const { container } = render(<MyComponent />);
//   expectNoBasicA11yViolations(container);
//   // or, to inspect:
//   const violations = findBasicA11yViolations(container);
// ═════════════════════════════════════════════════════════════════

export interface A11yViolation {
  /** Stable rule id, e.g. "img-alt", "control-name". */
  readonly rule: string;
  /** Human-readable description of the problem. */
  readonly message: string;
  /** Outer HTML of the offending node (truncated) for debugging. */
  readonly html: string;
}

const MAX_HTML = 200;

function snippet(el: Element): string {
  const html = el.outerHTML ?? '';
  return html.length > MAX_HTML ? `${html.slice(0, MAX_HTML)}…` : html;
}

function isHidden(el: Element): boolean {
  if (el.getAttribute('aria-hidden') === 'true') return true;
  if (el.hasAttribute('hidden')) return true;
  return false;
}

/** Best-effort accessible name for an element (subset of the ARIA algorithm). */
function accessibleName(el: Element): string {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const named = labelledBy
      .split(/\s+/)
      .map((id) => el.ownerDocument?.getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim();
    if (named) return named;
  }

  const title = el.getAttribute('title');
  if (title && title.trim()) return title.trim();

  // Text content (covers <button>Save</button>, links, etc.).
  const text = (el.textContent ?? '').trim();
  if (text) return text;

  // An <img alt> inside the control contributes its alt text.
  const img = el.querySelector('img[alt]');
  const alt = img?.getAttribute('alt')?.trim();
  if (alt) return alt;

  return '';
}

/**
 * Scan a rendered container for a baseline set of accessibility violations.
 *
 * Rules checked:
 *  - `img-alt`         — <img> without an `alt` attribute (use alt="" if decorative).
 *  - `control-name`    — <button> / <a href> with no accessible name.
 *  - `input-label`     — form controls with no associated label / aria-label.
 *  - `duplicate-id`    — repeated `id` values (breaks aria-* references).
 *  - `html-lang`       — a rendered <html> element without a `lang`.
 *  - `positive-tabindex` — tabindex > 0, which breaks natural focus order.
 *
 * This is intentionally conservative (high signal, low false-positive). It is
 * NOT a substitute for axe-core or a manual screen-reader audit.
 */
export function findBasicA11yViolations(container: ParentNode): A11yViolation[] {
  const violations: A11yViolation[] = [];

  // img-alt
  container.querySelectorAll('img').forEach((img) => {
    if (isHidden(img)) return;
    if (!img.hasAttribute('alt')) {
      violations.push({
        rule: 'img-alt',
        message: 'Image is missing an `alt` attribute (use alt="" if purely decorative).',
        html: snippet(img),
      });
    }
  });

  // control-name (buttons + anchors that act as links)
  container.querySelectorAll('button, a[href]').forEach((el) => {
    if (isHidden(el)) return;
    if (!accessibleName(el)) {
      violations.push({
        rule: 'control-name',
        message: `<${el.tagName.toLowerCase()}> has no accessible name (add text, aria-label, or aria-labelledby).`,
        html: snippet(el),
      });
    }
  });

  // input-label
  const labelableSelector = 'input:not([type="hidden"]), select, textarea';
  container.querySelectorAll(labelableSelector).forEach((el) => {
    if (isHidden(el)) return;
    const id = el.getAttribute('id');
    const hasExplicitLabel = id
      ? Boolean(el.ownerDocument?.querySelector(`label[for="${CSS.escape(id)}"]`))
      : false;
    const wrappedInLabel = Boolean(el.closest('label'));
    const hasAriaName = Boolean(
      el.getAttribute('aria-label')?.trim() || el.getAttribute('aria-labelledby')?.trim(),
    );
    const hasTitle = Boolean(el.getAttribute('title')?.trim());
    if (!hasExplicitLabel && !wrappedInLabel && !hasAriaName && !hasTitle) {
      violations.push({
        rule: 'input-label',
        message: `Form control <${el.tagName.toLowerCase()}> has no associated label.`,
        html: snippet(el),
      });
    }
  });

  // duplicate-id
  const seen = new Map<string, number>();
  container.querySelectorAll('[id]').forEach((el) => {
    const id = el.getAttribute('id');
    if (!id) return;
    seen.set(id, (seen.get(id) ?? 0) + 1);
  });
  seen.forEach((count, id) => {
    if (count > 1) {
      violations.push({
        rule: 'duplicate-id',
        message: `Duplicate id "${id}" used ${count} times (breaks aria-* / label references).`,
        html: `#${id}`,
      });
    }
  });

  // positive-tabindex
  container.querySelectorAll('[tabindex]').forEach((el) => {
    const raw = el.getAttribute('tabindex');
    const value = raw == null ? NaN : Number(raw);
    if (Number.isFinite(value) && value > 0) {
      violations.push({
        rule: 'positive-tabindex',
        message: `tabindex="${raw}" overrides the natural focus order; use 0 or -1 instead.`,
        html: snippet(el),
      });
    }
  });

  // html-lang (only when an <html> element is present in the tree)
  container.querySelectorAll('html').forEach((html) => {
    if (!html.getAttribute('lang')?.trim()) {
      violations.push({
        rule: 'html-lang',
        message: '<html> element is missing a `lang` attribute.',
        html: snippet(html),
      });
    }
  });

  return violations;
}

function format(violations: A11yViolation[]): string {
  return violations
    .map((v, i) => `  ${i + 1}. [${v.rule}] ${v.message}\n     ${v.html}`)
    .join('\n');
}

/**
 * Assert that a rendered container has no baseline accessibility violations.
 * Throws with a readable report listing each violation when any are found.
 */
export function expectNoBasicA11yViolations(container: ParentNode): void {
  const violations = findBasicA11yViolations(container);
  if (violations.length > 0) {
    throw new Error(
      `Found ${violations.length} accessibility violation(s):\n${format(violations)}`,
    );
  }
}

// ═════════════════════════════════════════════════════════════════
// Optional real-axe delegation (ACCESSIBILITY.md → "Follow-up: wire axe
// into CI").
//
// `jest-axe` is now an (optional-at-runtime) devDependency. Rather than a
// rip-and-replace of every call site, `expectNoA11yViolations` below tries
// to resolve `jest-axe` at call time and delegates to real `axe-core` for
// full WCAG rule coverage when it's installed. If it isn't resolvable
// (e.g. a checkout before the dependency was installed, or a stripped-down
// CI cache), it transparently falls back to the dependency-free
// `expectNoBasicA11yViolations` baseline above — so this helper always
// works, in either repo state, without call sites needing to know which
// path ran.
//
// `jest.setup.ts` registers jest-axe's `toHaveNoViolations` matcher the
// same way (best-effort, swallowing the "module not found" case) so
// `expect(results).toHaveNoViolations()` is available whenever this runs.
// ═════════════════════════════════════════════════════════════════

/** Minimal shape of the bits of `jest-axe` this helper depends on. */
interface JestAxeModule {
  axe: (container: Element | ParentNode) => Promise<{ violations: unknown[] }>;
}

function loadJestAxe(): JestAxeModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('jest-axe') as JestAxeModule;
  } catch {
    // Not installed / not resolvable — caller falls back to the basic check.
    return null;
  }
}

/**
 * Assert no accessibility violations in `container`, preferring real
 * `axe-core` (via `jest-axe`) when available and falling back to
 * {@link expectNoBasicA11yViolations} otherwise.
 *
 * @example
 * const { container } = render(<MyComponent />);
 * await expectNoA11yViolations(container);
 */
export async function expectNoA11yViolations(container: ParentNode): Promise<void> {
  const jestAxe = loadJestAxe();
  if (!jestAxe) {
    expectNoBasicA11yViolations(container);
    return;
  }

  const results = await jestAxe.axe(container as Element);
  // `toHaveNoViolations` is registered globally by jest.setup.ts whenever
  // jest-axe is resolvable, so it mirrors the same availability check here.
  // Cast is needed because the matcher's type comes from `jest-axe`'s own
  // ambient types, which augment `expect` only when the package is present.
  (expect(results) as unknown as { toHaveNoViolations(): void }).toHaveNoViolations();
}
