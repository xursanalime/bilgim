# Accessibility (apps/web)

This document is the manual accessibility audit + screen-reader/keyboard test
matrix for the Bilgim web app, plus the contrast review of the semantic token
palette. It covers Requirements **19.1–19.5**:

| Req  | Topic                                                        |
| ---- | ------------------------------------------------------------ |
| 19.1 | Semantic HTML + correct ARIA (landmarks, roles, names)       |
| 19.2 | Full keyboard operability (focus order, visible focus, traps)|
| 19.3 | AA color contrast in **both** light and dark themes          |
| 19.4 | `prefers-reduced-motion` honored for all non-essential motion|
| 19.5 | Documented manual screen-reader audit + automated checks     |

> Scope note: this pass adds shared, reusable building blocks (a reduced-motion
> hook, a skip-link component, a zero-dependency a11y test helper) and this
> audit. Wiring them into individual page layouts and components is tracked as
> follow-up so as not to collide with in-flight layout/component work.

---

## 1. Semantics & ARIA (Req 19.1)

Checklist for every page/route:

- [ ] Exactly one `<main id="main-content">` landmark per page; secondary
      regions use `<header>`, `<nav>`, `<aside>`, `<footer>` (or matching
      `role`s) so assistive tech can enumerate landmarks.
- [ ] Headings form a logical outline: a single `<h1>` per page, no skipped
      levels (h1 → h2 → h3).
- [ ] Interactive controls are native elements first (`<button>`, `<a href>`,
      `<input>`); custom widgets carry the correct `role` + state attributes.
- [ ] Every control has an accessible name (visible text, `aria-label`, or
      `aria-labelledby`). Icon-only buttons MUST have `aria-label`.
- [ ] Form fields are programmatically associated with a `<label>` (via
      `htmlFor`/`id` or wrapping). Errors use `aria-describedby` and
      `aria-invalid`; the message region is announced (`role="alert"` or
      `aria-live="assertive"`).
- [ ] Decorative imagery uses `alt=""` (or `aria-hidden`); meaningful imagery
      has descriptive `alt`.
- [ ] Status/async updates use `role="status"` / `aria-live="polite"`; urgent
      messages use `role="alert"`. (Existing examples: gamification level-up
      toast, watermark overlay.)
- [ ] Modals/dialogs (Radix `Dialog`) expose `aria-modal`, are labelled by
      their title, trap focus, and restore focus to the trigger on close.

### Skip link

Use `components/a11y/skip-link.tsx`. Mount `<SkipLink />` as the **first**
focusable element inside `<body>` (before the header), and give the primary
content container the matching id and a programmatic focus target:

```tsx
<SkipLink />              {/* first tab stop; href="#main-content" */}
<header>…</header>
<main id="main-content" tabIndex={-1}>…</main>
```

The link is `sr-only` until focused, then becomes a visible control
(`focus:not-sr-only`) pinned top-left.

---

## 2. Keyboard (Req 19.2)

- [ ] Every interactive element is reachable and operable with `Tab` /
      `Shift+Tab` / `Enter` / `Space` (and arrow keys for composite widgets:
      menus, tabs, listboxes).
- [ ] Visible focus indicator on **all** focusable elements (the design system
      provides `focus-visible:ring-*` tokens — do not remove outlines without a
      replacement).
- [ ] Logical focus order follows the visual/reading order; no positive
      `tabindex`.
- [ ] No keyboard traps. Focus can always leave a widget; `Esc` closes
      dialogs/menus/popovers.
- [ ] Focus is **managed** on route/dialog transitions: dialogs trap focus and
      restore it on close; the skip link moves focus into `<main>`.
- [ ] Custom controls built on Radix inherit correct keyboard behavior — verify
      after composition.

---

## 3. Color contrast — AA, light + dark (Req 19.3)

WCAG AA targets: **4.5:1** for normal text, **3:1** for large text (≥ 24px, or
≥ 19px bold) and for UI component / graphical boundaries.

Source of truth: `app/globals.css` (`:root` light, `.dark` dark) mirrored by
`lib/design/tokens.ts` (read-only here). Ratios below are computed against the
default surfaces — **canvas** `#FFFFFF` (light) / `#16161C` (dark).

### Ink (text) hierarchy — PASS where it matters

| Token        | Light hex | On white | Dark hex  | On #16161C | Verdict                          |
| ------------ | --------- | -------- | --------- | ---------- | -------------------------------- |
| `ink-strong` | `#1D1D1F` | ~16.1:1  | `#F5F5F7` | ~15.8:1    | ✅ body & headings                |
| `ink`        | `#333338` | ~12.0:1  | `#E5E5EA` | ~13.0:1    | ✅                                |
| `ink-soft`   | `#6E6E73` | ~5.1:1   | `#AEAEB2` | ~7.0:1     | ✅ smallest allowed body text     |
| `ink-faint`  | `#AEAEB2` | ~2.2:1   | `#6E6E73` | ~2.5:1     | ⚠️ placeholder only (WCAG-exempt) |
| `ink-ghost`  | `#D1D1D6` | ~1.4:1   | `#48484A` | —          | ⚠️ disabled only (WCAG-exempt)    |

