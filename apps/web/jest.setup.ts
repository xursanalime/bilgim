import '@testing-library/jest-dom';

// ═════════════════════════════════════════════════════════════════
// Optional jest-axe matcher registration (ACCESSIBILITY.md → "Follow-up:
// wire axe into CI"). `jest-axe` is a devDependency, but this file stays
// resilient to a repo state where it hasn't been installed yet (e.g. right
// after this diff lands, before the consolidated `pnpm install` runs) —
// `lib/test/a11y.ts`'s `expectNoA11yViolations` falls back to its
// zero-dependency baseline in that case, so registration failure here is
// silently swallowed rather than failing every test file.
// ═════════════════════════════════════════════════════════════════
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { toHaveNoViolations } = require('jest-axe');
  expect.extend(toHaveNoViolations);
} catch {
  // jest-axe not installed/resolvable — no-op; specs fall back to
  // `expectNoBasicA11yViolations`.
}
