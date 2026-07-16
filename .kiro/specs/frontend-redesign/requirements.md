# Requirements Document

> **Bilgim Frontend (Web) Redesign & Completion**

## Introduction

Bilgim is an online English-teaching platform for Uzbekistan whose mission is to **consolidate online English instructors (IELTS/general English first) onto a single product** and replace the fragmented, chaotic workflow they use today: teaching over Telegram chats, collecting homework as scattered chat messages, running live lessons on Zoom (good streaming but no homework/grading), and manually juggling between tools. Bilgim brings live classes, recorded lessons, structured homework, AI tutoring/grading, gamification, and payments into one place.

The backend (NestJS modular monolith in `apps/api`), data model (Prisma/PostgreSQL in `packages/db`), and domain refocus (see `english-only-platform-refocus` spec) are already specified and largely implemented. The **frontend (`apps/web`, Next.js 14 App Router) has never had a formal spec.** An outdated `web-design.md` (Pomelo/Forest-green palette) no longer matches the implemented design system (**"Bilgim Design System v2.0 — Apple Liquid Glass Light"**, primary blue `#0071E3`, Inter + Syne, in `apps/web/tailwind.config.ts` and `globals.css`).

This document specifies the requirements to (1) **modernize the entire web frontend to a premium, 2026-grade visual standard** while building on the existing design system, (2) **deliver best-in-class content protection (anti-piracy)** for teacher videos and files — the single most business-critical requirement — and (3) **complete and unify all frontend surfaces** (marketing, auth, teacher, student, admin) against the existing API.

### Critical truth recorded up front (content protection)

Industry research (VdoCipher, Dolby/THEO, Gumlet, W3C EME) confirms that **complete prevention of screenshots and screen recording on the web is not technically achievable.** On Windows browsers it is ~70–80% preventable with hardware DRM; Chrome on macOS/Linux exposes no native capture-blocking mechanism even under DRM; and an external camera always defeats any software control. Therefore this spec defines content protection as a **layered defense whose goal is to make piracy impractical and traceable**, not "100% impossible." The layers are: access control (signed, expiring URLs + auth), encryption/DRM (multi-DRM: Widevine, FairPlay, PlayReady via EME), deterrence (per-viewer dynamic forensic watermarking), and detection/response. Native mobile apps (`apps/mobile`) can enforce stronger OS-level protection (Android `FLAG_SECURE`, iOS screen-capture detection) and the requirements reflect that asymmetry.

## Glossary

- **Web_App**: The Next.js 14 web client in `apps/web`.
- **Design_System**: "Bilgim Design System v2.0 — Apple Liquid Glass Light" — the token set, typography, spacing, motion, and component conventions defined in `apps/web/tailwind.config.ts` and `apps/web/app/globals.css`.
- **Instructor**: The TEACHER role user (English instructor).
- **Learner**: The STUDENT role user (English learner).
- **Admin**: The platform administrator role user.
- **Course / Group / Lesson / Assignment / Submission**: Domain entities as defined in `packages/db/prisma/schema.prisma`.
- **Lesson_Player**: The Web_App component that plays recorded lessons and live-session recordings (HLS).
- **Live_Studio**: The Instructor's live broadcasting UI; **Live_Viewer** is the Learner's live watching UI.
- **Protected_Content**: Any lesson video, live recording, or attachment (PDF/DOC/SHEET/IMAGE/AUDIO) belonging to a Group.
- **Content_Protection**: The layered anti-piracy system: signed URLs, multi-DRM, dynamic watermark, download gating, deterrence, and traceability.
- **Forensic_Watermark**: A per-viewer overlay (and/or session-bound marker) that ties a playback session to a specific Learner identity for leak tracing.
- **Download_Permission**: A per-Group setting controlled by the Instructor that determines whether Learners may download Protected_Content.
- **Multi_DRM**: Concurrent use of Widevine, FairPlay, and PlayReady content decryption modules via Encrypted Media Extensions (EME).
- **CEFR / Exam_Track**: English proficiency level (A1–C2) and exam-prep track (e.g. IELTS), per the english-only refocus spec.
- **BilgimAI**: The platform's AI tutor/assistant surface.
- **Design_Token**: A named, themeable value (color, radius, spacing, shadow, motion duration) consumed by components.
- **Locale**: One of `uz` (default), `ru`, `en` per `packages/i18n`.
- **WCAG_AA**: Web Content Accessibility Guidelines 2.1, Level AA.
- **Core_Web_Vitals**: Google's LCP, INP, and CLS performance metrics.

