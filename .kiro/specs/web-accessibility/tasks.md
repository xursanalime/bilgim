# Implementation Plan: Web Accessibility (Keyboard-Only Operability)

## Overview

Make `apps/web` fully operable with the keyboard alone, delivered in small,
independently-mergeable phases. A single **Foundation phase** wires the shared
keyboard spine (skip link, `main` landmark, focus style, focus utilities, test
gate), then one lean **Area phase** per component folder in the design's order.
Each Area phase is roughly two sub-tasks: make the area keyboard-operable, then
add its `*.a11y.spec.tsx` and confirm build/typecheck/test are green.

All code is TypeScript (Next.js 14 App Router, React 18, Testing Library/jsdom,
`fast-check` for the one property test). Tests run via
`pnpm --filter @bilgim/web test`.

## Tasks

- [x] 1. Foundation — shared keyboard spine
  - [x] 1.1 Mount the skip link as the first `<body>` child
    - Render `<SkipLink />` from `components/a11y/skip-link.tsx` as the first
      focusable element inside `<body>` in `app/layout.tsx`, before any header
    - _Requirements: 2.1, 2.4_

  - [x] 1.2 Establish the single `<main>` landmark in the layout shell
    - Add exactly one `<main id="main-content" tabIndex={-1}>` in the shared
      layout shell so the skip link has a focus target; ensure nested layouts do
      not add a second `<main>`
    - _Requirements: 2.2, 2.3_

  - [x] 1.3 Add a global visible focus indicator
    - Add a `:focus-visible` outline/ring rule to `app/globals.css` using the
      existing ring tokens
    - _Requirements: 4.1_

  - [x] 1.4 Add focus utilities `lib/a11y/focus.ts`
    - Implement `focusById(id)` (no-op if target missing) and `getTabbable(container)`
      returning visible, non-disabled, `tabindex !== -1` elements in DOM order
    - _Requirements: 2.3, 5.1_

  - [x] 1.5 Add `lib/a11y/use-focus-trap.ts` (custom-overlay-only hook)
    - Implement `useFocusTrap(ref, { active, onClose })`: trap `Tab`/`Shift+Tab`
      at the edges via `getTabbable`, close on `Esc`, restore focus on
      deactivate; used only for non-Radix overlays
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 1.6 Confirm the test gate and add Foundation example tests
    - Ensure `lib/test/a11y.ts` checks run under `pnpm --filter @bilgim/web test`
      in CI; add render tests asserting the skip link is the first focusable
      element, activating it focuses `main#main-content`, exactly one
      `main#main-content` is rendered, and a `:focus-visible` rule is present
    - _Requirements: 2.1, 2.2, 2.3, 4.1, 8.3_

  - [ ]* 1.7 Write property test for the positive-tabindex detector
    - **Property 1: Positive-tabindex detection is sound and complete**
    - Use `fast-check` (≥100 iterations) in `lib/test/a11y.property.spec.ts`,
      generating DOM with/without positive `tabindex`
    - **Validates: Requirements 5.2, 8.2**

