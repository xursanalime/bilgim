# Design Document

> **English-Only Platform Refocus — Technical Design (backend-led)**
> Companion to `requirements.md` in this spec. Grounded in the implemented NestJS modular monolith (`apps/api`), Prisma schema (`packages/db/prisma/schema.prisma`), and existing modules (auth, billing, catalog, enrollment, homework, live, ai, notifications, gamification, discovery, admin).

## Overview

This design narrows the already-built generic education platform into a **dedicated English-learning product**. The strategy is **additive + deprecating**, not a rewrite: keep the strong existing modules (billing/Payme, live, gamification, AI gateway, notifications) and (a) introduce CEFR/Exam_Track leveling, placement, and speaking/pronunciation audio assessment, (b) restrict homework to the eight language skills, and (c) deprecate the generic `Specialty` abstraction without destructive data loss.

Key principles:
- **No destructive migration.** Specialty/Onboarding data becomes read-only history; legacy homework submissions are preserved (Req 16).
- **Server-authoritative validation.** Level requirements, module-type restriction, and audio content-type allowlists are enforced in services, not just UI (Req 1, 6, 7).
- **Reuse over rebuild.** Billing, Live, Gamification, Notifications carry over unchanged in behavior (Req 11–13, 15).

## Architecture

```
apps/api (NestJS modular monolith)
├── modules/
│   ├── catalog/      → English_Catalog_Module (Course/Group/Lesson + CEFR/Exam_Track)
│   ├── leveling/     → Leveling_Module (NEW): course/group level, learner proficiency + history
│   ├── placement/    → Placement_Module (NEW): assessment, scoring → CEFR
│   ├── homework/     → Language_Homework_Module (restricted to 8 skills)
│   ├── speaking/     → Speaking_Assessment_Module (NEW): audio submission → AI scoring
│   ├── ai/           → AI_Gateway (refocused; SPECIALTY_CLASSIFY removed)
│   ├── teacher/      → onboarding refocused (no specialty step)
│   ├── billing/ live/ gamification/ discovery/ notifications/ admin/  (carried over, re-themed)
│   └── migration/    → Migration_Process (NEW, idempotent one-time)
└── packages/db       → schema additions (level fields, proficiency, placement, level history)
```

- New modules (`leveling`, `placement`, `speaking`, `migration`) follow existing module conventions (module/controller/service/repository, Zod DTOs, guards).
- `Specialty`-coupled code paths gain a deprecation shim: endpoints still accept `specialtyId` but ignore it for a defined window (Req 2.3).

## Components and Interfaces

| Component | Responsibility | Key endpoints (proposed) |
|---|---|---|
| `Leveling_Module` | CEFR level + Exam_Track on Course/Group; learner proficiency + level history | `PATCH /catalog/courses/:id/level`, `GET/PATCH /learners/:id/proficiency` |
| `Placement_Module` | Administer placement assessment; compute CEFR | `POST /placement/start`, `POST /placement/:id/submit`, `GET /placement/:id` |
| `Language_Homework_Module` | Restrict assignments to 8 skills; server-side enabled-state validation | extends existing `homework` controller; rejects Legacy_Module_Type with `MODULE_TYPE_NOT_SUPPORTED` |
| `Speaking_Assessment_Module` | Accept audio submission; enqueue AI scoring; instructor override | `POST /submissions/:id/audio`, scoring worker, `PATCH /submissions/:id/score` |
| `AI_Gateway` | English tutor/grading; pronunciation scoring; remove SPECIALTY_CLASSIFY | existing `ai` endpoints, refocused intents |
| `Migration_Process` | Idempotent backfill: default CEFR on courses, UNASSESSED learners, preserve legacy | one-off CLI/script in `apps/api/scripts` + guarded admin trigger |
| `Admin_Module` | Manage Exam_Track + 8-skill catalog; audit | replaces specialty catalog screens |

External contracts the frontend (`frontend-redesign` spec) consumes: course/group level + Exam_Track on catalog DTOs; learner proficiency; placement flow; per-skill assignment validation; audio submission + AI scoring status.

## Data Models

Additions to `packages/db/prisma/schema.prisma` (non-destructive):

- **Course**: add `cefrLevel` (enum A1..C2, nullable during migration then required for new), `examTrack` (nullable string/enum).
- **Group**: add `cefrLevel` override (nullable; inherits Course when null).
- **StudentProfile / new `ProficiencyLevel`**: `currentCefrLevel` (nullable → UNASSESSED), plus a `ProficiencyLevelHistory` record (learnerId, fromLevel, toLevel, source, changedBy, changedAt).
- **PlacementAssessment**: id, learnerId, status, perSkillScores (json), computedLevel, startedAt, submittedAt; **PlacementAnswer** for resumable progress (Req 5.4).
- **ExamTrack** (admin-managed): slug, name, isActive.
- **HomeworkModuleType usage**: no enum change required; restriction enforced in service + a global English catalog (8 types) replacing per-Specialty catalog.
- **Specialty / OnboardingQuestion / OnboardingAnswer / SpecialtyModule**: retained, marked deprecated/read-only (Req 16.5); no deletion until a separate decommission.

CEFR enum: `A1, A2, B1, B2, C1, C2` (+ logical `UNASSESSED` represented by null proficiency).

## Correctness Properties

### Property 1: English-only course creation
A Course can be created/edited without a Specialty and is always scoped to English.
**Validates: Requirements 1.2, 1.3, 2.2**

### Property 2: Level required for new courses
A new Course cannot be published without a CEFR level; group level inherits course level unless overridden.
**Validates: Requirements 3.1, 3.3, 3.4, 3.5**

### Property 3: Homework restricted to eight skills
Assignment creation rejects any Legacy_Module_Type and only allows group-enabled language skills, validated server-side.
**Validates: Requirements 6.1, 6.3, 6.6**

### Property 4: Speaking audio integrity
SPEAKING/PRONUNCIATION submissions accept only allowlisted audio content types and always produce either an AI score or a manual-review flag.
**Validates: Requirements 7.1, 7.5, 7.7**

### Property 5: Non-destructive migration idempotency
Re-running the migration never duplicates records and never modifies legacy submissions.
**Validates: Requirements 16.3, 16.6**

### Property 6: Specialty deprecation compatibility
Endpoints that previously required `specialtyId` continue to succeed while ignoring it during the deprecation window.
**Validates: Requirements 2.3**

## Error Handling

- `MODULE_TYPE_NOT_SUPPORTED` for Legacy_Module_Type in new assignments (Req 6.3).
- Validation error identifying missing CEFR level on course submit (Req 3.5).
- Audio scoring failure after retries → mark job failed + notify instructor for manual review (Req 7.5).
- Placement abandonment → preserve answers for resumption within retention window (Req 5.4).
- Migration failure mid-run → safe re-run (idempotent), structured error log.

## Testing Strategy

- **Unit:** leveling rules (inherit/override/required), module-type restriction, audio allowlist, placement scoring → CEFR mapping.
- **Property-based (fast-check, matching existing repo style):** Properties 1–6 above (esp. migration idempotency and homework restriction).
- **Integration:** placement start→submit→proficiency set→notification; audio submit→scoring→grade; specialty-deprecation compatibility.
- **Migration test:** run twice on a seeded legacy dataset; assert no duplication and legacy submissions untouched.
- **Regression:** billing/live/gamification/notifications behavior unchanged (carry-over requirements 11–13, 15).