## Requirements

### Requirement 1: Content protection — protected video playback (CRITICAL)

**User Story:** As an Instructor, I want my lesson videos and live-session recordings to be playable in Bilgim but extremely hard to download, copy, or re-stream, so that my content is not leaked to YouTube or Telegram channels.

#### Acceptance Criteria

1. THE Lesson_Player SHALL play Protected_Content only via DRM-encrypted adaptive streams (HLS/DASH) using Multi_DRM (Widevine, FairPlay, PlayReady) through EME, never from a raw, downloadable file URL.
2. THE Web_App SHALL request playback through short-lived signed URLs / playback tokens that expire after a configurable window, and SHALL re-authorize on token expiry without exposing a permanent media URL.
3. WHEN a Learner who lacks an APPROVED enrollment for the Group requests Protected_Content, THE Web_App SHALL deny playback and SHALL NOT issue a playback token.
4. THE Lesson_Player SHALL NOT expose native browser download controls, SHALL disable the right-click context menu and the `controlsList` download affordance, and SHALL serve video frames through the DRM media pipeline rather than a directly addressable `<video src>` file.
5. WHERE the Learner's browser/OS supports hardware-backed DRM, THE Lesson_Player SHALL prefer the hardware security level so that capture attempts yield a black frame on supporting platforms.
6. THE Web_App SHALL document and surface to Instructors the honest limitation that web screen-capture cannot be 100% prevented, and SHALL rely on Forensic_Watermark (Requirement 3) for traceability rather than implying absolute prevention.
7. IF DRM playback cannot be established on a given device/browser, THEN THE Lesson_Player SHALL fail closed (refuse to play unprotected) and SHALL show a clear message instructing the Learner to use a supported browser or the mobile app.

### Requirement 2: Content protection — download gating for files and videos

**User Story:** As an Instructor, I want downloads of my videos and attached files (PDF, DOC, SHEET, images, audio) disabled by default and only allowed when I explicitly turn it on for a Group, so that I control whether students can keep copies.

#### Acceptance Criteria

1. THE Web_App SHALL treat Download_Permission as **disabled by default** for every Group.
2. WHILE Download_Permission is disabled for a Group, THE Web_App SHALL NOT render any download, export, or "save as" control for that Group's videos or attachments, and SHALL render PDFs/DOCs in a protected in-app viewer rather than linking to the source file.
3. WHEN an Instructor enables Download_Permission in Group settings, THE Web_App SHALL reveal download controls for that Group's Protected_Content for Learners with APPROVED enrollment.
4. THE Web_App SHALL rely on server-side authorization for every Protected_Content fetch and SHALL NOT treat client-side hiding of controls as the sole enforcement (the API must reject unauthorized download requests even if the client is tampered with).
5. WHERE a file is shown in the protected in-app viewer, THE Web_App SHALL disable text selection, printing affordances, and direct file-URL access for that file while Download_Permission is disabled.

### Requirement 3: Content protection — dynamic forensic watermarking

**User Story:** As an Instructor, I want each student's identity overlaid on the video they watch, so that if a recording leaks I can identify which student leaked it.

#### Acceptance Criteria

