# Implementation Plan: EduBridge Platform

## Overview

EduBridge platformasini bosqichma-bosqich (Phase 1–9) amalga oshirish rejasi. Har bir task oldingi tasklarga asoslangan holda incremental progress ta'minlaydi. Stack: Next.js 14 (App Router) + NestJS + Prisma + PostgreSQL + Redis + BullMQ + Socket.io + Cloudflare R2 + Claude API + Payme + mediasoup + Docker.

## Tasks

- [x] 1. Monorepo skeleton va infratuzilma sozlash
  - [x] 1.1 Monorepo yaratish (pnpm workspace + Turborepo)
    - `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json` yaratish
    - `apps/api`, `apps/web`, `packages/db`, `packages/ui`, `packages/config`, `packages/shared-types`, `packages/i18n` papkalarini yaratish
    - Root `package.json` va workspace scripts sozlash
    - _Requirements: 20.1, 26_

  - [x] 1.2 NestJS API app skeleton yaratish
    - `apps/api` ichida NestJS project (`app.module.ts`, `main.ts`)
    - Common guards (`jwt-auth.guard.ts`, `roles.guard.ts`), interceptors (`idempotency.interceptor.ts`, `logging.interceptor.ts`), filters (`all-exceptions.filter.ts`), pipes (`zod-validation.pipe.ts`) yaratish
    - Config module (zod env schema) va health controller
    - _Requirements: 17.2, 25, 26_

  - [x] 1.3 Next.js 14 Web app skeleton yaratish
    - `apps/web` ichida Next.js 14 App Router project
    - Tailwind CSS + shadcn/ui sozlash
    - `middleware.ts` (auth redirect), `lib/api-client.ts`, `lib/auth.ts` yaratish
    - i18n (uz, ru, en) konfiguratsiyasi
    - _Requirements: 20.2_

  - [x] 1.4 Prisma schema va database sozlash
    - `packages/db/prisma/schema.prisma` — barcha jadvallar (User, Session, TeacherProfile, Specialty, Subscription, Course, Group, Lesson, etc.)
    - `pg_trgm` extension yoqish, partial unique indexlar
    - `enforce_specialty_module_cap()` constraint trigger yaratish
    - Seed script (`prisma/seed.ts`) — test specialty va admin user
    - _Requirements: 3.7, 11.1, 21.8_

  - [x] 1.5 Redis, BullMQ va Outbox infra modullarini yaratish
    - `infra/redis/redis.module.ts` va `redis.service.ts`
    - `infra/bullmq/bullmq.module.ts` va queue definitions
    - `infra/outbox/outbox.service.ts`, `outbox.dispatcher.ts`, `outbox.module.ts`
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5_

  - [x] 1.6 Docker Compose va CI sozlash
    - `infra/docker/docker-compose.yml` (PostgreSQL, Redis, MinIO for R2 emulation)
    - GitHub Actions CI (`infra/github-actions/ci.yml`) — lint, test, build
    - `.env.example` fayli
    - _Requirements: 26_

- [x] 2. Auth module — ro'yxatdan o'tish, login, JWT, sessiya boshqaruvi
  - [x] 2.1 Auth module CRUD va registration implementatsiyasi
    - `modules/auth/auth.module.ts`, `auth.controller.ts`, `auth.service.ts`, `tokens.service.ts`
    - `POST /auth/register` — email, parol, fullName, role; User(status=PENDING_VERIFY) yaratish
    - Email verification token yaratish va outbox event emit qilish
    - Parolni Argon2id (m=19MiB, t=2, p=1) bilan hash qilish
    - `repositories/users.repository.ts`
    - _Requirements: 1.1, 1.8_

  - [x] 2.2 Email verification va login implementatsiyasi
    - `POST /auth/verify-email` — token tekshirish, User.status=ACTIVE ga o'zgartirish
    - `POST /auth/login` — email + parol, accessToken (JWT 15min) + refreshToken (opaque 30d) qaytarish
    - RefreshToken ni DB da hash qilib saqlash
    - Noto'g'ri parol uchun 401 UNAUTHENTICATED
    - _Requirements: 1.2, 1.3, 1.5, 1.9_

  - [x] 2.3 Token refresh va session management
    - `POST /auth/refresh` — eski refreshToken bekor qilish, yangi juftlik qaytarish
    - Token family detection — o'g'irlangan token aniqlansa barcha sessiyalarni bekor qilish
    - `POST /auth/password-reset/request` va `POST /auth/password-reset/confirm`
    - Cookie settings: HttpOnly, Secure, SameSite=Lax
    - _Requirements: 1.4, 1.6, 1.7, 21.2, 21.3_

  - [x] 2.4 Property test: Enrollment access invariant (Property 1)
    - **Property 1: Enrollment access invariant**
    - fast-check bilan random (user, lesson, enrollment) triples generatsiya qilish
    - `canRead(user, lesson)` faqat ADMIN, owning TEACHER yoki APPROVED STUDENT uchun true qaytarishini tekshirish
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**

  - [x] 2.5 Unit testlar: Auth module
    - Registration, login, refresh, password reset uchun unit testlar
    - Token family detection edge case testlari
    - Argon2id hash verification testi
    - _Requirements: 1.1–1.9_