Guidance: never use `ink-faint` / `ink-ghost` for meaningful, persistent text.
They are acceptable for placeholder and disabled states only.

### Brand / semantic colors as **text on the light canvas** — several FAIL

| Token (text on #FFFFFF) | Hex       | Ratio  | Normal text (4.5) | Large/UI (3.0) |
| ----------------------- | --------- | ------ | ----------------- | -------------- |
| `blue` (primary/link)   | `#0071E3` | ~4.7:1 | ✅ pass (marginal) | ✅              |
| `purple` (AI)           | `#AF52DE` | ~4.1:1 | ❌ fail            | ✅              |
| `red` (danger)          | `#FF3B30` | ~3.5:1 | ❌ fail            | ✅              |
| `teal` (info)           | `#32ADE6` | ~2.5:1 | ❌ fail            | ❌              |
| `green` (success)       | `#10B981` | ~2.5:1 | ❌ fail            | ❌              |
| `orange` (warn/premium) | `#FF9F0A` | ~2.1:1 | ❌ fail            | ❌              |

Also note: `text-blue` on its own `bg-blue-tint` (`#E6F2FF`) is ≈ **4.1:1** —
just under AA for normal-size text.

**Findings & recommended fixes (tokens.ts / globals.css owned elsewhere — do
not edit here):**

1. `green`, `orange`, `teal` must **not** be used as small text on light
   surfaces. They are fine as **fills** (with white/ink text on top), icon
   glyphs at large sizes, borders, and charts. For colored status *text*, use
   `ink-strong`/`ink` and convey status with an adjacent icon + the tint
   background, or introduce darker `*-strong` text variants
   (e.g. a `green` around `#0E7C5A`, `orange` around `#B25E00`, `teal` around
   `#1A7FB0`) reserved for text.
2. `red` and `purple` as text: restrict to large text / icons / borders, or add
   darker text variants (e.g. `red-text ≈ #D70015`, `purple-text ≈ #8E36C0`)
   for small error/AI copy.
3. `blue` passes for normal text but is marginal; keep link/CTA text at the base
   blue, but avoid placing `text-blue` on `bg-blue-tint` for small text — use a
   darker blue or `ink` on tint instead.
4. Recommendation for the token owners: add explicit `*-on-light` /
   `*-on-dark` *text* shades so "semantic color as text" has an AA-safe value
   distinct from the vivid fill color.

### Dark theme

The dark palette intentionally shifts brand hues to Apple's dark-mode system
colors, which raises contrast against the near-black surfaces:

| Token (text on #16161C) | Dark hex  | Ratio    | Verdict        |
| ----------------------- | --------- | -------- | -------------- |
| `blue` `#0A84FF`        | `#0A84FF` | ~4.9:1   | ✅ normal text  |
| `green` `#30D158`       | `#30D158` | ~9.5:1   | ✅              |
| `teal` `#64D2FF`        | `#64D2FF` | ~10.7:1  | ✅              |
| `red` `#FF453A`         | `#FF453A` | ~4.5:1   | ✅ (verify SR)  |
| `purple` `#BF5AF2`      | `#BF5AF2` | ~5.3:1   | ✅              |
| `orange` `#FF9F0A`      | `#FF9F0A` | ~8.9:1   | ✅              |

Dark mode is in good shape; the **light theme** is where the colored-text
failures concentrate. Re-run the per-component contrast check after any
token change, in both themes.

---

## 4. Reduced motion (Req 19.4)

- [ ] All non-essential animation (transitions, parallax, confetti, sparkles,
      auto-advancing carousels, canvas effects) is disabled or reduced when the
      user prefers reduced motion.
- [ ] `app/globals.css` provides a global `@media (prefers-reduced-motion:
      reduce)` rule that neutralizes default animations; component-level motion
      must additionally gate JS-driven animation.

### Shared hook

Use `lib/use-prefers-reduced-motion.ts` instead of re-implementing the
`matchMedia` subscription:

```ts
import { usePrefersReducedMotion } from '../../lib/use-prefers-reduced-motion';
// or, imperatively (inside effects / canvas setup):
import { prefersReducedMotion } from '../../lib/use-prefers-reduced-motion';
```

It is SSR-safe (returns `false` on the server and first client render to avoid
hydration mismatch), reacts to live preference changes, and includes the legacy
Safari `addListener` fallback.

**Consolidation follow-up (not done this pass to avoid file collisions):** the
matchMedia pattern is currently duplicated in, at least:

- `components/gamification/level-up-toast.tsx`
- `components/gamification/rewards-dashboard.tsx`
- `components/gamification/daily-challenges-widget.tsx`
- `components/media/watermark-overlay.tsx`
- `components/media/protected-surface.tsx`
- `components/ai/bilgim-ai-tutor.tsx`
- `components/landing/cursor-spotlight.tsx`, `light-beam.tsx`, `live-showcase.tsx`
- `components/marketing/effects/particle-field.tsx`, `morphing-shape.tsx`

These should migrate to the shared hook in a dedicated refactor PR.

---

## 5. Automated checks (Req 19.5)

### Current state: zero-dependency helper

`jest-axe` / `axe-core` are **not** dependencies of `apps/web`, and this task
does not add them (adding a dependency is a deliberate team decision). In the
meantime, `lib/test/a11y.ts` provides a reusable, dependency-free baseline that
runs on the existing jsdom + Testing Library setup:

```ts
import { render } from '@testing-library/react';
import { expectNoBasicA11yViolations } from '../lib/test/a11y';

const { container } = render(<MyComponent />);
expectNoBasicA11yViolations(container);
```

Rules covered: missing `img` alt, controls without an accessible name, unlabeled
form fields, duplicate `id`s, positive `tabindex`, and missing `html lang`. This
is high-signal but **not** a substitute for axe or manual SR testing.

### Follow-up: wire axe into CI (requires a dependency decision)

> **FLAGGED — needs team sign-off before installing.**
>
> To get full automated WCAG coverage, add `jest-axe` (+ `@types/jest-axe`) as
> a dev dependency and either:
> 1. extend `lib/test/a11y.ts` to delegate to `axe()` when available, or
> 2. add per-component `expect(await axe(container)).toHaveNoViolations()`
>    smoke tests, and
> 3. run them in `.github/workflows/ci.yml` as part of `pnpm --filter
>    @bilgim/web test`.
>
> Until that decision is made, the dependency-free helper above is the CI gate.

### Manual screen-reader audit matrix (Req 19.5)

Run each critical flow with at least one screen reader per platform. Mark
pass/fail and file issues for any failure.

| Flow                          | NVDA + Firefox (Win) | VoiceOver + Safari (macOS) | TalkBack + Chrome (Android) |
| ----------------------------- | -------------------- | -------------------------- | --------------------------- |
| Landing → sign up             |                      |                            |                             |
| Login (+ MFA / WebAuthn)      |                      |                            |                             |
| Catalog browse & search       |                      |                            |                             |
| Course / lesson detail        |                      |                            |                             |
| Enrollment & checkout/billing |                      |                            |                             |
| Lesson player (video + ctrls) |                      |                            |                             |
| Live room (join, chat)        |                      |                            |                             |
| Homework submit & feedback    |                      |                            |                             |
| Direct messages               |                      |                            |                             |
| Notifications inbox           |                      |                            |                             |
| Dashboard nav / sidebar       |                      |                            |                             |
| Theme + language switch       |                      |                            |                             |

For each flow verify:

- [ ] Skip link is the first stop and moves focus into `<main>`.
- [ ] Landmarks and headings are announced and let you navigate by region.
- [ ] All controls announce a clear name, role, and state.
- [ ] Form errors are announced and focus moves to the first invalid field.
- [ ] Live/status updates are announced without stealing focus.
- [ ] Dialogs trap focus, announce on open, and restore focus on close.
- [ ] Nothing important is conveyed by color alone.
- [ ] The flow is fully completable with the keyboard only.
- [ ] With reduced motion enabled, no flashing/auto-motion remains.

---

## Summary of this pass

**Added (reusable, ready to mount/adopt):**

- `lib/use-prefers-reduced-motion.ts` — shared SSR-safe reduced-motion hook
  (+ `lib/use-prefers-reduced-motion.spec.ts`).
- `components/a11y/skip-link.tsx` — keyboard-focusable, visible-on-focus skip
  link (+ `components/a11y/skip-link.spec.tsx`).
- `lib/test/a11y.ts` — dependency-free baseline a11y assertions for jsdom tests.
- This audit + manual SR matrix.

**Key findings / follow-ups:**

1. **Light-theme colored text fails AA**: `green`, `orange`, `teal` (~2.1–2.5:1)
   and, for normal-size text, `red` (~3.5:1) and `purple` (~4.1:1). Use as
   fills/icons/large text, or add darker text-only shades (token owners).
2. **`jest-axe` is absent** — flagged, not installed. Wiring axe into CI is a
   follow-up needing a dependency decision; the zero-dep helper bridges the gap.
3. **Reduced-motion consolidation**: ~11 components duplicate the matchMedia
   pattern; migrate them to the shared hook in a dedicated PR.
4. **Skip link + `<main id>` wiring** must be done in the layout-owning task.