1. WHILE a Learner views Protected_Content, THE Lesson_Player SHALL display a Forensic_Watermark overlay containing a per-viewer identifier (e.g. masked email, user id, or enrollment id) and a timestamp.
2. THE Forensic_Watermark SHALL move/reposition periodically and SHALL be rendered above the video layer so it cannot be trivially cropped out of a full-frame capture.
3. THE Forensic_Watermark content SHALL be derived from the authenticated session server-side so a Learner cannot remove or forge it by editing client state.
4. WHERE the platform integrates a provider supporting invisible/session-bound forensic watermarking, THE Web_App SHALL pass the viewer identity needed to bind the stream to the session.
5. THE Web_App SHALL apply the Forensic_Watermark to both recorded lessons and live-session recordings, and SHOULD apply a watermark overlay during live viewing.

### Requirement 4: Content protection — capture deterrence and tamper signals (best-effort, web)

**User Story:** As an Instructor, I want the platform to actively discourage casual screen recording and screenshotting on the web, so that opportunistic piracy is reduced even though it cannot be fully blocked.

#### Acceptance Criteria

1. THE Web_App SHALL disable right-click, drag-save of media/images, and common keyboard download/print shortcuts on Protected_Content pages as a deterrent, while not relying on these as real security.
2. WHEN the page/tab loses focus or visibility on a Protected_Content view, THE Lesson_Player SHALL pause playback and obscure the frame, resuming only on return.
3. WHERE the browser exposes APIs that signal screen-sharing/recording or virtual displays, THE Web_App SHALL detect such signals on a best-effort basis and SHALL pause playback and/or display a warning when detected.
4. THE Web_App SHALL clearly communicate to Learners that capturing or redistributing Protected_Content violates the Terms and is traceable via watermark.
5. THE Web_App SHALL NOT degrade accessibility (e.g. block legitimate assistive technology) in the name of capture deterrence, and SHALL respect `prefers-reduced-motion` for any deterrent animations.

### Requirement 5: Design system modernization (2026 premium)

**User Story:** As any user, I want Bilgim to look and feel like a modern, premium 2026 product, so that I trust it and enjoy using it.

#### Acceptance Criteria

1. THE Web_App SHALL build on the existing Design_System (Apple Liquid Glass Light; primary `#0071E3`; Inter body, Syne display; radius `1rem`; soft elevation) rather than introducing a conflicting palette, and SHALL retire the outdated Pomelo/Forest-green `web-design.md` direction.
2. THE Design_System SHALL express all colors, spacing, radii, shadows, and motion durations as Design_Tokens so the entire UI is themeable from a single source of truth.
3. THE Web_App SHALL apply a minimal, content-first visual language (generous whitespace, clear hierarchy, restrained ornament) consistent with current premium SaaS standards (e.g. Linear-style clarity), avoiding visual noise.
4. THE Web_App SHALL use a consistent component library for buttons, inputs, cards, tabs, modals, drawers, toasts, tables, skeletons, empty states, and badges, with documented variants and sizes.
5. THE Web_App SHALL include purposeful micro-interactions (hover, press, focus, enter/exit transitions) that are subtle, performant, and disabled under `prefers-reduced-motion`.
6. THE Web_App SHALL ship a complete dark mode for all authenticated surfaces, switchable by the user and respecting the OS preference by default.
7. THE Web_App SHALL maintain visual and behavioral consistency across marketing, auth, teacher, student, and admin surfaces (shared shell, navigation, and tokens).

### Requirement 6: Lesson player & on-demand recordings

**User Story:** As a Learner, I want to watch recorded lessons and the recordings of finished live classes on demand, with a smooth, modern player, so that I can learn at my own pace.

#### Acceptance Criteria

1. THE Lesson_Player SHALL play RECORDED, HYBRID, and TEXT_ONLY lesson content and the auto-saved recording of an ENDED live session, subject to Content_Protection (Requirements 1–4).
2. WHEN a live session ends and its recording is finalized, THE Web_App SHALL surface the recording within the corresponding Lesson so Learners can watch it on demand without a separate step.
3. THE Lesson_Player SHALL provide standard learning controls (play/pause, seek within entitlement, playback speed, captions/quality when available, resume from last position) while honoring the no-download constraint.
4. THE Web_App SHALL show lesson navigation (previous/next, lesson list for the Group) and lesson status (e.g. published/locked).
5. WHERE a lesson has attachments, THE Web_App SHALL present them via the rules in Requirement 2 (gated by Download_Permission).
6. WHEN a Learner finishes a lesson, THE Web_App SHALL record progress and MAY present a completion affirmation consistent with gamification.