- [x] 2. Checkpoint — Foundation
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Area: `ui/` primitives
  - [x] 3.1 Make `ui/` keyboard-operable
    - Ensure `Tab`/`Shift+Tab` reach, `Enter`/`Space` operate, visible focus, no
      positive `tabindex`/no traps, arrow keys for composite widgets, overlays
      trap+`Esc`+restore (prefer Radix's built-in behavior)
    - _Requirements: 3.1, 3.2, 4.1, 5.1, 5.2, 5.3, 6.1, 7.1, 7.2, 7.3, 1.3, 1.4_

  - [ ]* 3.2 Add `ui/` a11y test and confirm green
    - Add `*.a11y.spec.tsx` running `expectNoBasicA11yViolations`, plus a focused
      keyboard example for composite widgets/overlays; ensure build/typecheck/test green
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 4. Area: `states/`
  - [x] 4.1 Make `states/` keyboard-operable
    - Keyboard reach/operate, visible focus, sensible focus order, no positive
      `tabindex`/no traps (prefer Radix where applicable)
    - _Requirements: 3.1, 3.2, 4.1, 5.1, 5.2, 5.3, 1.3, 1.4_

  - [ ]* 4.2 Add `states/` a11y test and confirm green
    - Add `*.a11y.spec.tsx` running `expectNoBasicA11yViolations`; ensure
      build/typecheck/test green
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 5. Area: `auth/`
  - [x] 5.1 Make `auth/` keyboard-operable
    - Forms + overlays: keyboard reach/operate, visible focus, no positive
      `tabindex`/no traps, overlays trap+`Esc`+restore (prefer Radix)
    - _Requirements: 3.1, 3.2, 4.1, 5.1, 5.2, 5.3, 6.1, 7.1, 7.2, 7.3, 1.3, 1.4_

  - [ ]* 5.2 Add `auth/` a11y test and confirm green
    - Add `*.a11y.spec.tsx` running `expectNoBasicA11yViolations`, plus a focused
      keyboard example for overlays; ensure build/typecheck/test green
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 6. Area: `dashboard/`
  - [x] 6.1 Make `dashboard/` keyboard-operable
    - Nav/sidebar: keyboard reach/operate, visible focus, no positive
      `tabindex`/no traps, arrow keys for composite nav, overlays trap+`Esc`+restore
      (prefer Radix)
    - _Requirements: 3.1, 3.2, 4.1, 5.1, 5.2, 5.3, 6.1, 7.1, 7.2, 7.3, 1.3, 1.4_

  - [ ]* 6.2 Add `dashboard/` a11y test and confirm green
    - Add `*.a11y.spec.tsx` running `expectNoBasicA11yViolations`, plus a focused
      keyboard example for composite nav/overlays; ensure build/typecheck/test green
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 7. Area: `discovery/`
  - [x] 7.1 Make `discovery/` keyboard-operable
    - Catalog browse & search: keyboard reach/operate, visible focus, no positive
      `tabindex`/no traps, arrow keys for composite widgets, overlays
      trap+`Esc`+restore (prefer Radix)
    - _Requirements: 3.1, 3.2, 4.1, 5.1, 5.2, 5.3, 6.1, 7.1, 7.2, 7.3, 1.3, 1.4_

  - [ ]* 7.2 Add `discovery/` a11y test and confirm green
    - Add `*.a11y.spec.tsx` running `expectNoBasicA11yViolations`, plus a focused
      keyboard example where overlays/composite widgets exist; ensure build/typecheck/test green
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 8. Area: `lesson/`
  - [x] 8.1 Make `lesson/` keyboard-operable
    - Lesson detail + player controls: keyboard reach/operate, visible focus, no
      positive `tabindex`/no traps, arrow keys for composite widgets, overlays
      trap+`Esc`+restore (prefer Radix)
    - _Requirements: 3.1, 3.2, 4.1, 5.1, 5.2, 5.3, 6.1, 7.1, 7.2, 7.3, 1.3, 1.4_

  - [ ]* 8.2 Add `lesson/` a11y test and confirm green
    - Add `*.a11y.spec.tsx` running `expectNoBasicA11yViolations`, plus a focused
      keyboard example for player controls/overlays; ensure build/typecheck/test green
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 9. Area: `live/`
  - [x] 9.1 Make `live/` keyboard-operable
    - Live join + top bar + chat: keyboard reach/operate, visible focus, no
      positive `tabindex`/no traps, arrow keys for composite widgets, overlays
      trap+`Esc`+restore (prefer Radix)
    - _Requirements: 3.1, 3.2, 4.1, 5.1, 5.2, 5.3, 6.1, 7.1, 7.2, 7.3, 1.3, 1.4_

  - [ ]* 9.2 Add `live/` a11y test and confirm green
    - Add `*.a11y.spec.tsx` running `expectNoBasicA11yViolations`, plus a focused
      keyboard example for chat/overlays; ensure build/typecheck/test green
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 10. Area: `live-room/`
  - [x] 10.1 Make `live-room/` keyboard-operable
    - Live viewer, whiteboard, controls: keyboard reach/operate, visible focus, no
      positive `tabindex`/no traps, arrow keys for composite widgets, overlays
      trap+`Esc`+restore (prefer Radix)
    - _Requirements: 3.1, 3.2, 4.1, 5.1, 5.2, 5.3, 6.1, 7.1, 7.2, 7.3, 1.3, 1.4_

  - [ ]* 10.2 Add `live-room/` a11y test and confirm green
    - Add `*.a11y.spec.tsx` running `expectNoBasicA11yViolations`, plus a focused
      keyboard example for controls/overlays; ensure build/typecheck/test green
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 11. Area: `homework/`
  - [x] 11.1 Make `homework/` keyboard-operable
    - Submit & feedback forms: keyboard reach/operate, visible focus, no positive
      `tabindex`/no traps, overlays trap+`Esc`+restore (prefer Radix)
    - _Requirements: 3.1, 3.2, 4.1, 5.1, 5.2, 5.3, 6.1, 7.1, 7.2, 7.3, 1.3, 1.4_

  - [ ]* 11.2 Add `homework/` a11y test and confirm green
    - Add `*.a11y.spec.tsx` running `expectNoBasicA11yViolations`, plus a focused
      keyboard example where overlays exist; ensure build/typecheck/test green
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 12. Area: `billing/`
  - [x] 12.1 Make `billing/` keyboard-operable
    - Checkout/enrollment forms: keyboard reach/operate, visible focus, no positive
      `tabindex`/no traps, overlays trap+`Esc`+restore (prefer Radix)
    - _Requirements: 3.1, 3.2, 4.1, 5.1, 5.2, 5.3, 6.1, 7.1, 7.2, 7.3, 1.3, 1.4_

  - [ ]* 12.2 Add `billing/` a11y test and confirm green
    - Add `*.a11y.spec.tsx` running `expectNoBasicA11yViolations`, plus a focused
      keyboard example where overlays exist; ensure build/typecheck/test green
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 13. Area: `messages/`
  - [x] 13.1 Make `messages/` keyboard-operable
    - Direct messages: keyboard reach/operate, visible focus, no positive
      `tabindex`/no traps, arrow keys for composite widgets, overlays
      trap+`Esc`+restore (prefer Radix)
    - _Requirements: 3.1, 3.2, 4.1, 5.1, 5.2, 5.3, 6.1, 7.1, 7.2, 7.3, 1.3, 1.4_

  - [ ]* 13.2 Add `messages/` a11y test and confirm green
    - Add `*.a11y.spec.tsx` running `expectNoBasicA11yViolations`, plus a focused
      keyboard example where overlays/composite widgets exist; ensure build/typecheck/test green
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 14. Area: `notifications/`
  - [x] 14.1 Make `notifications/` keyboard-operable
    - Inbox: keyboard reach/operate, visible focus, no positive `tabindex`/no
      traps, arrow keys for composite widgets, overlays trap+`Esc`+restore (prefer Radix)
    - _Requirements: 3.1, 3.2, 4.1, 5.1, 5.2, 5.3, 6.1, 7.1, 7.2, 7.3, 1.3, 1.4_

  - [ ]* 14.2 Add `notifications/` a11y test and confirm green
    - Add `*.a11y.spec.tsx` running `expectNoBasicA11yViolations`, plus a focused
      keyboard example where overlays/composite widgets exist; ensure build/typecheck/test green
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 15. Area: `gamification/`
  - [x] 15.1 Make `gamification/` keyboard-operable
    - Points/achievements: keyboard reach/operate, visible focus, no positive
      `tabindex`/no traps, overlays trap+`Esc`+restore (prefer Radix)
    - _Requirements: 3.1, 3.2, 4.1, 5.1, 5.2, 5.3, 6.1, 7.1, 7.2, 7.3, 1.3, 1.4_

  - [ ]* 15.2 Add `gamification/` a11y test and confirm green
    - Add `*.a11y.spec.tsx` running `expectNoBasicA11yViolations`; ensure
      build/typecheck/test green
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 16. Area: `ai/`
  - [x] 16.1 Make `ai/` keyboard-operable
    - AI tutor controls: keyboard reach/operate, visible focus, no positive
      `tabindex`/no traps, arrow keys for composite widgets, overlays
      trap+`Esc`+restore (prefer Radix)
    - _Requirements: 3.1, 3.2, 4.1, 5.1, 5.2, 5.3, 6.1, 7.1, 7.2, 7.3, 1.3, 1.4_

  - [ ]* 16.2 Add `ai/` a11y test and confirm green
    - Add `*.a11y.spec.tsx` running `expectNoBasicA11yViolations`, plus a focused
      keyboard example where overlays/composite widgets exist; ensure build/typecheck/test green
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 17. Area: `settings/`
  - [x] 17.1 Make `settings/` keyboard-operable
    - Theme + language switch, forms: keyboard reach/operate, visible focus, no
      positive `tabindex`/no traps, arrow keys for composite widgets, overlays
      trap+`Esc`+restore (prefer Radix)
    - _Requirements: 3.1, 3.2, 4.1, 5.1, 5.2, 5.3, 6.1, 7.1, 7.2, 7.3, 1.3, 1.4_

  - [ ]* 17.2 Add `settings/` a11y test and confirm green
    - Add `*.a11y.spec.tsx` running `expectNoBasicA11yViolations`, plus a focused
      keyboard example for switches/overlays; ensure build/typecheck/test green
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 18. Area: `landing/`
  - [x] 18.1 Make `landing/` keyboard-operable
    - Public entry: keyboard reach/operate, visible focus, sensible focus order,
      no positive `tabindex`/no traps (prefer Radix where applicable)
    - _Requirements: 3.1, 3.2, 4.1, 5.1, 5.2, 5.3, 1.3, 1.4_

  - [ ]* 18.2 Add `landing/` a11y test and confirm green
    - Add `*.a11y.spec.tsx` running `expectNoBasicA11yViolations`; ensure
      build/typecheck/test green
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 19. Area: `marketing/`
  - [x] 19.1 Make `marketing/` keyboard-operable
    - Marketing surfaces: keyboard reach/operate, visible focus, sensible focus
      order, no positive `tabindex`/no traps (prefer Radix where applicable)
    - _Requirements: 3.1, 3.2, 4.1, 5.1, 5.2, 5.3, 1.3, 1.4_

  - [ ]* 19.2 Add `marketing/` a11y test and confirm green
    - Add `*.a11y.spec.tsx` running `expectNoBasicA11yViolations`; ensure
      build/typecheck/test green
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 20. Area: `media/`
  - [x] 20.1 Make `media/` keyboard-operable
    - Protected media controls: keyboard reach/operate, visible focus, no positive
      `tabindex`/no traps, overlays trap+`Esc`+restore (prefer Radix)
    - _Requirements: 3.1, 3.2, 4.1, 5.1, 5.2, 5.3, 6.1, 7.1, 7.2, 7.3, 1.3, 1.4_

  - [ ]* 20.2 Add `media/` a11y test and confirm green
    - Add `*.a11y.spec.tsx` running `expectNoBasicA11yViolations`, plus a focused
      keyboard example for player controls/overlays; ensure build/typecheck/test green
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 21. Area: `teacher/`
  - [x] 21.1 Make `teacher/` keyboard-operable
    - Teacher tooling: keyboard reach/operate, visible focus, no positive
      `tabindex`/no traps, arrow keys for composite widgets, overlays
      trap+`Esc`+restore (prefer Radix)
    - _Requirements: 3.1, 3.2, 4.1, 5.1, 5.2, 5.3, 6.1, 7.1, 7.2, 7.3, 1.3, 1.4_

  - [ ]* 21.2 Add `teacher/` a11y test and confirm green
    - Add `*.a11y.spec.tsx` running `expectNoBasicA11yViolations`, plus a focused
      keyboard example where overlays/composite widgets exist; ensure build/typecheck/test green
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 22. Area: `student/`
  - [x] 22.1 Make `student/` keyboard-operable
    - Student tooling: keyboard reach/operate, visible focus, no positive
      `tabindex`/no traps, arrow keys for composite widgets, overlays
      trap+`Esc`+restore (prefer Radix)
    - _Requirements: 3.1, 3.2, 4.1, 5.1, 5.2, 5.3, 6.1, 7.1, 7.2, 7.3, 1.3, 1.4_

  - [ ]* 22.2 Add `student/` a11y test and confirm green
    - Add `*.a11y.spec.tsx` running `expectNoBasicA11yViolations`, plus a focused
      keyboard example where overlays/composite widgets exist; ensure build/typecheck/test green
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 23. Area: `admin/`
  - [x] 23.1 Make `admin/` keyboard-operable
    - Internal tooling: keyboard reach/operate, visible focus, no positive
      `tabindex`/no traps, arrow keys for composite widgets, overlays
      trap+`Esc`+restore (prefer Radix)
    - _Requirements: 3.1, 3.2, 4.1, 5.1, 5.2, 5.3, 6.1, 7.1, 7.2, 7.3, 1.3, 1.4_

  - [ ]* 23.2 Add `admin/` a11y test and confirm green
    - Add `*.a11y.spec.tsx` running `expectNoBasicA11yViolations`, plus a focused
      keyboard example where overlays/composite widgets exist; ensure build/typecheck/test green
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 24. Area: `protection/`
  - [x] 24.1 Make `protection/` keyboard-operable
    - Mostly static notices: keyboard reach/operate, visible focus, sensible focus
      order, no positive `tabindex`/no traps
    - _Requirements: 3.1, 3.2, 4.1, 5.1, 5.2, 5.3, 1.3, 1.4_

  - [ ]* 24.2 Add `protection/` a11y test and confirm green
    - Add `*.a11y.spec.tsx` running `expectNoBasicA11yViolations`; ensure
      build/typecheck/test green
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 25. Checkpoint — final
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Sub-tasks marked with `*` are optional (test sub-tasks) and can be skipped for a
  faster MVP.
- Prefer Radix's built-in focus trap, `Esc`, focus restore, and arrow-key roving;
  use `useFocusTrap` only for custom (non-Radix) overlays.
- Each Area phase is bounded to its own component folder so it stays independently
  mergeable and leaves the app releasable.
- Out of scope (not tasked): color contrast, captions, live-region announcements,
  reduced motion, i18n metadata, screen-reader matrix, DoD checklists.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3", "1.4", "1.5"] },
    { "id": 1, "tasks": ["1.2", "1.6", "1.7"] },
    { "id": 2, "tasks": ["3.1"] },
    { "id": 3, "tasks": ["3.2", "4.1"] },
    { "id": 4, "tasks": ["4.2", "5.1", "6.1", "7.1", "8.1", "9.1", "10.1", "11.1", "12.1", "13.1", "14.1", "15.1", "16.1", "17.1", "18.1", "19.1", "20.1", "21.1", "22.1", "23.1", "24.1"] },
    { "id": 5, "tasks": ["5.2", "6.2", "7.2", "8.2", "9.2", "10.2", "11.2", "12.2", "13.2", "14.2", "15.2", "16.2", "17.2", "18.2", "19.2", "20.2", "21.2", "22.2", "23.2", "24.2"] }
  ]
}
```