- [x] 3. Teacher onboarding va specialty module
  - [x] 3.1 Teacher module va onboarding quiz implementatsiyasi
    - `modules/teacher/teacher.module.ts`, `teacher.controller.ts`, `onboarding.service.ts`, `specialty.service.ts`
    - `GET /teacher/onboarding/questions` — quiz savollarini qaytarish
    - `POST /teacher/onboarding/answers` — javoblar asosida specialtyId tayinlash (rule-based, 55% dan past bo'lsa Claude fallback)
    - TeacherProfile yaratish va specialty-specific dashboard ga redirect
    - _Requirements: 2.2, 2.3, 2.4, 2.5_

  - [x] 3.2 Trial subscription avtomatik yaratish
    - Email verification muvaffaqiyatli bo'lganda Billing_Module.startTrial(userId) chaqirish
    - Subscription(status=TRIAL, trialEndsAt=now+14d) yaratish
    - Trial davomida Invoice yaratmaslik logikasi
    - _Requirements: 2.1, 3.2, 3.3_

  - [x]* 3.3 Property test: Trial/billing exclusivity (Property 2)
    - **Property 2: Trial / billing exclusivity**
    - fast-check bilan random teacher subscription holatlarini generatsiya qilish
    - Bir vaqtda faqat bitta non-terminal subscription mavjudligini tekshirish
    - TRIAL holatida TEACHER_SUBSCRIPTION invoice yo'qligini tekshirish
    - **Validates: Requirements 3.2, 3.7**

  - [x]* 3.4 Property test: Subscription state machine valid transitions (Property 12)
    - **Property 12: Subscription state machine valid transitions**
    - fast-check bilan random event ketma-ketliklarini generatsiya qilish
    - Faqat valid transitions (TRIAL→ACTIVE, TRIAL→EXPIRED, ACTIVE→PAST_DUE, etc.) sodir bo'lishini tekshirish
    - Invalid transitions reject qilinishini tekshirish
    - **Validates: Requirements 3.1, 3.3, 3.4, 3.5, 3.6**

- [x] 4. Billing module — Subscription state machine va Payme integratsiyasi
  - [x] 4.1 Subscription state machine implementatsiyasi
    - `modules/billing/subscription-state-machine.ts` — TRIAL → ACTIVE → PAST_DUE → CANCELED/EXPIRED
    - Trial tugashi (14 kun) → EXPIRED ga o'tkazish (cron job)
    - PAST_DUE da 7 kun o'tsa → EXPIRED ga o'tkazish
    - Partial unique index: bitta teacher uchun bitta non-terminal subscription
    - EXPIRED/CANCELED holatida yangi dars publish taqiqlash
    - _Requirements: 3.1, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [x] 4.2 Payme webhook controller va service
    - `modules/billing/payme/payme.controller.ts`, `payme.service.ts`, `payme-auth.guard.ts`
    - JSON-RPC methods: CheckPerformTransaction, CreateTransaction, PerformTransaction, CancelTransaction
    - Basic Auth + IP allowlist tekshiruvi
    - Noto'g'ri auth uchun -32504 xatosi va security audit log
    - _Requirements: 4.3, 21.7_

  - [x] 4.3 Payment atomicity va enrollment request yaratish
    - `POST /billing/checkout` — PaymeTransaction(state=PENDING) + Invoice yaratish, payUrl qaytarish
    - PerformTransaction webhook: bitta DB tranzaktsiya ichida PaymeTransaction.state=PAID, Invoice.status=PAID, EnrollmentRequest, OutboxEvent yaratish
    - invoice.kind=STUDENT_COURSE → EnrollmentRequest(PENDING_APPROVAL)
    - invoice.kind=TEACHER_SUBSCRIPTION → Subscription ACTIVE ga o'tkazish
    - Idempotent webhook: bir xil paymeId bilan ikki marta chaqirilsa oldingi natija qaytarish
    - Unique idempotencyKey har bir PaymeTransaction uchun
    - _Requirements: 4.1, 4.2, 4.4, 4.5, 4.6, 4.7, 4.8_

  - [x]* 4.4 Property test: Payment to Enrollment atomicity (Property 5)
    - **Property 5: Payment to Enrollment atomicity**
    - Webhook ni 5x concurrent chaqirish (chaos test)
    - Faqat bitta Invoice update, bitta EnrollmentRequest, bitta OutboxEvent yaratilishini tekshirish
    - Idempotent behavior tekshiruvi
    - **Validates: Requirements 4.2, 4.4, 4.5, 19.4**

  - [x]* 4.5 Unit testlar: Billing module
    - Subscription state transitions uchun unit testlar
    - Payme webhook idempotency testlari
    - Invalid amount va account not found error handling
    - _Requirements: 4.1–4.8_

- [x] 5. Checkpoint — Auth, Billing, Teacher modullar tekshiruvi
  - Barcha testlar pass bo'lishini tekshiring, savollar bo'lsa foydalanuvchidan so'rang.

- [x] 6. Enrollment module — invite link, so'rov, tasdiqlash
  - [x] 6.1 Enrollment module CRUD implementatsiyasi
    - `modules/enrollment/enrollment.module.ts`, controller, service, repository
    - `POST /enrollment/invite-links` — unique token, expiresAt, usesLimit bilan InviteLink yaratish
    - `GET /enrollment/invite/:token` — guruh ma'lumotlari va narxini qaytarish
    - Muddati o'tgan yoki limit tugagan invite uchun 404
    - _Requirements: 5.1, 5.2, 5.7_

  - [x] 6.2 Enrollment approval va rejection flow
    - `POST /enrollment/requests/:id/approve` — Enrollment(status=APPROVED) yaratish, talabaga xabarnoma
    - `POST /enrollment/requests/:id/reject` — EnrollmentRequest.status=REJECTED
    - Unique constraint: (groupId, studentId) juftligi uchun faqat bitta Enrollment
    - _Requirements: 5.3, 5.4, 5.5, 5.6_

  - [x] 6.3 Enrollment-gated lesson access guard
    - `common/guards/lesson-access.guard.ts` implementatsiyasi
    - Student: Enrollment(groupId, studentId, status=APPROVED) tekshiruvi → 403 LESSON_ACCESS_DENIED
    - Teacher: lesson.group.course.teacherId = user.id → 403 NOT_OWNING_TEACHER
    - Admin: read-only audit ruxsati
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x]* 6.4 Unit testlar: Enrollment module
    - Invite link yaratish, resolve, expiry testlari
    - Approval/rejection flow testlari
    - Access guard edge case testlari
    - _Requirements: 5.1–5.7, 6.1–6.6_

- [x] 7. Catalog module — Course, Group, Lesson CRUD
  - [x] 7.1 Course va Group CRUD implementatsiyasi
    - `modules/catalog/catalog.module.ts`, `courses.controller.ts`, `groups.controller.ts`, `catalog.service.ts`
    - `POST /catalog/courses` — Course(isPublished=false, isDiscoverable=true) yaratish
    - `POST /catalog/courses/:id/groups` — Group yaratish + GroupModule seed (specialty katalogidan)
    - Barcha so'rovlar JWT teacherId bilan parametrize (cross-teacher access imkonsiz)
    - _Requirements: 7.1, 7.2, 7.3, 7.7_

  - [x] 7.2 Lesson CRUD va publish flow
    - `modules/catalog/lessons.controller.ts`
    - `POST /catalog/lessons` — Lesson(status=DRAFT) yaratish
    - `PATCH /catalog/lessons/:id/publish` — status=READY, lesson.published event emit
    - EXPIRED subscription bo'lsa publish taqiqlash (403 SUBSCRIPTION_EXPIRED)
    - lesson.published → notification fan-out trigger
    - _Requirements: 7.4, 7.5, 7.6, 3.8_

  - [x]* 7.3 Property test: Group module seeding (Property 13)
    - **Property 13: Group module seeding matches specialty catalog**
    - fast-check bilan random specialty kataloglari (1-10 modul) generatsiya qilish
    - Group yaratilganda GroupModule set specialty katalogiga mos kelishini tekshirish
    - isEnabled = defaultEnabled qiymatini tekshirish
    - **Validates: Requirements 7.2, 7.3, 11.2**

  - [x]* 7.4 Unit testlar: Catalog module
    - Course/Group/Lesson CRUD testlari
    - GroupModule seeding testlari
    - teacherId isolation testlari
    - _Requirements: 7.1–7.7_

- [x] 8. Notifications module — multi-channel fan-out
  - [x] 8.1 Notifications module core implementatsiyasi
    - `modules/notifications/notifications.module.ts`, controller, service
    - Notification yaratish (idempotencyKey bilan ON CONFLICT DO NOTHING)
    - NotificationPreference CRUD (per-kind per-channel enabled/disabled)
    - Qo'llab-quvvatlanadigan turlar: ENROLLMENT_APPROVED, LESSON_PUBLISHED, SCHEDULE_CHANGED, LIVE_STARTED, LIVE_REMINDER, HOMEWORK_GRADED, PAYMENT_SUCCEEDED, TRIAL_ENDING
    - _Requirements: 16.1, 16.2, 16.3, 16.4_

  - [x] 8.2 Notification delivery workers (email, telegram, push)
    - `workers/notification-fanout.processor.ts` — fan-out logic
    - `workers/email.processor.ts` — SES/SMTP orqali email yuborish
    - `workers/telegram.processor.ts` — Telegram Bot API orqali xabar
    - Retry logic: exponential backoff
    - NotificationDelivery uchun providerRef saqlash
    - _Requirements: 16.5, 16.6_

  - [x]* 8.3 Property test: Notification fan-out idempotency (Property 3)
    - **Property 3: Notification fan-out idempotency**
    - Worker ni 3x retry simulatsiya qilish
    - Total Notification rows = |students| bo'lishini tekshirish
    - idempotencyKey format: "schedule.changed:{groupId}:v{version}:{studentId}"
    - **Validates: Requirements 10.2, 10.3, 10.4, 10.6**