### Requirement 7: Live class experience (studio + viewer)

**User Story:** As an Instructor, I want a reliable live-class studio, and as a Learner a clean live viewer, so that real-time English classes run smoothly and are always recorded.

#### Acceptance Criteria

1. THE Live_Studio SHALL let an Instructor start, run, and end a live session, with camera/mic/screen-share controls and a visible recording indicator while recording.
2. THE Live_Studio SHALL display the participant list and a live chat, and SHALL communicate connection/quality state.
3. THE Live_Viewer SHALL allow only Learners with APPROVED enrollment to join, SHALL render the stream with the live chat, and SHALL apply the Forensic_Watermark overlay (Requirement 3.5).
4. WHEN a live session ends, THE Web_App SHALL reflect that the recording is being finalized and SHALL surface it in the Lesson once ready (Requirement 6.2).
5. IF a live session enters RECORDING_FAILED, THEN THE Web_App SHALL clearly inform the Instructor and offer guidance/next steps.
6. THE Live experience SHALL be resilient to brief network drops, attempting reconnection and informing the user of status.

### Requirement 8: Instructor course → group → lesson authoring

**User Story:** As an Instructor, I want to create an English course (e.g. IELTS), open multiple level-based groups under it, and add lessons as recorded video, live, or hybrid, so that I can run my classes entirely in Bilgim.

#### Acceptance Criteria

1. THE Web_App SHALL let an Instructor create and edit a Course with title, description, cover, CEFR level, and optional Exam_Track (per the english-only refocus spec), without a generic specialty step.
2. THE Web_App SHALL let an Instructor create multiple Groups under a Course, each with its own name/level, capacity, schedule, price (UZS), and join/invite controls.
3. WHEN an Instructor creates a Lesson, THE Web_App SHALL let them choose lesson type RECORDED, LIVE, HYBRID, or TEXT_ONLY and provide the type-appropriate authoring UI (video upload with progress for RECORDED/HYBRID; schedule for LIVE/HYBRID; rich text for TEXT_ONLY).
4. THE Web_App SHALL provide a chunked/resumable upload experience with visible progress and clear error/retry for lesson videos and attachments.
5. THE Web_App SHALL let an Instructor manage a Group's schedule (recurring via RRULE, timezone Asia/Tashkent) and reflect exceptions/cancellations.
6. THE Web_App SHALL let an Instructor configure Group settings including Download_Permission (Requirement 2) and enabled homework module types.
7. WHILE the Instructor's subscription is EXPIRED or CANCELED, THE Web_App SHALL prevent publishing new lessons and SHALL explain why, linking to billing.

### Requirement 9: Enrollment, invitations, and requests

**User Story:** As an Instructor, I want to invite students and approve/reject their requests, and as a Learner I want to find and join a group, so that class rosters are managed in one place instead of Telegram.

#### Acceptance Criteria

1. THE Web_App SHALL let an Instructor generate invite links (with optional expiry/usage limits) and share join codes for a Group.
2. WHEN a Learner opens an invite link, THE Web_App SHALL present the group/course context and route them through registration/login and the existing Payme + enrollment-request flow.
3. THE Web_App SHALL present Instructors a requests queue showing pending enrollment requests with approve/reject actions and live counts in navigation.
4. WHEN an Instructor approves or rejects a request, THE Web_App SHALL reflect the decision immediately (optimistic update with reconciliation) and notify the Learner per Notifications.
5. THE Web_App SHALL show Learners the status of their enrollment (pending payment, pending approval, approved, rejected).

### Requirement 10: Homework authoring, submission, and grading (English skills)

**User Story:** As an Instructor, I want to assign skill-based homework and grade it (assisted by AI), and as a Learner I want clear interfaces to complete each skill, so that homework stops being scattered chat messages.

