# Requirements Document

## Introduction

This spec describes the **refocus** of the existing EduBridge platform from a generic, multi-specialty two-sided education marketplace into a **dedicated English-language learning product**. EduBridge today is fully built (NestJS modular monolith API in `apps/api`, Next.js 14 web in `apps/web`, Prisma/PostgreSQL in `packages/db`) and supports arbitrary teacher specialties (marketing, math, code, etc.) through a `Specialty` abstraction and a 20+ entry `HomeworkModuleType` catalog.

The refocus narrows the product so that the only domain is English-language teaching and learning. It retires the generic specialty abstraction, keeps and leans into the eight existing language-learning homework module types (WRITING, READING, LISTENING, GRAMMAR, SPELLING, VOCABULARY, SPEAKING, PRONUNCIATION), introduces English-proficiency framing (CEFR A1–C2 and IELTS-style preparation) across catalog and learners, and adds speaking/pronunciation assessment via audio submission and AI scoring. The platform's existing strengths — live classes, gamification, AI tutor/grading, and Payme billing — are carried over and re-themed for English learning rather than rebuilt.

This document defines what the refocused system must do, including what is **removed**, **migrated**, and **kept** from the current generic model. The accompanying Open Questions section surfaces decisions the team must confirm before design.

## Glossary

- **Platform**: The refocused EduBridge English-language learning system.
- **English_Catalog_Module**: The refactored Catalog_Module responsible for English courses, groups, lessons, and English-specific level metadata.
- **Leveling_Module**: New capability that assigns and tracks English proficiency levels (CEFR and exam-prep track) for learners, courses, and groups.
- **Placement_Module**: New capability that administers a placement assessment and produces an initial learner proficiency level.
- **Language_Homework_Module**: The refactored Homework_Module restricted to the eight language skill module types.
- **Speaking_Assessment_Module**: New capability that accepts learner audio submissions for SPEAKING/PRONUNCIATION modules and produces AI-generated scores and feedback.
- **AI_Gateway**: The existing Claude-integration module, refocused on English tutoring, grading, and pronunciation scoring.
- **Billing_Module**: The existing trial/subscription/Payme billing module, carried over unchanged in behavior.
- **Live_Module**: The existing live-class (mediasoup/LiveKit) module, carried over unchanged in behavior.
- **Gamification_Module**: The existing XP/badge/streak module, carried over and re-themed for English learning.
- **Discovery_Module**: The existing public search module, refocused on English-instructor and level-based search.
- **Notifications_Module**: The existing multi-channel notification module, carried over with English-learning notification kinds.
- **Admin_Module**: The existing administration module, refocused to manage English levels and the language module catalog instead of specialties.
- **Migration_Process**: The one-time data migration that converts existing generic-platform data into the English-only model.
- **CEFR**: Common European Framework of Reference for Languages, with six levels A1, A2, B1, B2, C1, C2.
- **Exam_Track**: An English examination preparation track (for example IELTS) attached to a course in addition to or instead of a CEFR level.
- **English_Skill**: One of the eight supported language skills: WRITING, READING, LISTENING, GRAMMAR, SPELLING, VOCABULARY, SPEAKING, PRONUNCIATION.
- **Language_Module_Type**: A `HomeworkModuleType` value corresponding to one of the eight English_Skill values.
- **Legacy_Module_Type**: A `HomeworkModuleType` value that does not correspond to an English_Skill (for example MULTIPLE_CHOICE, GAP_FILL, MATCHING, DRAG_DROP, PROJECT_SUBMISSION, CASE_STUDY, MARKETING_COPY, AUDIENCE_ANALYSIS, CONTENT_CALENDAR, MATH_WORD_PROBLEM, MATH_EQUATION_SOLVER, MATH_GEOMETRY_PROOF, CODE_REVIEW, CODE_UNIT_TEST).
- **Specialty**: The existing entity representing a teacher's subject area. To be retired by this refocus.
- **Learner**: The Student role, refocused as an English learner.
- **Instructor**: The Teacher role, refocused as an English instructor.
- **Admin**: The platform administrator role.
- **Proficiency_Level**: A learner's current English level, expressed as a CEFR value and optionally an Exam_Track readiness band.

## Requirements

### Requirement 1: English-only domain enforcement