- [x] 9. Idempotency va RBAC infratuzilmasi
  - [x] 9.1 Idempotency interceptor implementatsiyasi
    - `common/interceptors/idempotency.interceptor.ts`
    - Idempotency-Key header qo'llab-quvvatlash (24 soat Redis cache)
    - Bir xil key + boshqa payload → 409 IDEMPOTENCY_CONFLICT
    - IdempotencyRecord 24 soatdan keyin tozalash
    - _Requirements: 19.1, 19.2, 19.3, 18.6_

  - [x] 9.2 RBAC guards va authorization completeness
    - `common/guards/roles.guard.ts` — @Roles() decorator bilan ishlash
    - Har bir controller route uchun @Public() yoki auth guard mavjudligini ta'minlash
    - ESLint custom rule: guard yo'q route uchun xato berish
    - Runtime check: `app.bootstrap.ts` da barcha route metadata scan
    - Rate limiting: Redis token bucket (IP + user bo'yicha)
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 21.4, 21.5_

  - [x]* 9.3 Property test: Idempotency-Key produces same response (Property 14)
    - **Property 14: Idempotency-Key produces same response**
    - fast-check bilan random valid requestlar generatsiya qilish
    - Har birini ikki marta yuborish, response mos kelishini tekshirish
    - Boshqa payload bilan bir xil key → 409 tekshiruvi
    - **Validates: Requirements 19.1, 19.2, 18.6**

  - [x]* 9.4 Property test: Authorization completeness (Property 7)
    - **Property 7: Authorization completeness**
    - Barcha controller route handlerlarni scan qilish
    - Har biri @Public() yoki JwtAuthGuard + Roles/domain guard bilan himoyalanganini tekshirish
    - **Validates: Requirements 17.3, 17.4**

- [x] 10. Checkpoint — MVP Foundation (Phase 1) yakunlash
  - Barcha testlar pass bo'lishini tekshiring, savollar bo'lsa foydalanuvchidan so'rang.

- [x] 11. Media module — R2 upload va video transcoding (Phase 3)
  - [x] 11.1 R2 multipart upload implementatsiyasi
    - `modules/media/media.module.ts`, controller, service
    - `infra/r2/r2.service.ts` — S3-compatible client (Cloudflare R2)
    - `POST /media/uploads` — multipart upload initiate, uploadId + presigned partUrls qaytarish
    - `POST /media/uploads/:id/complete` — CompleteMultipartUpload, MediaAsset.status=UPLOADED
    - Ruxsat etilgan fayl turlari: PDF, DOCX, XLSX, images, audio, video
    - 24 soat ichida complete bo'lmagan uploadlarni cron bilan tozalash
    - _Requirements: 8.1, 8.2, 8.6, 8.7_

  - [x] 11.2 Video transcoding pipeline (BullMQ + ffmpeg)
    - `workers/transcoding.processor.ts`
    - MediaAsset UPLOADED → BullMQ transcoding job queue
    - ffmpeg orqali HLS formatida variantlar: 240p, 480p, 720p, 1080p
    - Transcoding tugaganda MediaAsset.status=READY, hlsManifestKey saqlash
    - R2 ga manifest + segments upload
    - _Requirements: 8.3, 8.4, 8.5_

  - [x] 11.3 R2 signed URL va media access
    - Signed URL generation (6 soatdan oshmaydigan TTL)
    - Lesson player uchun HLS manifest URL qaytarish
    - _Requirements: 21.6_

  - [x]* 11.4 Unit testlar: Media module
    - Multipart upload flow testlari
    - Transcoding job queue testlari
    - File type validation testlari
    - _Requirements: 8.1–8.7_

- [x] 12. Live streaming module (Phase 4)
  - [x] 12.1 mediasoup SFU service yaratish
    - `apps/sfu/src/index.ts`, `worker.ts`, `router.ts`, `transport.ts`, `recorder.ts`, `api.ts`
    - mediasoup Worker va Router management
    - Internal HTTP API (live module uchun)
    - _Requirements: 9.1, 20.5, 20.6_

  - [x] 12.2 Live session lifecycle implementatsiyasi
    - `modules/live/live.module.ts`, `live.controller.ts`, `live.gateway.ts`
    - `POST /live/sessions/:lessonId/start` — LiveSession(STARTING → LIVE), router allocate
    - `POST /live/sessions/:id/end` — router close, recording finalize
    - Enrollment tekshiruvi (faqat APPROVED talabalar)
    - live.started notification emit
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [x] 12.3 Recording orchestration va finalization
    - `modules/live/recorder.orchestrator.ts`
    - ffmpeg pipe spawn (RTP → recording)
    - Recording finalize: HLS package → R2 upload
    - Muvaffaqiyatli: Recording(status=READY) + Attachment + LiveSession(ENDED)
    - Muvaffaqiyatsiz: LiveSession(RECORDING_FAILED) + Recording(status=FAILED)
    - LiveSession hech qachon LIVE holatida qolmasligi kafolati
    - _Requirements: 9.5, 9.6, 9.7, 9.8_

  - [x] 12.4 Real-time chat (Socket.io) live efir uchun
    - `modules/chat/chat.module.ts`, chat gateway (Socket.io)
    - Live efir davomida real-time chat xabarlari
    - ChatRoom(scope=LIVE) yaratish va xabarlarni persist qilish
    - _Requirements: 9.9_

  - [x]* 12.5 Property test: Live recording completion (Property 6)
    - **Property 6: Live recording completion**
    - Finalize success va failure pathlarni simulatsiya qilish
    - State machine hech qachon LIVE holatida qolmasligini tekshirish
    - ENDED → READY Recording + Attachment mavjudligini tekshirish
    - **Validates: Requirements 9.6, 9.7, 9.8**

  - [x]* 12.6 Unit testlar: Live module
    - Session lifecycle state transitions testlari
    - Enrollment check testlari
    - Recording orchestration testlari
    - _Requirements: 9.1–9.9_

- [x] 13. Checkpoint — Media va Live modullar tekshiruvi
  - Barcha testlar pass bo'lishini tekshiring, savollar bo'lsa foydalanuvchidan so'rang.

- [x] 14. Schedule va Notification fan-out (Phase 5)
  - [x] 14.1 Schedule module implementatsiyasi
    - `modules/catalog/schedule.controller.ts`
    - RRULE formatida guruh jadvali o'rnatish/o'zgartirish
    - Schedule.version ni 1 ga oshirish
    - schedule.changed outbox event yaratish
    - ScheduleException management
    - _Requirements: 10.1_

  - [x] 14.2 Schedule change notification fan-out
    - schedule.changed event handler
    - Guruhga APPROVED enrollment bilan ro'yxatdan o'tgan har bir talabaga Notification yaratish
    - idempotencyKey = "schedule.changed:{groupId}:v{version}:{studentId}"
    - ON CONFLICT DO NOTHING (takroriy notification oldini olish)
    - _Requirements: 10.2, 10.3, 10.4, 10.6_

  - [x] 14.3 Multi-channel delivery va notification preferences
    - NotificationPreference asosida IN_APP, EMAIL, TELEGRAM, PUSH kanallarga delivery job qo'shish
    - Per-kind per-channel enabled/disabled holat saqlash
    - Live reminder: 15 daqiqa qolganda xabarnoma
    - _Requirements: 10.5, 10.7, 16.1, 16.2, 16.3_

  - [x]* 14.4 Property test: Schedule monotonic versioning (Property 8)
    - **Property 8: Schedule monotonic versioning**
    - fast-check bilan random schedule updatelarni generatsiya qilish
    - Version counter har safar aynan 1 ga oshishini tekshirish
    - ScheduleException real RRULE occurrence ga reference qilishini tekshirish
    - **Validates: Requirements 10.1**

- [x] 15. Public Discovery va DM (Phase 5 davomi)
  - [x] 15.1 Discovery module implementatsiyasi
    - `modules/discovery/discovery.module.ts`, controller, service
    - PostgreSQL full-text search + pg_trgm trigram qidiruv
    - `GET /discovery/teachers` — specialtyId va q parametrlari bilan qidiruv
    - `GET /discovery/teachers/:slug` — public profil (faqat isDiscoverable=true kurslar)
    - Faqat isDiscoverable=true va isPublished=true natijalar
    - publicSlug=NULL bo'lgan o'qituvchilarni exclude qilish
    - Read replica dan o'qish, Redis 30s cache
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7_

  - [x] 15.2 DM (Direct Messaging) implementatsiyasi
    - ChatRoom(scope=DM, scopeRef=sorted pair) lazy yaratish
    - UNIQUE constraint: (scope, scopeRef) — bitta DM room per pair
    - Rate limit: reciprocated bo'lmagan holatda 1 msg/min, reciprocated bo'lsa global limit (30 msg/min)
    - Faqat STUDENT va TEACHER rollari uchun ruxsat
    - DM xabari → notification trigger
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7_

  - [x] 15.3 Property test: Discovery visibility (Property 10)
    - **Property 10: Discovery visibility respects isDiscoverable**
    - Mixed discoverable/non-discoverable rowlarni seed qilish
    - /discovery/* response faqat expected subset ni qaytarishini tekshirish
    - publicSlug=NULL teacher qidiruv natijalarida ko'rinmasligini tekshirish
    - **Validates: Requirements 14.2, 14.3, 14.4**

  - [x] 15.4 Property test: DM rate-limit until reciprocated (Property 11)
    - **Property 11: DM rate-limit until reciprocated**
    - Stateful fast-check model: sendDm actions ketma-ketligi generatsiya qilish
    - Reciprocated bo'lmagan holatda 60s ichida ikkinchi xabar 429 qaytarishini tekshirish
    - Reciprocated bo'lganda faqat global limit qo'llanishini tekshirish
    - UNIQUE constraint (scope, scopeRef) buzilmasligini tekshirish
    - **Validates: Requirements 15.2, 15.3, 15.4, 15.5**

- [x] 16. Checkpoint — Phase 5 yakunlash
  - Barcha testlar pass bo'lishini tekshiring, savollar bo'lsa foydalanuvchidan so'rang.

- [x] 17. Homework module — katalog, toggle, assignment builder (Phase 6)
  - [x] 17.1 Homework module core va specialty catalog
    - `modules/homework/homework.module.ts`, controller, service
    - Admin: SpecialtyModule CRUD (per-Specialty ≤10 active modul)
    - `enforce_specialty_module_cap()` trigger + service-layer guard
    - 11-chi active modul qo'shishda specialty_module_cap_exceeded xatosi
    - _Requirements: 11.1, 11.7_

  - [x] 17.2 Per-Group module toggle implementatsiyasi
    - `PUT /catalog/groups/:id/modules` — GroupModule.isEnabled toggle
    - group.module.toggled event emit
    - Non-destructive toggle: mavjud Assignment/Submission buzilmasligi
    - Specialty katalogida mavjud bo'lmagan moduleType uchun MODULE_NOT_IN_SPECIALTY_CATALOG xatosi
    - _Requirements: 11.2, 11.3, 11.4, 11.6_

  - [x] 17.3 AssignmentBuilder va assignment yaratish
    - `GET /homework/available-modules?groupId=...` — faqat GroupModule.isEnabled=true modullar
    - `POST /homework/assignments` — assignment yaratish
    - Server-side validation: har bir modul uchun GroupModule.isEnabled=true tekshiruvi (UI bypass himoyasi)
    - _Requirements: 11.5, 11.8_

  - [x]* 17.4 Property test: Group-scoped homework module toggle (Property 9)
    - **Property 9: Group-scoped homework module toggle**
    - P9a: Assignment faqat ENABLED modullarni o'z ichiga olishini tekshirish
    - P9b: GroupModule faqat specialty katalogidagi modullar uchun mavjudligini tekshirish
    - P9c: Per-specialty ≤10 active modul cap tekshiruvi
    - Toggle OFF qilish eski assignmentlarni buzmasligini tekshirish
    - **Validates: Requirements 11.1, 11.4, 11.5, 11.6, 11.7, 11.8**

- [x] 18. Submission lifecycle va grading (Phase 6 davomi)
  - [x] 18.1 Submission lifecycle implementatsiyasi
    - DRAFT → SUBMITTED → IN_REVIEW → GRADED → RETURNED state machine
    - Autosave: har 10 soniyada Submission.answersJson saqlash (DRAFT holatida)
    - `POST /homework/submissions/:id/submit` — status=SUBMITTED, submittedAt belgilash
    - Unique constraint: (assignmentId, studentId) juftligi uchun bitta Submission
    - _Requirements: 12.1, 12.2, 12.7, 12.8_

  - [x] 18.2 AI grading precheck va feedback
    - SUBMITTED → BullMQ AI grading precheck job
    - `workers/ai-grading.processor.ts` — AI precheck bajarish
    - Precheck tugaganda: status=IN_REVIEW, Feedback(authorType=AI_DRAFT) yaratish
    - O'qituvchi yakuniy baho: status=GRADED, score + finalFeedback saqlash
    - submission.graded notification yuborish
    - _Requirements: 12.3, 12.4, 12.5, 12.6_

  - [x] 18.3 Writing module implementatsiyasi
    - Rich text editor (frontend component)
    - Autosave har 10 soniyada (Submission.answersJson)
    - Version history saqlash
    - _Requirements: 23.1, 23.2, 23.4_

  - [x] 18.4 Reading module implementatsiyasi
    - Passage viewer component
    - So'z hover → tarjima popup (translation, partOfSpeech, examples)
    - Jumla select → to'liq tarjima
    - Statik lug'atdan avval tekshirish, keyin Claude API
    - Redis cache: so'z 30 kun, jumla 7 kun
    - _Requirements: 22.1, 22.2, 22.3, 22.4, 22.5_

  - [x]* 18.5 Property test: Translation cache round-trip (Property 15)
    - **Property 15: Translation cache round-trip**
    - fast-check bilan random so'z va contextlar generatsiya qilish
    - Ikki marta translate chaqirish, ikkinchisi cache dan qaytishini tekshirish
    - Ikkinchi chaqiruvda Claude API chaqirilmasligini tekshirish
    - **Validates: Requirements 22.3, 22.4, 22.5**

  - [x]* 18.6 Unit testlar: Homework va Submission
    - Submission lifecycle state transitions testlari
    - Autosave testlari
    - Assignment creation validation testlari
    - _Requirements: 12.1–12.8, 23.1–23.4_

- [x] 19. Checkpoint — Homework module (Phase 6) yakunlash
  - Barcha testlar pass bo'lishini tekshiring, savollar bo'lsa foydalanuvchidan so'rang.

- [x] 20. AI Integration module (Phase 7)
  - [x] 20.1 AI Gateway service implementatsiyasi
    - `modules/ai/ai.module.ts`, `ai.controller.ts`, `ai.gateway.service.ts`, `claude.client.ts`
    - `packages/ai-gateway` — Claude API client wrapper
    - Rate limiting: 60 calls / 10 daqiqa per student (429 TOO_MANY_REQUESTS)
    - Cost tracking va audit: AiCall jadvaliga har bir chaqiruvni yozish (userId, intent, cost, latency, tokens)
    - _Requirements: 13.4, 13.5_

  - [x] 20.2 AI Tutor mode implementatsiyasi
    - `modules/ai/policy.ts` — no-completion enforcement
    - System prompt: "NEVER write a complete sentence/paragraph that the student could submit verbatim"
    - EXPLAIN, TRANSLATE, EXAMPLE intentlar uchun Claude API chaqiruvi
    - Cosine similarity tekshiruvi: AI javobi vs student submission matni (threshold 0.7)
    - Similarity yuqori bo'lsa javobni hint sifatida qayta yozish
    - Faqat qoidalar, boshqa mavzudagi misollar va qisman hintlar berish
    - _Requirements: 13.1, 13.2, 13.3, 13.6_

  - [x] 20.3 AI-text detection va grading assistant
    - Perplexity heuristic + Claude classifier orqali aiLikelihood (0..1) hisoblash
    - aiLikelihood >= 0.75 → Submission.aiFlagged=true
    - Teacher grading assistant: error highlighting, suggested feedback
    - _Requirements: 13.7, 13.8_

  - [x]* 20.4 Property test: AI tutor never produces complete answer (Property 4)
    - **Property 4: AI tutor never produces a complete answer**
    - Offline corpus bilan tutor replay (intent=EXPLAIN)
    - Similarity < 0.7 bo'lishini tekshirish
    - longestCommonSubstring / |finalAnswer| < 0.5 tekshiruvi
    - **Validates: Requirements 13.3, 13.6**

  - [x]* 20.5 Unit testlar: AI module
    - Rate limiting testlari
    - Policy enforcement testlari
    - AI-text detection threshold testlari
    - _Requirements: 13.1–13.8_

- [x] 21. Checkpoint — AI Integration (Phase 7) yakunlash
  - Barcha testlar pass bo'lishini tekshiring, savollar bo'lsa foydalanuvchidan so'rang.

- [x] 22. Mobile app skeleton (Phase 8)
  - [x] 22.1 React Native Expo app yaratish
    - `apps/mobile` — Expo monorepo addition
    - `packages/api-client` — shared API client (web va mobile uchun)
    - Navigation structure, auth flow, token management
    - _Requirements: 20.2_

  - [x] 22.2 Push notifications va offline support
    - Expo Push Notifications integratsiyasi
    - SQLite cache — offline lesson viewing
    - Background sync mechanism
    - _Requirements: 16.1_

  - [x] Unit testlar: Mobile app
    - Auth flow testlari
    - API client testlari
    - Offline cache testlari
    - _Requirements: 20.2_

- [x] 23. Admin panel va Analytics (Phase 9)
  - [x] 23.1 Admin module implementatsiyasi
    - `modules/admin/admin.module.ts`, controller, service
    - Specialty CRUD (yaratish, o'zgartirish, o'chirish)
    - SpecialtyModule management (per-Specialty ≤10 cap bilan)
    - User moderation (ban, unban, role change)
    - AdminAuditLog — barcha admin mutatsiyalarini log qilish
    - _Requirements: 24.1, 24.2, 24.3, 21.9_

  - [x] 23.2 Teacher dashboard analytics
    - Student progress tracking
    - Attendance statistics
    - Revenue va subscription analytics
    - _Requirements: 24.4_

  - [x] 23.3 Data export va financial reports
    - CSV export (students, payments, submissions)
    - Financial reports (monthly revenue, refunds)
    - _Requirements: 24.5_

  - [x] Unit testlar: Admin module
    - Specialty CRUD testlari
    - Module cap enforcement testlari
    - Audit log testlari
    - _Requirements: 24.1–24.5_

- [x] 24. Security hardening va performance optimization
  - [x] 24.1 Security implementatsiyasi
    - CSRF himoyasi: double-submit token
    - Field-level encryption: User.phone (pg_crypto)
    - Audit log: barcha billing mutatsiyalari
    - O'zbekiston PDP compliance tekshiruvi
    - _Requirements: 21.1, 21.4, 21.8, 21.9, 21.10_

  - [x] 24.2 Performance optimization
    - Read replica + Redis cache (lesson list, student dashboard)
    - Keyset (cursor) pagination (>10k rows jadvallar uchun)
    - API p95 latency < 250ms ta'minlash
    - Lesson page TTI < 2s (4G) ta'minlash
    - _Requirements: 20.1, 20.2, 20.7, 20.8_

  - [x] 24.3 Observability sozlash
    - Loki (logs), Grafana (dashboards), Tempo (traces), Sentry (errors)
    - Structured logging (JSON format)
    - Request tracing (correlation ID)
    - Grafana dashboards yaratish
    - _Requirements: 26_

  - [x] Integration testlar: Security va Performance
    - Rate limiting integration testlari
    - CSRF protection testlari
    - Signed URL expiry testlari
    - _Requirements: 21.1–21.10, 20.1–20.8_

- [x] 25. Frontend implementatsiyasi — asosiy sahifalar
  - [x] 25.1 Auth sahifalari (Next.js)
    - `/signup`, `/login`, `/verify-email`, `/password-reset` sahifalari
    - JWT token management (cookie-based)
    - Protected route middleware
    - _Requirements: 1.1–1.9_

  - [x] 25.2 Teacher dashboard va onboarding
    - `/onboarding` — quiz sahifasi
    - `/dashboard` — specialty-specific teacher dashboard
    - `/courses`, `/courses/:id/groups`, `/groups/:id/lessons` — CRUD sahifalari
    - `/groups/:id/settings/modules` — module toggle UI
    - _Requirements: 2.2, 2.3, 7.1–7.7, 11.3_

  - [x] 25.3 Student dashboard va lesson player
    - `/student/dashboard` — enrolled guruhlar ro'yxati
    - `/lessons/:id` — lesson player (HLS.js video, text content, attachments)
    - `/lessons/:id/live` — live stream viewer + chat
    - Progress tracking
    - _Requirements: 6.1–6.6, 8.4_

  - [x] 25.4 Homework va submission UI
    - `/homework/:id` — assignment ko'rish
    - Writing module: rich text editor + autosave
    - Reading module: passage viewer + translation popup
    - Submission flow: DRAFT → SUBMITTED
    - AI tutor sidebar
    - _Requirements: 12.1–12.8, 22.1–22.5, 23.1–23.4_

  - [x] 25.5 Discovery va public sahifalar
    - `/(marketing)/search` — qidiruv sahifasi (specialty, name filter)
    - `/t/:slug` — o'qituvchi public profili
    - Enrollment flow: search → profile → pay → approve
    - _Requirements: 14.1–14.7_

  - [x] 25.6 Notification center va chat UI
    - In-app notification list
    - Notification preferences settings
    - DM chat interface
    - Live chat interface
    - _Requirements: 15.1–15.7, 16.1–16.6_

  - [x] Frontend unit testlar
    - Component render testlari
    - Auth flow testlari
    - Form validation testlari
    - _Requirements: 1.1–1.9, 7.1–7.7_

- [x] 26. Final checkpoint — barcha modullar integratsiyasi
  - Barcha testlar pass bo'lishini tekshiring, savollar bo'lsa foydalanuvchidan so'rang.

- [x] 27. Advanced Threat Protection va Intrusion Detection (Phase 10 — Cybersecurity)
  - [x] 27.1 WAF va DDoS himoyasi implementatsiyasi
    - Cloudflare WAF qoidalarini sozlash (OWASP Top 10: SQL injection, XSS, path traversal, RCE bloklash)
    - Application-level rate limiting: Redis token bucket (IP bo'yicha 1000 req/min, user bo'yicha 300 req/min)
    - DDoS himoyasi: Cloudflare network-level protection + application-level throttling
    - `modules/security/waf/waf.middleware.ts`, `rate-limit.guard.ts` yaratish
    - _Requirements: 27.1, 27.2_

  - [x] 27.2 Brute-force lockout va credential stuffing himoyasi
    - `modules/security/brute-force/brute-force.service.ts` yaratish
    - 5 marta noto'g'ri parol → 30 daqiqaga vaqtincha bloklash + hCaptcha yoqish
    - Bloklangan akkauntga yana 3 marta urinish → to'liq bloklash + admin xabardor qilish
    - Muvaffaqiyatli login da failedAttemptCounter reset qilish
    - Bitta IP dan 10+ turli akkauntga login urinishi → IP ni 24 soatga bloklash (credential stuffing)
    - Redis da login attempt tracking (sliding window)
    - _Requirements: 27.4, 27.5, 27.9_

  - [x] 27.3 Impossible travel detection va geographic anomaly
    - `modules/security/geo/impossible-travel.service.ts` yaratish
    - Haversine formula bilan ikki login orasidagi masofani hisoblash
    - 500km+ masofada 1 soat ichida login → sessiyani bloklash + MFA qayta tekshiruv
    - GeoIP lookup (MaxMind GeoLite2) integratsiyasi
    - _Requirements: 27.3_

  - [x] 27.4 Bot detection va behavioral analysis
    - `modules/security/bot-detection/bot-detection.service.ts` yaratish
    - Device fingerprinting (browser fingerprint + hardware identifiers)
    - Behavioral analysis: mouse movement patterns, typing speed, request timing
    - hCaptcha integratsiyasi (suspicious behavior uchun)
    - _Requirements: 27.6_

  - [x] 27.5 SIEM integratsiyasi va honeypot endpointlar
    - `modules/security/siem/siem.service.ts` — barcha xavfsizlik hodisalarini Grafana Loki + alerting ga yuborish
    - Event korrelyatsiya qoidalari yaratish (multiple failed logins + IP change = high risk)
    - Honeypot endpointlar yaratish: `/admin-backup`, `/wp-login.php`, `/.env`
    - Honeypot ga so'rov kelsa → IP ni avtomatik bloklash
    - Threat intelligence feed integratsiyasi (AbuseIPDB, Spamhaus) — ma'lum zararli IP larni proaktiv bloklash
    - _Requirements: 27.7, 27.8, 27.10_

  - [x] Property test: Progressive brute-force lockout (Property 16)
    - **Property 16: Progressive brute-force lockout**
    - fast-check bilan random login attempt ketma-ketliklarini (success/failure) generatsiya qilish
    - 5 consecutive failure → TEMP_LOCKED, 3 more during lockout → PERM_LOCKED tekshiruvi
    - Muvaffaqiyatli login da counter reset bo'lishini tekshirish
    - **Validates: Requirements 27.4, 27.5**

  - [x] Property test: Impossible travel detection (Property 17)
    - **Property 17: Impossible travel detection**
    - fast-check bilan random (latitude, longitude, timestamp) juftliklarini generatsiya qilish
    - Haversine distance > 500km va time < 1h → session blocked tekshiruvi
    - Distance ≤ 500km → normal flow tekshiruvi
    - **Validates: Requirements 27.3**

  - [x] Property test: Rate-based IP blocking (Property 18)
    - **Property 18: Rate-based IP blocking thresholds**
    - fast-check bilan random IP → account login attempt ketma-ketliklarini generatsiya qilish
    - 10+ distinct accounts from same IP → IP blocked tekshiruvi
    - Honeypot endpoint ga bitta so'rov → immediate IP block tekshiruvi
    - **Validates: Requirements 27.8, 27.9**

  - [x] Unit testlar: Threat Protection module
    - WAF middleware testlari
    - Rate limiting threshold testlari
    - Brute-force lockout state machine testlari
    - GeoIP lookup va haversine calculation testlari
    - _Requirements: 27.1–27.10_

- [x] 28. Data Protection va Encryption (Phase 10 davomi)
  - [x] 28.1 AES-256-GCM encryption service implementatsiyasi
    - `modules/security/encryption/encryption.service.ts` yaratish
    - AES-256-GCM algoritmi bilan at-rest encryption
    - Column-level encryption: User.phone, User.address, PaymeTransaction.cardLastFour
    - Application-layer envelope encryption (data key + master key)
    - pgcrypto extension bilan DB-level encryption qo'llab-quvvatlash
    - _Requirements: 28.1, 28.3_

  - [x] 28.2 Key Management va rotation implementatsiyasi
    - `modules/security/kms/key-management.service.ts` yaratish
    - HashiCorp Vault integratsiyasi (yoki AWS KMS) — kalitlarni xavfsiz saqlash
    - 90 kunlik avtomatik key rotation (cron job)
    - Zero-downtime rotation: eski kalit bilan shifrlangan ma'lumotlarni yangi kalit bilan qayta shifrlash
    - HSM (Hardware Security Module) orqali master key himoyasi
    - Source code, env variable, config faylda plaintext kalit bo'lmasligini ta'minlash
    - _Requirements: 28.4, 28.5, 28.10_

  - [x] 28.3 PII masking va crypto-shredding implementatsiyasi
    - `modules/security/pii/pii-masking.service.ts` yaratish
    - Log va error message larda PII avtomatik masklash (email → "u***@...", phone → "***1234", IP → masked)
    - Pino logger custom serializer bilan PII detection va masking
    - Crypto-shredding: foydalanuvchi o'chirish so'raganda encryption key ni yo'q qilish
    - Barcha sezgir ma'lumotlar qaytarib bo'lmas tarzda o'chirilishini ta'minlash
    - _Requirements: 28.6, 28.7_

  - [x] 28.4 TLS, backup encryption va certificate pinning
    - TLS 1.3 majburiy qo'llash, TLS 1.2 va pastroq versiyalarga fallback taqiqlash
    - Database backup larni AES-256 bilan shifrlash (alohida backup kalitlari)
    - Mobile va API client larda certificate pinning sozlash (MITM oldini olish)
    - _Requirements: 28.2, 28.8, 28.9_

  - [x] Property test: Encryption round-trip (Property 19)
    - **Property 19: Encryption round-trip (AES-256-GCM)**
    - fast-check bilan random stringlar (unicode, empty, max-length) generatsiya qilish
    - encrypt → decrypt → original plaintext ga teng bo'lishini tekshirish
    - DB da saqlangan qiymat plaintext dan farq qilishini tekshirish
    - **Validates: Requirements 28.1, 28.3**

  - [x] Property test: PII masking in logs (Property 20)
    - **Property 20: PII masking in logs**
    - fast-check bilan random stringlar (email/phone/IP/card patterns) generatsiya qilish
    - maskPII funksiyasidan o'tkazish, original PII qiymatlar output da yo'qligini tekshirish
    - Masked placeholderlar mavjudligini tekshirish
    - **Validates: Requirements 28.6**

  - [x] Property test: Crypto-shredding (Property 21)
    - **Property 21: Crypto-shredding makes data unrecoverable**
    - fast-check bilan random user data generatsiya qilish, encrypt qilish
    - Key ni Vault/KMS dan o'chirish, decrypt urinishi FAIL bo'lishini tekshirish
    - Key store da kalit yo'qligini tekshirish
    - **Validates: Requirements 28.7**

  - [x] Property test: Key rotation preserves access (Property 22)
    - **Property 22: Key rotation preserves data access**
    - fast-check bilan random encrypted recordlar generatsiya qilish
    - Key rotation bajarish, barcha recordlar hali ham o'qilishini tekshirish
    - Yangi kalit bilan shifrlangan bo'lishini tekshirish
    - **Validates: Requirements 28.4**

  - [x] Unit testlar: Data Protection module
    - AES-256-GCM encrypt/decrypt testlari
    - Column-level encryption integration testlari
    - Key rotation zero-downtime testlari
    - PII masking regex pattern testlari
    - Crypto-shredding lifecycle testlari
    - _Requirements: 28.1–28.10_

- [x] 29. Authentication Hardening, Zero Trust va API Security (Phase 10 davomi)
  - [x] 29.1 MFA implementatsiyasi (TOTP + WebAuthn/FIDO2)
    - `modules/security/mfa/mfa.service.ts`, `totp.service.ts`, `webauthn.service.ts` yaratish
    - TOTP (Google Authenticator, Authy) — Teacher va Admin uchun majburiy
    - WebAuthn/FIDO2 hardware kalit — Admin uchun majburiy (faqat TOTP yetarli emas)
    - Student uchun MFA ixtiyoriy
    - MFA enrollment flow: QR code generatsiya, backup codes
    - SMS fallback (Teacher uchun)
    - _Requirements: 29.1, 29.7_

  - [x] 29.2 Session binding va adaptive authentication
    - `modules/security/session/session-binding.service.ts` yaratish
    - Session yaratilganda IP va User-Agent ni saqlash
    - IP yoki User-Agent o'zgarsa → session invalidate + re-authentication talab qilish
    - Device fingerprinting va trusted device ro'yxati boshqaruvi
    - Adaptive auth: yuqori xavfli operatsiyalar (to'lov, parol o'zgartirish, admin) uchun step-up authentication
    - Yangi qurilmadan login → email xabarnoma + qurilma tasdiqlash
    - Session fixation himoyasi: har bir login da yangi session ID
    - _Requirements: 29.2, 29.3, 29.4, 29.9, 29.10_

  - [x] 29.3 Password policy va account recovery hardening
    - `modules/security/password/password-policy.service.ts` yaratish
    - Minimum 12 belgi, katta/kichik harf, raqam, maxsus belgi
    - HaveIBeenPwned API orqali buzilgan parollar bazasida tekshirish
    - Ko'p bosqichli account recovery: email + telefon + xavfsizlik savollari
    - Zero Trust: har bir API so'rov autentifikatsiya + avtorizatsiya (ichki tarmoq ham)
    - _Requirements: 29.5, 29.6, 29.8_

  - [x] 29.4 API Security va Input Validation implementatsiyasi
    - `modules/security/api/request-signing.guard.ts` — HMAC-SHA256 request signing
    - Kritik endpointlar (payment, enrollment, admin) uchun imzo tekshiruvi
    - `modules/security/api/input-sanitization.pipe.ts` — XSS, SQLi, command injection prevention
    - DOMPurify + parameterized queries + zod strict validation
    - Security headers middleware: CSP (strict), X-Frame-Options: DENY, X-Content-Type-Options: nosniff, Referrer-Policy, Permissions-Policy
    - _Requirements: 30.1, 30.2, 30.3_

  - [x] 29.5 API hardening va file security
    - API versioning (v1, v2) va deprecation policy (6 oy oldindan ogohlantirish)
    - Request size limits: body 10MB, headers 8KB, URL 2048 belgi
    - GraphQL query depth limiting (max 7) va complexity analysis (max 1000 ball)
    - Zod strict mode — validatsiyadan o'tmagan maydonlar controller ga yetib bormasligi
    - CORS policy: faqat edubridge.uz, *.edubridge.uz ruxsat
    - Error response da stack trace, internal path, DB schema expose qilmaslik
    - File upload: content-type validation (magic bytes) + ClamAV antivirus scanning
    - _Requirements: 30.4, 30.5, 30.6, 30.7, 30.8, 30.9, 30.10_

  - [x] Property test: Role-based MFA enforcement (Property 23)
    - **Property 23: Role-based MFA enforcement**
    - fast-check bilan random userlar (STUDENT/TEACHER/ADMIN) generatsiya qilish
    - ADMIN → WebAuthn majburiy, TEACHER → TOTP majburiy, STUDENT → MFA ixtiyoriy tekshiruvi
    - MFA siz login urinishi → 403 MFA_REQUIRED tekshiruvi
    - **Validates: Requirements 29.1, 29.7**

  - [x] Property test: Session binding (Property 24)
    - **Property 24: Session binding to IP and User-Agent**
    - fast-check bilan random sessionlar (IP, UA) generatsiya qilish
    - IP yoki UA o'zgarsa → session INVALIDATED tekshiruvi
    - IP va UA bir xil qolsa → session valid tekshiruvi
    - **Validates: Requirements 29.3**

  - [x] Property test: Password policy validation (Property 25)
    - **Property 25: Password policy validation**
    - fast-check bilan random stringlar (turli uzunlik va tarkib) generatsiya qilish
    - Barcha kriteriyalarga mos → valid, bitta kriteriya buzilsa → invalid tekshiruvi
    - HaveIBeenPwned da topilgan parol → invalid tekshiruvi
    - **Validates: Requirements 29.5**

  - [x] Property test: HMAC request signing (Property 26)
    - **Property 26: HMAC request signing verification**
    - fast-check bilan random request body lar generatsiya qilish
    - Valid HMAC-SHA256 imzo → accepted, tampered imzo → 401, imzo yo'q → 401 tekshiruvi
    - **Validates: Requirements 30.1**

  - [x] Property test: Secure response envelope (Property 27)
    - **Property 27: Secure response envelope (headers + no internal leakage)**
    - fast-check bilan random API requestlar (valid va invalid) generatsiya qilish
    - Barcha response larda security headerlar mavjudligini tekshirish
    - Error response larda stack trace, internal path, DB schema yo'qligini tekshirish
    - **Validates: Requirements 30.3, 30.9**

  - [x] Property test: Input sanitization (Property 28)
    - **Property 28: Input sanitization prevents injection**
    - fast-check bilan XSS payloadlar (<script>, onerror=), SQL injection (' OR 1=1--), command injection (;rm -rf) generatsiya qilish
    - Sanitization dan o'tkazish, xavfli patternlar neutralize bo'lishini tekshirish
    - **Validates: Requirements 30.2**

  - [x] Unit testlar: Auth Hardening va API Security
    - MFA enrollment va verification testlari
    - Session binding edge case testlari
    - Password policy validation testlari
    - HMAC signing/verification testlari
    - Input sanitization testlari
    - Security headers testlari
    - ClamAV file scanning testlari
    - _Requirements: 29.1–29.10, 30.1–30.10_

- [x] 30. Supply Chain Security, Compliance va Incident Response (Phase 10 davomi)
  - [x] 30.1 Supply chain security implementatsiyasi
    - CI/CD pipeline da Snyk + Dependabot integratsiyasi (critical/high CVE → deploy block)
    - Trivy container image vulnerability scanning (critical → deploy to'xtatish)
    - cosign (Sigstore) bilan production image larni imzolash
    - Imzolanmagan image deploy qilinmasligini Kubernetes admission controller bilan ta'minlash
    - SBOM generatsiya (CycloneDX formatida) har bir release uchun
    - Base image: distroless/Alpine, pinned version (sha256 digest)
    - _Requirements: 31.1, 31.2, 31.3, 31.7, 31.8_

  - [x] 30.2 Infrastructure hardening va GitOps
    - Immutable infrastructure: production serverlarga SSH to'liq taqiqlash
    - ArgoCD/Flux orqali GitOps — barcha o'zgarishlar faqat Git orqali
    - Network segmentation: database faqat application pod lardan accessible
    - HashiCorp Vault orqali barcha secretlar boshqaruvi (hardcoded secret yo'q)
    - Kubernetes Pod Security Standards (restricted profile) qo'llash
    - Privileged container, host network, root user taqiqlash
    - Infrastructure drift detection + alert + avtomatik rollback
    - _Requirements: 31.4, 31.5, 31.6, 31.9, 31.10_

  - [x] 30.3 Audit trail va tamper-proof logging
    - `modules/security/audit/audit-trail.service.ts` yaratish
    - Barcha sezgir operatsiyalar uchun to'liq audit log: userId, action, timestamp, IP, device, context
    - Cryptographic hash chaining: har bir yozuv oldingi yozuv hash ini o'z ichiga oladi
    - Append-only storage + S3 Object Lock (WORM) bilan tamper-proof saqlash
    - Audit log integrity verification endpoint
    - _Requirements: 32.3, 32.4_

  - [x] 30.4 GDPR data subject rights implementatsiyasi
    - `modules/security/gdpr/gdpr.service.ts` yaratish
    - Data access right: barcha shaxsiy ma'lumotlarni export qilish (JSON/CSV)
    - Data rectification: shaxsiy ma'lumotlarni tuzatish
    - Data erasure: crypto-shredding orqali to'liq o'chirish
    - Data portability: standart formatda ma'lumotlarni ko'chirish
    - Har bir so'rov 30 kun ichida bajarilishi kerak (SLA tracking)
    - _Requirements: 32.2_

  - [x] 30.5 CI/CD security pipeline va compliance
    - SAST (SonarQube/Semgrep) integratsiyasi — statik kod tahlili
    - DAST (OWASP ZAP) integratsiyasi — dinamik ilovani tahlil qilish
    - SCA (Snyk) — ochiq kodli kutubxona zaifliklarini aniqlash
    - Critical finding topilsa pipeline to'xtatish
    - SOC 2 Type II compliance nazorat mexanizmlari (access control, change management, risk assessment)
    - securityheaders.com da A+ ball olish uchun headerlar sozlash
    - _Requirements: 32.1, 32.5, 32.8_

  - [x] 30.6 Incident response va breach notification
    - `modules/security/incident/incident-response.service.ts` yaratish
    - Avtomatlashtirilgan incident response playbook: anomaly detection → alert (PagerDuty/Opsgenie, 5 daqiqa) → triage → containment (IP block, session revoke) → eradication → recovery → post-mortem
    - Quarterly penetration testing SLA: critical 24h, high 7d, medium 30d, low 90d
    - Data breach notification: 72 soat ichida tegishli organlar va foydalanuvchilarga xabarnoma
    - Third-party security audit (yiliga 2 marta) natijalarini tracking
    - _Requirements: 32.6, 32.7, 32.9, 32.10_

  - [x] Property test: Audit trail completeness (Property 29)
    - **Property 29: Audit trail completeness and tamper-proof integrity**
    - fast-check bilan random sezgir operatsiyalar ketma-ketligini generatsiya qilish
    - Har bir operatsiya uchun audit entry yaratilishini (userId, action, timestamp, IP, device) tekshirish
    - Hash chaining integrity: har bir entry.prevHash = hash(oldingi entry) tekshiruvi
    - Entry o'zgartirish/o'chirish urinishi → chain verification FAIL tekshiruvi
    - **Validates: Requirements 32.3, 32.4**

  - [x] Property test: GDPR data subject rights (Property 30)
    - **Property 30: GDPR data subject rights completeness**
    - fast-check bilan random userlar (turli modullarda data bilan) generatsiya qilish
    - Data export: barcha PII fieldlar export ga kiritilganini tekshirish
    - Data deletion: crypto-shredding dan keyin hech qanday jadvalda PII qolmaganini tekshirish
    - **Validates: Requirements 32.2**

  - [x] Unit testlar: Supply Chain va Compliance
    - Audit trail hash chaining testlari
    - GDPR export completeness testlari
    - Crypto-shredding integration testlari
    - Incident response automation testlari
    - SBOM generation testlari
    - _Requirements: 31.1–31.10, 32.1–32.10_

- [x] 31. Final Security Checkpoint — Cybersecurity modullar integratsiyasi
  - Barcha xavfsizlik testlar pass bo'lishini tekshiring, savollar bo'lsa foydalanuvchidan so'rang.

## Notes

- `*` bilan belgilangan tasklar ixtiyoriy (optional) — tezroq MVP uchun o'tkazib yuborish mumkin
- Har bir task aniq requirements ga reference qiladi (traceability)
- Checkpointlar incremental validation ta'minlaydi
- Property testlar (fast-check) universal correctness properties ni tekshiradi
- Unit testlar aniq misollar va edge caselarni tekshiradi
- Barcha kod TypeScript da yoziladi (NestJS backend + Next.js frontend)
- Phase tartibida ketma-ket ishlash tavsiya etiladi (1→2→3→...→10)
- Outbox pattern barcha asinxron side-effectlar uchun ishlatiladi
- Idempotency-Key barcha mutating endpointlar uchun qo'llab-quvvatlanadi
- Phase 10 (Cybersecurity) — advanced threat protection, encryption, auth hardening, API security, supply chain, compliance
- Cybersecurity tasklar (27-30) mavjud infratuzilma ustiga quriladi va oldingi modullar bilan integratsiya qilinadi

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4"] },
    { "id": 2, "tasks": ["1.5", "1.6"] },
    { "id": 3, "tasks": ["2.1", "3.1"] },
    { "id": 4, "tasks": ["2.2", "3.2"] },
    { "id": 5, "tasks": ["2.3", "2.4", "2.5", "3.3", "3.4"] },
    { "id": 6, "tasks": ["4.1", "6.1"] },
    { "id": 7, "tasks": ["4.2", "4.3", "6.2"] },
    { "id": 8, "tasks": ["4.4", "4.5", "6.3", "6.4"] },
    { "id": 9, "tasks": ["7.1"] },
    { "id": 10, "tasks": ["7.2", "7.3", "7.4"] },
    { "id": 11, "tasks": ["8.1", "9.1"] },
    { "id": 12, "tasks": ["8.2", "8.3", "9.2"] },
    { "id": 13, "tasks": ["9.3", "9.4"] },
    { "id": 14, "tasks": ["11.1"] },
    { "id": 15, "tasks": ["11.2", "11.3", "11.4"] },
    { "id": 16, "tasks": ["12.1"] },
    { "id": 17, "tasks": ["12.2", "12.4"] },
    { "id": 18, "tasks": ["12.3", "12.5", "12.6"] },
    { "id": 19, "tasks": ["14.1", "15.1"] },
    { "id": 20, "tasks": ["14.2", "14.3", "15.2"] },
    { "id": 21, "tasks": ["14.4", "15.3", "15.4"] },
    { "id": 22, "tasks": ["17.1"] },
    { "id": 23, "tasks": ["17.2", "17.3"] },
    { "id": 24, "tasks": ["17.4", "18.1"] },
    { "id": 25, "tasks": ["18.2", "18.3", "18.4"] },
    { "id": 26, "tasks": ["18.5", "18.6"] },
    { "id": 27, "tasks": ["20.1"] },
    { "id": 28, "tasks": ["20.2", "20.3"] },
    { "id": 29, "tasks": ["20.4", "20.5"] },
    { "id": 30, "tasks": ["22.1"] },
    { "id": 31, "tasks": ["22.2", "22.3"] },
    { "id": 32, "tasks": ["23.1", "23.2"] },
    { "id": 33, "tasks": ["23.3", "23.4"] },
    { "id": 34, "tasks": ["24.1", "24.2", "24.3"] },
    { "id": 35, "tasks": ["24.4"] },
    { "id": 36, "tasks": ["25.1"] },
    { "id": 37, "tasks": ["25.2", "25.3"] },
    { "id": 38, "tasks": ["25.4", "25.5", "25.6"] },
    { "id": 39, "tasks": ["25.7"] },
    { "id": 40, "tasks": ["27.1", "28.1"] },
    { "id": 41, "tasks": ["27.2", "27.3", "28.2"] },
    { "id": 42, "tasks": ["27.4", "27.5", "28.3"] },
    { "id": 43, "tasks": ["27.6", "27.7", "27.8", "28.4"] },
    { "id": 44, "tasks": ["27.9", "28.5", "28.6", "28.7", "28.8"] },
    { "id": 45, "tasks": ["28.9", "29.1"] },
    { "id": 46, "tasks": ["29.2", "29.3"] },
    { "id": 47, "tasks": ["29.4", "29.5"] },
    { "id": 48, "tasks": ["29.6", "29.7", "29.8", "29.9"] },
    { "id": 49, "tasks": ["29.10", "29.11", "29.12"] },
    { "id": 50, "tasks": ["30.1", "30.3"] },
    { "id": 51, "tasks": ["30.2", "30.4"] },
    { "id": 52, "tasks": ["30.5", "30.6"] },
    { "id": 53, "tasks": ["30.7", "30.8", "30.9"] }
  ]
}
```