#### Acceptance Criteria

1. THE Web_App SHALL let an Instructor build Assignments from the enabled English skill modules for the Group (WRITING, READING, LISTENING, GRAMMAR, SPELLING, VOCABULARY, SPEAKING, PRONUNCIATION) with due dates and points.
2. THE Web_App SHALL provide skill-appropriate Learner UIs: rich-text for WRITING, passage+questions for READING, audio player+prompts for LISTENING, interactive items for GRAMMAR/VOCABULARY/SPELLING, and audio recording for SPEAKING/PRONUNCIATION.
3. WHEN a Learner works on a submission, THE Web_App SHALL autosave drafts and clearly indicate saved/submitting/submitted states.
4. WHEN a SPEAKING/PRONUNCIATION submission is made, THE Web_App SHALL upload the audio as a protected MediaAsset and reflect AI scoring status when available.
5. THE Web_App SHALL give Instructors a grading queue (filter by status, e.g. ungraded) showing AI-draft scores/feedback and AI-likelihood flags, with controls to adjust and finalize grades.
6. WHEN a submission is graded, THE Web_App SHALL show the Learner their score and structured feedback and notify them.

### Requirement 11: BilgimAI tutor & assistant

**User Story:** As a Learner, I want an AI tutor that helps me practice English without doing my homework for me; as an Instructor, I want AI assistance for grading and content, so that we both work faster.

#### Acceptance Criteria

1. THE Web_App SHALL provide a BilgimAI chat surface with intents (EXPLAIN, TRANSLATE, EXAMPLE) for Learners and grading/assist intents for Instructors.
2. THE BilgimAI UI SHALL stream responses, show intent selection, and display rate-limit state clearly.
3. THE BilgimAI UI SHALL communicate that the tutor gives hints/guidance and will not produce verbatim submittable answers.
4. THE Web_App SHALL make BilgimAI reachable from a consistent, discoverable entry point across relevant surfaces, themed with the AI purple accent.
5. WHERE an AI action has a cost/latency, THE Web_App SHALL provide responsive loading affordances and graceful error/retry.

### Requirement 12: Gamification UI (XP, streaks, badges, leaderboard, rewards)

**User Story:** As a Learner, I want visible XP, streaks, badges, leaderboard, and a rewards shop, so that learning English stays motivating — something Telegram/Zoom cannot offer.

#### Acceptance Criteria

1. THE Web_App SHALL display the Learner's XP, current level, and streak in a persistent, glanceable location.
2. WHEN a Learner earns XP or levels up, THE Web_App SHALL present a non-disruptive, celebratory affirmation respecting `prefers-reduced-motion`.
3. THE Web_App SHALL provide an achievements view (earned/locked badges with rarity), a leaderboard view, and a rewards shop where XP is spent on reward items.
4. THE Web_App SHALL present daily challenges and their progress.
5. THE gamification visuals SHALL be consistent with the Design_System and localized.

### Requirement 13: Billing & subscription (Payme)

**User Story:** As an Instructor, I want clear subscription, trial, and payment management, so that I understand my plan and pay seamlessly via Payme.

#### Acceptance Criteria

1. THE Web_App SHALL show the current subscription state (TRIAL, ACTIVE, PAST_DUE, CANCELED, EXPIRED) with appropriate visual treatment and, during trial, a countdown.
2. THE Web_App SHALL present available plans (UZS pricing) with comparison and let the Instructor start/upgrade/cancel, routing payments through the existing Payme flow.
3. THE Web_App SHALL display invoice history and payment status.
4. WHEN a payment is required or fails, THE Web_App SHALL surface clear, actionable states and recovery paths.
5. WHILE PAST_DUE/EXPIRED, THE Web_App SHALL communicate restrictions (e.g. cannot publish lessons) and the path to resolve them.

### Requirement 14: Notifications & messaging

**User Story:** As any user, I want in-app notifications and direct messaging, so that all course communication lives in Bilgim instead of Telegram.

