# Requirements Document

## Introduction

This feature makes the Bilgim web app (`apps/web`) fully operable with the
**keyboard alone** — no mouse or touchpad required. The scope is deliberately
minimal: it covers only what a keyboard user needs to reach, see, and operate
every control and complete every flow. It does not attempt full WCAG AA
conformance (color contrast, captions, live-region announcements, reduced
motion, locale/i18n metadata, and a screen-reader audit matrix are all out of
scope).

The work is delivered in small, independent phases so the build is never
touched all at once: a single cross-cutting **Foundation phase**, then one phase
per web component area. It builds on existing groundwork — the
`components/a11y/skip-link.tsx` component (already written, not yet mounted) and
the dependency-free `lib/test/a11y.ts` test helper.

## Glossary

- **Web_App**: The Bilgim Next.js 14 (App Router) application in `apps/web`.
- **Component_Area**: One feature-grouped folder under `apps/web/components`
  (for example auth, dashboard, lesson, live, settings) or the shared `ui/`
  primitives folder.
- **Foundation_Phase**: The first, cross-cutting phase that mounts the global
  keyboard primitives (skip link, focusable main landmark, test gate) shared by
  all other phases.
- **Area_Phase**: A phase that makes one Component_Area fully keyboard-operable.
- **Skip_Link**: The existing `components/a11y/skip-link.tsx` component that
  becomes the first focusable element and moves focus into the main landmark.
- **A11y_Test_Helper**: The dependency-free assertions in `lib/test/a11y.ts`.
- **Interactive_Control**: Any element a user can activate — button, link,
  input, select, textarea, or a custom widget with an interactive `role`.
- **Composite_Widget**: A grouped interactive control such as a menu, tablist,
  listbox, or dropdown.
- **Focusable_Element**: Any element that can receive keyboard focus.

## Requirements

### Requirement 1: Phased, Incremental Delivery

**User Story:** As a maintainer with limited build resources, I want the keyboard
work split into small independent phases, so that I can implement and verify one
slice at a time without overwhelming the build.

#### Acceptance Criteria

1. THE Web_App keyboard work SHALL be decomposed into one Foundation_Phase plus one Area_Phase per Component_Area.
2. THE Foundation_Phase SHALL be completable before any Area_Phase begins.
3. WHERE a phase is defined, THE phase SHALL be independently implementable, verifiable, and mergeable without requiring changes from any other Area_Phase.
4. WHEN a phase is completed, THE phase SHALL leave the Web_App in a building, releasable state.

### Requirement 2: Skip Link and Main Landmark

**User Story:** As a keyboard user, I want to skip past repeated navigation, so
that I can jump straight to the primary content.

#### Acceptance Criteria

1. THE Web_App SHALL render the Skip_Link as the first focusable element inside `<body>` on every page.
2. THE Web_App SHALL expose exactly one `<main id="main-content" tabIndex={-1}>` landmark per rendered page.
3. WHEN the Skip_Link is activated, THE Web_App SHALL move keyboard focus to the `<main id="main-content">` landmark.
4. WHILE the Skip_Link does not have focus, THE Web_App SHALL keep the Skip_Link visually hidden, and WHEN the Skip_Link receives keyboard focus, THE Web_App SHALL make the Skip_Link a visible control.

### Requirement 3: Keyboard Reachability and Operation

**User Story:** As a keyboard-only user, I want to reach and operate every
control, so that I can use the site without a pointing device.

#### Acceptance Criteria

1. WHERE an Interactive_Control is rendered, THE control SHALL be reachable using `Tab` and `Shift+Tab`.
2. WHERE an Interactive_Control is reachable, THE control SHALL be operable using `Enter`, and WHERE the control is a button, THE control SHALL also be operable using `Space`.

### Requirement 4: Visible Focus Indicator

**User Story:** As a keyboard user, I want to see where focus is, so that I always
know which control I am about to activate.

#### Acceptance Criteria

1. WHEN a Focusable_Element receives keyboard focus, THE Web_App SHALL display a visible focus indicator on that element.

### Requirement 5: Focus Order and No Traps

**User Story:** As a keyboard user, I want focus to move in a predictable order
and never get stuck, so that I can move through the page freely.

#### Acceptance Criteria

1. THE Web_App SHALL follow the visual reading order for focus order.
2. THE Web_App SHALL use only `tabindex` values of `0` or `-1` and SHALL NOT use a positive `tabindex`.
3. WHILE no dialog, menu, or popover is open, THE Web_App SHALL allow `Tab` and `Shift+Tab` to move focus through and out of every region without becoming stuck.

### Requirement 6: Composite Widget Arrow-Key Navigation

**User Story:** As a keyboard user, I want to move within menus, tabs, and
dropdowns with arrow keys, so that I can operate grouped controls as expected.

#### Acceptance Criteria

1. WHERE a Composite_Widget is rendered, THE widget SHALL support moving focus between its items using the arrow keys.

### Requirement 7: Dialog and Overlay Focus Management

**User Story:** As a keyboard user, I want overlays to manage focus, so that I can
open, use, and dismiss them without losing my place.

#### Acceptance Criteria

1. WHILE a dialog, menu, or popover is open, THE Web_App SHALL trap keyboard focus within that overlay.
2. WHEN the `Esc` key is pressed while a dialog, menu, or popover is open, THE Web_App SHALL close that overlay.
3. WHEN a dialog, menu, or popover closes, THE Web_App SHALL return keyboard focus to the element that opened it.

### Requirement 8: Automated Keyboard Checks

**User Story:** As a maintainer, I want a lightweight automated check per area, so
that keyboard regressions are caught without manual effort.

#### Acceptance Criteria

1. WHERE a Component_Area is made keyboard-operable, THE Area_Phase SHALL include an automated test that runs the A11y_Test_Helper against the remediated components.
2. WHEN the A11y_Test_Helper detects a positive `tabindex` or an Interactive_Control with no accessible name, THE test SHALL fail.
3. THE automated keyboard checks SHALL run as part of `pnpm --filter @bilgim/web test`.