**User Story:** As an Admin, I want the platform to operate exclusively as an English-learning product, so that all content, catalog entries, and teaching workflows are scoped to English instruction.

#### Acceptance Criteria

1. THE Platform SHALL treat English as the single supported teaching subject for all courses, groups, and lessons.
2. WHEN an Instructor creates a Course, THE English_Catalog_Module SHALL associate the Course with the English domain without requiring a Specialty selection.
3. THE English_Catalog_Module SHALL reject creation requests that attempt to assign a non-English subject to a Course.
4. THE Platform SHALL present English-learning terminology (levels, skills, exam tracks) in all Instructor and Learner catalog interfaces.

### Requirement 2: Retire the generic Specialty abstraction

**User Story:** As an Admin, I want the generic multi-specialty system removed, so that the product is no longer modeled as supporting arbitrary teacher subjects.

#### Acceptance Criteria

1. THE Platform SHALL remove the Specialty selection step from Instructor onboarding.
2. THE Platform SHALL remove Specialty assignment as a prerequisite for creating Courses, Groups, and Lessons.
3. WHERE an existing API endpoint accepts a `specialtyId` parameter, THE Platform SHALL continue to accept the request while ignoring the `specialtyId` value during a defined deprecation period.
4. THE Admin_Module SHALL remove Specialty management screens and replace Specialty-scoped module catalog management with a single English language module catalog.
5. THE Platform SHALL remove the onboarding-question-driven specialty classification flow, including the Claude specialty-classification fallback.

### Requirement 3: English proficiency leveling for courses and groups

**User Story:** As an Instructor, I want to assign an English proficiency level and optional exam track to each course, so that learners can find content matching their ability.

#### Acceptance Criteria

1. WHEN an Instructor creates or edits a Course, THE Leveling_Module SHALL allow assignment of exactly one CEFR level from the set {A1, A2, B1, B2, C1, C2}.
2. WHERE an Instructor selects an Exam_Track for a Course, THE Leveling_Module SHALL store the Exam_Track identifier alongside the CEFR level.
3. WHEN an Instructor creates a Group within a Course, THE Leveling_Module SHALL inherit the Course CEFR level as the Group default level.
4. WHERE an Instructor overrides the Group level, THE Leveling_Module SHALL store a Group-specific CEFR level that takes precedence over the inherited Course level.
5. IF an Instructor submits a Course without a CEFR level, THEN THE Leveling_Module SHALL reject the request with a validation error identifying the missing level.
6. THE Leveling_Module SHALL expose the CEFR level and Exam_Track of each discoverable Course to the Discovery_Module.

### Requirement 4: Learner proficiency profile

**User Story:** As a Learner, I want my English proficiency level stored on my profile, so that the platform can recommend courses appropriate to my ability.

#### Acceptance Criteria

1. THE Leveling_Module SHALL store a Proficiency_Level for each Learner, expressed as a CEFR value.
2. WHERE a Learner has not completed a placement assessment, THE Leveling_Module SHALL represent the Learner Proficiency_Level as UNASSESSED.
3. WHEN a Learner completes a placement assessment, THE Leveling_Module SHALL set the Learner Proficiency_Level to the assessed CEFR value.
4. WHEN an Instructor records a level change for an enrolled Learner, THE Leveling_Module SHALL update the Learner Proficiency_Level and retain the previous level in a level-history record.
5. THE Leveling_Module SHALL expose the Learner Proficiency_Level to the Discovery_Module for course recommendations.

### Requirement 5: Placement assessment

**User Story:** As a Learner, I want to take a placement assessment, so that I receive an accurate starting CEFR level.

#### Acceptance Criteria

1. WHEN a Learner starts a placement assessment, THE Placement_Module SHALL present a sequence of graded questions covering at least the READING, GRAMMAR, and VOCABULARY skills.
2. WHEN a Learner submits all placement answers, THE Placement_Module SHALL compute a CEFR level from the scored responses.
3. WHEN the Placement_Module computes a CEFR level, THE Leveling_Module SHALL set the Learner Proficiency_Level to that value.
4. IF a Learner abandons a placement assessment before submission, THEN THE Placement_Module SHALL preserve answered questions for resumption within a defined retention period.
5. THE Placement_Module SHALL record the assessment result, including per-skill scores and the computed CEFR level, for later review.