#### Acceptance Criteria

1. THE Web_App SHALL present an in-app notification center with unread indicators in navigation and mark-as-read behavior.
2. THE Web_App SHALL reflect notification kinds (enrollment, payment, lesson published, live started/reminder, homework assigned/graded, AI review ready, level-up, billing) with clear copy and deep links.
3. THE Web_App SHALL provide direct messaging between Instructors and Learners with unread counts and real-time delivery.
4. WHERE real-time transport is available, THE Web_App SHALL update notifications, messages, requests, and live presence without manual refresh.
5. THE Web_App SHALL let users manage notification channel preferences (in-app, email, Telegram, push).

### Requirement 15: Public marketing & discovery

**User Story:** As a visitor, I want a compelling marketing site and a way to discover English instructors/courses by level, so that I understand Bilgim's value and can find the right teacher.

#### Acceptance Criteria

1. THE Web_App SHALL provide modern marketing pages (teacher landing, student landing, pricing, about, FAQ, legal) consistent with the Design_System and conversion-focused CTAs.
2. THE Web_App SHALL provide discovery/search of discoverable, published English courses and instructors, filterable by CEFR level and Exam_Track (replacing specialty facets).
3. THE Web_App SHALL provide public instructor profile pages (`/t/{slug}`) showing courses, headline, rating, and a contact/enroll path.
4. THE marketing and discovery pages SHALL be responsive, performant, and SEO-appropriate (server-rendered, correct metadata).
5. WHEN a visitor chooses to enroll, THE Web_App SHALL route through registration/login and the existing Payme + enrollment flow.

### Requirement 16: Authentication, onboarding & account security

**User Story:** As a user, I want smooth, secure sign-up/sign-in and (for instructors) a short English-focused onboarding, so that I can start quickly and keep my account safe.

#### Acceptance Criteria

1. THE Web_App SHALL provide register (role selection Learner/Instructor), login, email verification, forgot/reset password flows with clear validation and localized error messages from the API error catalog.
2. THE Web_App SHALL onboard Instructors with a short English-teaching setup (taught CEFR levels, Exam_Track focus) and no generic specialty step, routing to the instructor dashboard on completion.
3. THE Web_App SHALL support MFA enrollment and challenge (TOTP/WebAuthn) and backup codes where the account requires it.
4. WHEN authentication or token refresh fails, THE Web_App SHALL handle session expiry gracefully and route to login without data loss where possible.
5. THE Web_App SHALL not expose role-restricted routes to the wrong role and SHALL render an appropriate not-authorized state.

### Requirement 17: Admin console

**User Story:** As an Admin, I want to manage users, English levels/module catalog, content, AI prompts, plans, and audit logs, so that I can operate the platform.

#### Acceptance Criteria

1. THE Web_App SHALL provide an admin dashboard with platform KPIs and recent activity.
2. THE Web_App SHALL let Admins manage users, the English module catalog and Exam_Track options, CMS content, AI prompt templates, plans, and view audit logs.
3. THE admin surfaces SHALL use consistent data-table patterns (sort, filter, paginate) and confirm destructive actions.
4. THE Web_App SHALL record/reflect that administrative changes are audit-logged.

### Requirement 18: Responsive & mobile-web experience

**User Story:** As a user on a phone, I want every screen to work well on small viewports, so that I can teach/learn on the go.

#### Acceptance Criteria

1. THE Web_App SHALL be mobile-first and fully responsive across `sm`–`2xl` breakpoints.
2. WHERE the desktop uses a sidebar, THE Web_App SHALL provide an equivalent mobile navigation (e.g. bottom tab bar / drawer).
3. THE Web_App SHALL ensure touch targets are at least 44×44px and that interactive elements are reachable and legible on mobile.
4. THE Lesson_Player and Live experiences SHALL adapt to mobile layouts while preserving Content_Protection.

### Requirement 19: Accessibility (WCAG AA)

**User Story:** As a user with assistive needs, I want Bilgim to be accessible, so that I can use it effectively.

