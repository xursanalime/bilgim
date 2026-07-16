# Specialty Decommission Plan

> Status: **Deprecated, read-only.** No data is deleted by the
> `english-only-platform-refocus`. Permanent removal is deferred to a separate,
> explicitly-scoped decommission step described below.

This document tracks the database models and fields that were deprecated as part
of the **English-only platform refocus** and records the plan for their eventual
permanent removal. It exists because Requirement 16.5 mandates that legacy
specialty/onboarding data be **retained as read-only history** during the
refocus — it is not deleted here.

## Why these are deprecated

The platform previously supported multiple teaching "specialties" (e.g. math,
code, marketing) with a per-specialty onboarding/classification flow and a
per-specialty homework module catalog. The refocus narrows the product to a
single subject — **English** — with a fixed 8-skill homework catalog and a
CEFR-based leveling/placement model. The generic multi-specialty abstraction is
therefore retired.

Per Requirement 2.4, new flows MUST NOT read or write these structures. Per
Requirement 16.5, existing rows are kept intact as historical data so that
analytics, audits, and migration verification can still reference them.

## Deprecated models (retained read-only)

Defined in `packages/db/prisma/schema.prisma`. Each carries a `/// DEPRECATED`
doc comment pointing back to this file.

| Model                | Reason retained                                              |
| -------------------- | ------------------------------------------------------------ |
| `Specialty`          | Historical subject taxonomy referenced by existing teachers. |
| `SpecialtyModule`    | Legacy per-specialty homework module catalog mappings.       |
| `OnboardingQuestion` | Questions for the retired specialty-classification flow.     |
| `OnboardingAnswer`   | Teacher answers recorded by the retired onboarding flow.     |

## Deprecated fields (retained read-only)

| Model            | Field         | Reason retained                                          |
| ---------------- | ------------- | -------------------------------------------------------- |
| `TeacherProfile` | `specialtyId` | FK to historical `Specialty`; ignored by new flows.      |
| `TeacherProfile` | `specialty`   | Relation accessor for the historical `Specialty` record. |

These remain nullable and are simply ignored by new flows. A deprecation shim
(spec task 6.3) accepts and ignores `specialtyId` on inbound requests during the
transition window.

## What this refocus does NOT do

- It does **not** drop any of the models or fields above.
- It does **not** delete any rows.
- It does **not** add destructive migrations.

The schema change for this task is **doc-comment only** (no migration required).

## Future decommission step (separate, deferred)

When a later, explicitly-approved decommission spec/step runs, it should:

1. **Confirm no live references.** Verify that no production code path reads or
   writes `Specialty`, `SpecialtyModule`, `OnboardingQuestion`,
   `OnboardingAnswer`, or `TeacherProfile.specialtyId` / `.specialty`. Remove the
   `specialtyId` deprecation shim once the transition window has closed.
2. **Archive historical data.** Export the deprecated tables to cold
   storage/analytics if long-term retention is required for audit purposes.
3. **Generate a destructive Prisma migration** that, in dependency-safe order:
   - drops the `OnboardingAnswer` table,
   - drops the `OnboardingQuestion` table,
   - drops the `SpecialtyModule` table (and the
     `enforce_specialty_module_cap()` trigger/constraint, if present),
   - drops `TeacherProfile.specialtyId` (and its index/FK) and the `specialty`
     relation,
   - drops the `Specialty` table last (after dependents are removed).
4. **Remove the corresponding models/fields** from
   `packages/db/prisma/schema.prisma` and delete this document (or mark it
   complete).
5. **Verify** with `prisma validate`, `pnpm --filter @bilgim/db typecheck`, and a
   full monorepo `typecheck` + `test` to confirm nothing references the removed
   symbols.

## Related requirements

- **Requirement 2.4** — new flows must not depend on specialty structures.
- **Requirement 16.5** — legacy specialty/onboarding data retained read-only;
  permanent deletion deferred to a separate step.
- **Open Question 3** (`requirements.md`) — timing of permanent deletion is still
  to be decided; this document captures the plan, not the schedule.