### Requirement 6: Restrict homework modules to the eight English skills

**User Story:** As an Instructor, I want the assignment builder to offer only English-skill modules, so that I build assignments aligned with language learning.

#### Acceptance Criteria

1. THE Language_Homework_Module SHALL support exactly the eight Language_Module_Type values: WRITING, READING, LISTENING, GRAMMAR, SPELLING, VOCABULARY, SPEAKING, PRONUNCIATION.
2. WHEN an Instructor opens the assignment builder, THE Language_Homework_Module SHALL present only Language_Module_Type options that are enabled for the Group.
3. IF an Instructor submits an Assignment containing a Legacy_Module_Type, THEN THE Language_Homework_Module SHALL reject the request with a MODULE_TYPE_NOT_SUPPORTED error.
4. WHEN a Group is created, THE English_Catalog_Module SHALL seed one GroupModule record for each of the eight Language_Module_Type values.
5. THE Admin_Module SHALL manage a single English language module catalog limited to the eight Language_Module_Type values, replacing the per-Specialty module catalog.
6. THE Language_Homework_Module SHALL validate the enabled state of each selected Language_Module_Type server-side at assignment creation, independent of client input.

### Requirement 7: Speaking and pronunciation assessment via audio

**User Story:** As a Learner, I want to record and submit spoken answers for SPEAKING and PRONUNCIATION assignments, so that I receive AI feedback on my fluency and pronunciation.

#### Acceptance Criteria

1. WHEN an Assignment includes a SPEAKING or PRONUNCIATION module, THE Speaking_Assessment_Module SHALL allow the Learner to submit an audio recording as the answer for that module.
2. WHEN a Learner submits an audio recording, THE Media_Module SHALL store the recording as an AUDIO MediaAsset associated with the Submission.
3. WHEN an audio Submission for a SPEAKING or PRONUNCIATION module reaches SUBMITTED status, THE Speaking_Assessment_Module SHALL enqueue an AI scoring job through the AI_Gateway.
4. WHEN the AI_Gateway scores a SPEAKING or PRONUNCIATION submission, THE Speaking_Assessment_Module SHALL produce a numeric score and structured feedback covering at least pronunciation accuracy and fluency, stored as an AI_DRAFT Feedback record.
5. IF audio scoring fails after the configured retry attempts, THEN THE Speaking_Assessment_Module SHALL mark the scoring job as failed and notify the Instructor for manual review.
6. THE Speaking_Assessment_Module SHALL allow the Instructor to override the AI score and feedback before the Submission reaches GRADED status.
7. THE Speaking_Assessment_Module SHALL accept only audio MediaAsset content types permitted by the Media_Module allowlist.

### Requirement 8: AI tutor refocused on English learning

**User Story:** As a Learner, I want the AI tutor to help me with English-specific tasks, so that I can practice and improve without receiving submittable answers.

#### Acceptance Criteria

1. WHEN a Learner requests AI tutoring with EXPLAIN, TRANSLATE, or EXAMPLE intent for an English task, THE AI_Gateway SHALL respond with English-learning guidance.
2. THE AI_Gateway SHALL enforce the policy that the tutor never writes a complete sentence or paragraph the Learner could submit verbatim.
3. WHEN an AI tutor response exceeds the configured similarity threshold against the Learner's active submission text, THE AI_Gateway SHALL rewrite the response as a hint.
4. THE AI_Gateway SHALL audit each English tutoring call with userId, intent, cost, latency, and token usage.
5. THE AI_Gateway SHALL remove the SPECIALTY_CLASSIFY intent from active tutoring and onboarding flows.

### Requirement 9: AI grading refocused on language skills

**User Story:** As an Instructor, I want AI to pre-grade language assignments, so that I can review and finalize scores faster.

#### Acceptance Criteria

1. WHEN a text-based Language_Module_Type submission reaches SUBMITTED status, THE AI_Gateway SHALL produce an AI_DRAFT Feedback record with skill-appropriate evaluation criteria.
2. WHEN the AI_Gateway pre-grades a WRITING or GRAMMAR submission, THE AI_Gateway SHALL include grammar, vocabulary, and coherence feedback dimensions.
3. WHEN AI grading completes, THE Language_Homework_Module SHALL transition the Submission to IN_REVIEW status.
4. THE AI_Gateway SHALL continue to compute an AI-text likelihood for text submissions and flag submissions above the configured threshold.