#### Acceptance Criteria

1. THE Web_App SHALL use semantic HTML and appropriate ARIA for all interactive components.
2. THE Web_App SHALL be fully keyboard operable (focus order, visible focus rings, Esc/Enter/Arrow handling for overlays and menus).
3. THE Web_App SHALL meet WCAG_AA color contrast (≥4.5:1 normal text, ≥3:1 large text/UI) in both light and dark modes.
4. THE Web_App SHALL respect `prefers-reduced-motion` and provide text alternatives for meaningful non-text content.
5. NOTE: Full WCAG conformance requires manual testing with assistive technologies and expert review; automated checks alone are insufficient and SHALL be complemented by manual audits.

### Requirement 20: Performance & reliability

**User Story:** As a user, I want fast loads and responsive interactions, so that the product feels premium and dependable.

#### Acceptance Criteria

1. THE Web_App SHALL meet good Core_Web_Vitals targets (LCP, INP, CLS) on key authenticated and marketing pages on mid-range devices.
2. THE Web_App SHALL use server components, code-splitting, image optimization, and font preloading to minimize payload and layout shift.
3. THE Web_App SHALL show skeleton loaders and optimistic UI for primary data fetches and mutations, and SHALL handle loading, empty, and error states for every data-backed view.
4. THE Web_App SHALL degrade gracefully on slow/unstable networks and surface actionable errors (no silent failures).

### Requirement 21: Internationalization (uz / ru / en)

**User Story:** As an Uzbek user, I want the interface in Uzbek (default), Russian, or English, so that I can use Bilgim comfortably while learning English as the subject.

#### Acceptance Criteria

1. THE Web_App SHALL localize all user-facing copy via `packages/i18n` for `uz` (default), `ru`, and `en`, with no hard-coded user-facing strings.
2. THE Web_App SHALL keep the interface chrome localized even though the taught subject is English, and SHALL let users switch Locale with persistence.
3. THE Web_App SHALL format numbers, currency (UZS), and dates per Locale (timezone Asia/Tashkent where relevant).
4. WHERE entity names are stored tri-lingually (badges, plans, levels), THE Web_App SHALL render the field matching the active Locale.

## Open Questions / Clarifications Needed

These affect scope and should be confirmed during design.

1. **Video/DRM provider**: Which managed Multi_DRM + watermarking provider do we adopt (e.g. VdoCipher, Gumlet, Mux, Bunny Stream), versus self-hosting DRM? This determines the player SDK, watermarking capability, and cost. (Self-hosting multi-DRM + FairPlay licensing is significantly more complex.)
2. **Watermark style**: Visible per-viewer overlay only, invisible/forensic (provider-bound), or both? Visible deters; invisible survives re-encoding but needs provider support.
3. **FairPlay/Apple scope**: Do we require protected playback on Safari/iOS web at launch (needs FairPlay + HTTPS certificate setup), or is iOS handled primarily by the native mobile app?
4. **Native mobile protection**: Is `apps/mobile` in scope for this frontend effort, or web-ondesignly now with mobile to follow? OS-level capture blocking (FLAG_SECURE) lives in the native app.
5. **Live streaming stack**: Confirm the live transport in production (LiveKit vs mediasoup) and the recording → MediaAsset finalization path the Web_App should reflect.
6. **Dark mode priority**: Ship dark mode in the first redesign pass or as a fast-follow? (Requirement 5.6 assumes first pass.)
7. **Marketing scope**: Full marketing redesign (landing/pricing/about/FAQ/legal) included now, or focus on authenticated app surfaces firsdesignt?
8. **Spec language**: Keep this spec in English (consistent with `english-only-platform-refocus`) or author a parallel Uzbek version for the team?
9. **Offline viewing**: Is offline lesson access desired? It conflicts with strict Content_Protection and would need DRM offline licenses — likely deferred.
10. **Capture-detection aggressiveness**: How aggressive should best-effort screen-recording detection be (e.g. pause on any screen-share) given false positives may harm legitimate users on calls/extensions?
design