### Requirement 10: Instructor onboarding refocused as English instructor

**User Story:** As an Instructor, I want a simplified onboarding focused on English teaching, so that I can start creating courses without selecting a generic specialty.

#### Acceptance Criteria

1. WHEN a new Instructor completes email verification, THE Billing_Module SHALL create a 14-day trial subscription as in the current system.
2. THE Platform SHALL onboard every Instructor as an English instructor without presenting a specialty selection step.
3. WHERE onboarding collects teaching preferences, THE Platform SHALL limit the collected preferences to English-teaching attributes such as taught CEFR levels and Exam_Track focus.
4. WHEN an Instructor completes onboarding, THE Platform SHALL route the Instructor to the English instructor dashboard.

### Requirement 11: Carry over billing behavior unchanged

**User Story:** As an Instructor, I want subscription and payment behavior to remain the same after the refocus, so that my billing experience is uninterrupted.

#### Acceptance Criteria

1. THE Billing_Module SHALL retain the subscription state machine TRIAL → ACTIVE → PAST_DUE → CANCELED/EXPIRED unchanged.
2. THE Billing_Module SHALL retain Payme checkout, webhook handling, idempotency, and atomic enrollment-request creation unchanged.
3. WHILE a subscription is EXPIRED or CANCELED, THE English_Catalog_Module SHALL prohibit publishing new lessons.
4. THE Billing_Module SHALL retain the constraint of one non-terminal subscription per Instructor.

### Requirement 12: Carry over live classes unchanged

**User Story:** As an Instructor, I want to run live English classes using the existing live system, so that real-time teaching continues to work.

#### Acceptance Criteria

1. WHEN an Instructor starts a live class, THE Live_Module SHALL create and manage the LiveSession lifecycle unchanged from the current system.
2. WHEN a Learner joins a live class, THE Live_Module SHALL enforce APPROVED enrollment access control unchanged.
3. THE Live_Module SHALL retain recording finalization behavior, ensuring a LiveSession always transitions to ENDED or RECORDING_FAILED.

### Requirement 13: Carry over gamification with English re-theming

**User Story:** As a Learner, I want to earn XP, streaks, and badges for English practice, so that I stay motivated.

#### Acceptance Criteria

1. THE Gamification_Module SHALL retain XP, level, streak, badge, and reward mechanics unchanged in structure.
2. WHEN a Learner submits a language assignment or completes a speaking assessment, THE Gamification_Module SHALL award XP using the existing XP event mechanism.
3. THE Gamification_Module SHALL present badge and challenge content themed around English-learning activities.
4. WHERE existing badges reference non-English subjects, THE Admin_Module SHALL allow deactivating or re-theming those badges.

### Requirement 14: Discovery refocused on English level and skill

**User Story:** As a visitor, I want to search for English instructors and courses by CEFR level and exam track, so that I can find content matching my needs.

#### Acceptance Criteria

1. WHEN a visitor searches the catalog, THE Discovery_Module SHALL return only English courses and groups that are discoverable and published.
2. WHERE a visitor filters by CEFR level, THE Discovery_Module SHALL return only Courses and Groups matching the selected level.
3. WHERE a visitor filters by Exam_Track, THE Discovery_Module SHALL return only Courses associated with the selected Exam_Track.
4. THE Discovery_Module SHALL remove specialty-based search facets and replace them with English level and skill facets.
5. WHEN a visitor enrolls from a discovery result, THE Platform SHALL route the visitor through the existing Payme and enrollment-request flow unchanged.

### Requirement 15: Notifications for English-learning events

**User Story:** As a Learner, I want to be notified about placement results, level changes, and graded language work, so that I stay informed of my progress.

#### Acceptance Criteria

1. WHEN a Learner's placement assessment produces a CEFR level, THE Notifications_Module SHALL send a placement-result notification respecting the Learner's channel preferences.
2. WHEN a Learner's Proficiency_Level changes, THE Notifications_Module SHALL send a level-change notification.
3. WHEN a SPEAKING or PRONUNCIATION submission is graded, THE Notifications_Module SHALL send a homework-graded notification.
4. THE Notifications_Module SHALL retain idempotent, multi-channel delivery (IN_APP, EMAIL, TELEGRAM, PUSH) unchanged.

### Requirement 16: Data migration from the generic model

**User Story:** As an Admin, I want existing data migrated safely into the English-only model, so that current instructors, learners, courses, and submissions remain usable.

#### Acceptance Criteria

1. WHEN the Migration_Process runs, THE Migration_Process SHALL assign a default CEFR level to existing Courses that lack one, using a configurable default.
2. WHEN the Migration_Process runs, THE Migration_Process SHALL set existing Learners without a placement result to Proficiency_Level UNASSESSED.
3. WHEN the Migration_Process encounters an Assignment containing a Legacy_Module_Type, THE Migration_Process SHALL preserve the existing Assignment and Submission records without modification.
4. THE Migration_Process SHALL disable Legacy_Module_Type options for new assignment creation while retaining historical Submissions for read access.
5. WHEN the Migration_Process runs, THE Migration_Process SHALL retain existing Specialty and OnboardingQuestion records as read-only historical data until a separate decommission step removes them.
6. IF the Migration_Process fails partway, THEN THE Migration_Process SHALL be safely re-runnable without duplicating migrated records (idempotent migration).

### Requirement 17: Admin management of English levels and module catalog

**User Story:** As an Admin, I want to manage CEFR levels, exam tracks, and the language module catalog, so that the platform's English configuration stays accurate.

#### Acceptance Criteria

1. THE Admin_Module SHALL allow management of the available Exam_Track options.
2. THE Admin_Module SHALL allow enabling and disabling each of the eight Language_Module_Type values in the global English module catalog.
3. WHEN an Admin disables a Language_Module_Type globally, THE English_Catalog_Module SHALL prevent new assignments using that type while preserving existing Submissions.
4. THE Admin_Module SHALL record administrative changes to levels, exam tracks, and the module catalog in the audit log.

## Open Questions / Clarifications Needed

The following decisions should be confirmed before or during the design phase. Each affects scope and data modeling.

1. **CEFR vs IELTS framing**: Should Exam_Track (e.g., IELTS) be modeled as a separate field alongside CEFR (current assumption in Req 3), or should some courses be exam-track-only with no CEFR level? Are exam tracks limited to IELTS, or also TOEFL/Cambridge/others?
2. **Legacy submission visibility**: Should historical Legacy_Module_Type submissions (math/code/marketing) remain visible to learners and instructors after refocus, or be hidden from the UI while retained in the database? Req 16.4 currently assumes read access is retained.
3. **Specialty decommission timing**: When (if ever) should `Specialty`, `OnboardingQuestion`, `OnboardingAnswer`, and `SpecialtyModule` rows be permanently deleted versus kept as read-only history? Req 16.5 assumes a later, separate decommission step.
4. **Existing non-English courses**: How should existing courses that were genuinely about non-English subjects be handled — auto-archived, flagged for instructor migration, or assigned a default English level (current Req 16.1 assumption)?
5. **Placement assessment authorship**: Should the placement assessment use a fixed admin-authored question bank, AI-generated questions, or a third-party item bank? Req 5 currently assumes a graded question sequence without specifying the source.
6. **Speaking scoring engine**: Should pronunciation scoring rely solely on the existing Claude AI_Gateway (with audio transcription), or integrate a specialized speech/pronunciation scoring provider? Req 7 currently assumes the AI_Gateway.
7. **Audio transcription dependency**: Speaking assessment likely requires speech-to-text. Should transcription be added as an explicit capability/requirement, and which provider?
8. **Localization scope**: The current platform UI is primarily Uzbek/Russian. Should the refocused English-learning UI remain localized in Uzbek/Russian for learners (with English as the taught subject), and does this document need to be authored in Uzbek to match the existing spec?
9. **Per-group level overrides vs course-level only**: Req 3.4 allows group-level overrides of CEFR level. Confirm whether per-group overrides are needed or whether level should be course-only.
10. **Gamification badge migration**: Should existing non-English badges be deactivated, deleted, or re-themed? Req 13.4 currently allows deactivation or re-theming.
