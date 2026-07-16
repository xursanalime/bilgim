# Design Document: EduBridge Platform

> Bu hujjat **EduBridge** — O'zbekiston uchun ikki tomonlama (teacher ↔ student) onlayn ta'lim platformasining
> to'liq texnik dizaynidir. Hujjat **High-Level Design** (arxitektura, diagrammalar, interfeyslar) va
> **Low-Level Design** (Prisma sxemasi, API kontrakti, algoritmlar, papka tuzilmasi)ni birlashtiradi.
>
> **Stack:** Next.js 14 (App Router) + NestJS + Prisma + PostgreSQL + Redis + BullMQ + Socket.io +
> Cloudflare R2 + Claude API + Payme + WebRTC (mediasoup) + Docker.
>
> Texnik atamalar (API nomlari, kod, sxema maydonlari) inglizcha, izohlar o'zbekcha.

---

## Mundarija

1. [Overview](#overview)
2. [Goals and Non-Functional Requirements](#goals-and-non-functional-requirements)
3. [Phased Rollout](#phased-rollout)
4. [Architecture](#architecture)
5. [Deployment Topology](#deployment-topology)
6. [Bounded Contexts](#bounded-contexts)
7. [Sequence Diagrams](#sequence-diagrams)
8. [Data Models](#data-models)
9. [API Surface](#api-surface)
10. [Components and Interfaces](#components-and-interfaces)
11. [Key Algorithms (Low-Level)](#key-algorithms-low-level)
12. [Frontend Architecture](#frontend-architecture)
13. [Folder Structure](#folder-structure)
14. [Correctness Properties](#correctness-properties)
15. [Error Handling](#error-handling)
16. [Testing Strategy](#testing-strategy)
17. [Performance Considerations](#performance-considerations)
18. [Security Considerations](#security-considerations)
19. [Observability and Operations](#observability-and-operations)
20. [Dependencies](#dependencies)

---

## Overview

EduBridge — bu O'qituvchilar va talabalarni bog'laydigan SaaS ta'lim platformasi. O'qituvchilar
o'z kurs/guruhlarini yaratadi, dars-materiallar (video, jonli efir, fayl, audio, uy vazifasi)
yuklaydi va to'lovli obuna asosida ishlaydi. Talabalar **ikkita yo'l** bilan platformaga kirib
keladi: (1) o'qituvchi yuborgan **invite link** orqali, yoki (2) **public discovery** sahifasidagi
qidiruv natijasidan o'qituvchini topib, uning ochiq profili orqali ro'yxatdan o'tib. Har ikkala
holatda ham **Payme** to'lovi va o'qituvchi tomonidan tasdiqlash bir xil enrollment funnel'dan
o'tadi. Tasdiqlangach student guruhga qo'shilib, darslarni tomosha qiladi va AI-yordamchi bilan
uy vazifalarini bajaradi.

Uy vazifa tizimi **uch bosqichli kuratsiya** asosida quriladi:
**Specialty catalog → Group seed → per-Group toggle**.

1. **Per-Specialty curated catalog (≤10 module types).** Har bir Specialty (English, Math, SMM, ...)
   uchun admin **eng ko'pi bilan 10** ta `HomeworkModuleType` ni `SpecialtyModule` jadvaliga
   kiritadi (qattiq cheklov: per-Specialty hard cap = 10). Misollar:
   - **English:** reading, writing, listening, speaking (4 ta core) + qo'shimcha 6 tagacha
     (vocabulary, pronunciation, grammar, spelling, gap-fill, multiple-choice, ...).
   - **Math:** word-problem, equation-solver, geometry-proof + qo'shimcha 7 tagacha.
   - **SMM:** marketing-copy, audience-analysis, content-calendar, case-study + qo'shimcha 6 tagacha.
2. **Onboarding faqat Specialty ni belgilaydi.** Onboarding quizdan keyin teacher uchun **faqat**
   `specialtyId` set bo'ladi — onboarding bosqichida hech qanday modul tanlanmaydi.
3. **Group yaratilganda katalog avtomatik biriktiriladi.** Teacher Group yaratganda (masalan,
   "Sefer guruhi"), tizim teacher specialty'sidagi **butun** `SpecialtyModule` katalogini Group'ga
   biriktirib, har biri uchun `GroupModule` yozuvi yaratadi — default holati `isEnabled = false`
   (yoki `SpecialtyModule.defaultEnabled = true` bo'lsa, ON-by-default).
4. **Per-Group toggle, mutable, non-destructive.** Teacher Group sozlamalarida har bir modulni
   istalgan vaqtda **alohida yoqib/o'chirib qo'yadi**. Toggle holati **per-Group**, per-teacher
   yoki per-specialty emas — bitta teacher ikkita Group'ida turli modul to'plamlariga ega
   bo'lishi mumkin. Modulni o'chirish **non-destructive**: o'sha modulga tayanadigan eski
   Assignment'lar va ulardagi Submission'lar to'liq ishlashda davom etadi; o'chirilgan modul
   shunchaki kelajakdagi `AssignmentBuilder` picker'idan yashirinadi.
5. **AssignmentBuilder picker faqat group-enabled modullarni ko'rsatadi.** Lesson ichida yangi
   Assignment quryotganda picker `GET /homework/available-modules?groupId=...` ni chaqiradi va
   faqat o'sha Group uchun **hozir yoqilgan** modullarni ko'rsatadi (specialty katalogining
   to'liq ro'yxatini emas).

Platforma **modulyar monorepo** sifatida quriladi (`apps/web`, `apps/api`, `packages/*`). Backend
**NestJS bounded context modullari** sifatida tashkil etiladi, har bir kontekst (Auth, Billing,
Catalog, Live, Homework, AI, Notifications) o'z servis chegarasi bilan ajratilgan, lekin
boshlang'ich bosqichda bitta deployable bo'lib chiqadi (modular monolith → keyinchalik mikroservislarga
bo'linadi).

Asosiy domen invariantlari (qattiq qoidalar):

- **Enrollment invariant:** student dars kontentini faqat `(payment.status = SUCCEEDED) ∧ (enrollment.status = APPROVED)` bo'lganda ko'radi.
- **Trial invariant:** o'qituvchi obunasi yo `TRIAL` (`trialEndsAt > now`) yoki `ACTIVE` bo'lishi shart; ikkalasi ham bo'lishi mumkin emas; trial ichida ikki marta to'lov olinmaydi.
- **Notification invariant:** har bir schedule change yoki yangi lesson publish hodisasi guruhga ro'yxatdan o'tgan har bir studentga **aynan bitta** notification yuboradi (idempotency key orqali).
- **AI integrity:** AI hech qachon student uchun yakuniy javob yozmaydi; submission AI-detector orqali tekshiriladi va `ai_flagged` belgisi qo'yiladi.
- **Payment ↔ Enrollment atomicity:** enrollment row faqat muvaffaqiyatli Payme tranzaktsiyasidan keyin (transactional outbox + idempotent webhook) yaratiladi.
- **Live recording invariant:** boshlangan har bir jonli sessiya tugagandan keyin lesson'ga `Recording` artifakt sifatida biriktiriladi (yoki `RECORDING_FAILED` holati bilan belgilanadi — hech qachon "ovozsiz tushib qolmaydi").

---

## Goals and Non-Functional Requirements

| Kategoriya | Talab |
|---|---|
| Foydalanuvchilar | 100k+ oylik aktiv talaba, 5k+ o'qituvchi (target 12 oy ichida) |
| Mintaqa | O'zbekiston (asosiy), keyinchalik MDH |
| Tillar | UI: o'zbek (lotin), rus, ingliz; ma'lumotlar: ko'p tilli kontent |
| Latency | API p95 < 250ms; lesson page TTI < 2s 4G da |
| Live | 1 streamga ≤ 500 izlovchi; oxirigacha kechikish ≤ 1.5s (mediasoup SFU) |
| Storage | Video uchun Cloudflare R2 (egress arzon), HLS playlist + segments |
| Reliability | 99.9% oylik uptime; payment va enrollment uchun 99.99% atomicity |
| Security | OWASP ASVS L2; PII shifrlash; Payme webhook signature verification |
| Compliance | O'zbekiston PDP qonuni; ma'lumot residencysini hurmat qilish |
| Mobil | Mobil-friendly veb (PWA) → keyin React Native (Expo) bilan native app |

---

## Phased Rollout

Foydalanuvchi har bir fazani **alohida** ishlab chiqishni so'ragan. Shuning uchun barcha fazalarni
oldindan ko'rsatib, keyin Phase 1 ga to'liq kod yoziladi.

### Phase 1 — MVP Foundation (4-6 hafta)
- Monorepo skeleton (`apps/web`, `apps/api`, `packages/db`, `packages/ui`, `packages/config`)
- Auth: email + parol, JWT (access + refresh), email verification
- Teacher onboarding quiz → specialty assignment
- Trial subscription model (14 days)
- Course/Group CRUD (teacher), public landing
- Static lesson (text + file upload to R2) CRUD
- Student invite link → registration → enrollment request
- Manual teacher approval (no payment yet — sandbox enrollment)
- Notification skeleton (in-app only)
- Basic role-based authorization (RBAC)
- Docker Compose + GitHub Actions CI

### Phase 2 — Payments & Subscriptions (3-4 hafta)
- Payme merchant integration (P2P + receipts API)
- Subscription state machine: `TRIAL → ACTIVE → PAST_DUE → CANCELED`
- Student course payment + enrollment atomicity (outbox pattern)
- Invoice/receipts, refund policy
- Pricing plans (teacher tiers based on student count)

### Phase 3 — Recorded Lessons & Files (2-3 hafta)
- R2 multipart upload (resumable, presigned)
- Video transcoding pipeline (BullMQ + ffmpeg → HLS, multi-bitrate)
- File-type whitelist (PDF, DOCX, XLSX, images, audio)
- Lesson player (HLS.js) with progress tracking
- Audio "voice message to all students" feature

### Phase 4 — Live Streaming (4-6 hafta)
- mediasoup SFU service (`apps/sfu`)
- Live session lifecycle (scheduled → starting → live → ended → recorded)
- Real-time chat (Socket.io rooms, persisted)
- Auto-record (mediasoup → ffmpeg composite → R2 → HLS)
- Hybrid lesson (video + live)
- Optional Zoom API fallback (feasibility check; if Zoom OAuth Marketplace approval timeline > 4 weeks, ship mediasoup first)

### Phase 5 — Scheduler, Notifications & Public Discovery (3-4 hafta)
- Recurring schedule (RRULE) per group
- Schedule change → notify all enrolled students (in-app + email + Telegram bot)
- Reminder cron (15 min before live)
- Notification preferences per student
- Idempotent fan-out via BullMQ + Redis dedup keys
- **Public discovery surface** (visitor → search → teacher profile → courses)
  - `/(marketing)/search` sahifasi (subject va name bo'yicha qidiruv, filterlar)
  - O'qituvchining ochiq profili `edubridge.uz/t/{slug}` (TeacherProfile.publicSlug)
  - Postgres full-text + `pg_trgm` indekslari (`TeacherProfile.fullName/headline`, `Course.title`, `Group.name`)
  - Per-course `isDiscoverable` flag (default `true`; teacher xohlasa private guruhini yashiradi)
  - Public profile dan enrollment → mavjud Payme + enrollment-request flow ga ulanadi (alohida path emas)
- **Direct messaging (DM) skeleton**
  - `ChatRoom.scope = "DM"` (kalit: sortlangan `userIdA:userIdB`)
  - "Message teacher" tugmasi visitor'ni avval ro'yxatdan o'tkazadi (STUDENT)
  - Rate limit: birinchi xabardan keyin 1 msg/min/pair (teacher javob yozsa unlimited)
  - Existing chat moderation va profanity filter qo'llaniladi

### Phase 6 — Homework Modules (4-5 hafta)
- **Specialty-scoped curated catalog**: har bir `Specialty` uchun admin tomonidan boshqariladigan
  `SpecialtyModule` ro'yxati, **per-Specialty hard cap = 10 ta `HomeworkModuleType`**
  (DB-darajasida `enforce_specialty_module_cap()` constraint trigger + service-layer guard
  bilan birgalikda himoya qilinadi). Admin bir modulni `defaultEnabled=true` deb belgilashi mumkin
  (masalan, English uchun reading/writing/listening/speaking).
- **Per-Group module toggle**: Group yaratilganda specialty katalogidagi har bir modul
  uchun `GroupModule` yozuvi seed qilinadi (`isEnabled = SpecialtyModule.defaultEnabled`,
  default `false`). Teacher Group sozlamalaridagi "Modules" tab'ida har bir modulni mustaqil ON/OFF
  qiladi; toggle holati **per-Group** (per-teacher yoki per-specialty emas) va istalgan vaqtda
  o'zgartiriladi. O'chirish non-destructive — eski Assignment va Submission'lar buzilmaydi.
- `AssignmentBuilder` picker'i `GET /homework/available-modules?groupId=...` natijasidan faqat
  Group uchun **hozir yoqilgan** modullarni ko'rsatadi (full specialty katalogini emas).
- Writing module (rich text editor, autosave, version history)
- Reading module (passage viewer, word/sentence translation popup, dictionary cache)
- Listening module (audio + transcript blanks)
- Grammar module (gap-fill, multiple choice, drag-drop)
- Spelling module (audio dictation)
- Submission lifecycle: `DRAFT → SUBMITTED → IN_REVIEW → GRADED → RETURNED`

### Phase 7 — AI Integration (3-4 hafta)
- Claude API gateway (`packages/ai-gateway`) with rate limiting + cost tracking
- Student tutor mode: "explain", "translate", "give example" (system prompt enforces no-completion)
- Teacher grading assistant: error highlighting, AI-text detection (perplexity heuristic + Claude check), suggested feedback
- Audit log for every AI call (who, what, why, cost)
- Manual override always available

### Phase 8 — Mobile (React Native, 6-8 hafta)
- Expo monorepo addition (`apps/mobile`)
- Shared API client (`packages/api-client`)
- Push notifications (Expo Push)
- Offline lesson viewing (SQLite cache)

### Phase 9 — Analytics & Admin (2-3 hafta)
- Teacher dashboard analytics (student progress, attendance)
- Platform admin panel (specialty management, user moderation, financial reports)
- Data export (CSV)

---

## Architecture

### Logical architecture

```mermaid
graph TB
    subgraph Client
        WEB[Next.js 14 Web App<br/>App Router + RSC]
        MOB[React Native App<br/>Phase 8]
    end

    subgraph Edge
        CDN[Cloudflare CDN<br/>+ R2 Public Bucket]
        WAF[Cloudflare WAF + Rate Limit]
    end

    subgraph BackendCore[Backend Core - NestJS Modular Monolith]
        GW[API Gateway<br/>HTTP + WS]
        AUTH[Auth Module]
        BILL[Billing Module]
        CAT[Catalog Module<br/>Courses/Lessons]
        HW[Homework Module]
        AI[AI Gateway Module]
        NOTIF[Notifications Module]
        SCHED[Scheduler Module]
    end

    subgraph LiveStack[Live Streaming Stack]
        SIG[Signaling Service<br/>Socket.io]
        SFU[mediasoup SFU Workers]
        REC[Recorder Worker<br/>ffmpeg]
    end

    subgraph DataPlane[Data Plane]
        PG[(PostgreSQL 16<br/>primary)]
        PGR[(PostgreSQL<br/>read replica)]
        RDS[(Redis<br/>cache + pubsub + bullmq)]
        R2[(Cloudflare R2<br/>video + files)]
    end

    subgraph Workers[Async Workers - BullMQ]
        TRANS[Transcoding Worker]
        EMAIL[Email Worker]
        TG[Telegram Worker]
        AIWORK[AI Grading Worker]
        OUTBOX[Outbox Dispatcher]
    end

    subgraph External
        PAYME[Payme Gateway]
        CLAUDE[Anthropic Claude API]
        SES[Email SES/SMTP]
        TGAPI[Telegram Bot API]
    end

    WEB --> WAF
    MOB --> WAF
    WAF --> GW
    WEB -. static .-> CDN
    CDN --> R2

    GW --> AUTH
    GW --> BILL
    GW --> CAT
    GW --> HW
    GW --> AI
    GW --> NOTIF
    GW --> SCHED
    GW --> SIG

    AUTH --> PG
    BILL --> PG
    CAT --> PG
    HW --> PG
    NOTIF --> PG
    SCHED --> PG

    BILL <-->|webhook + REST| PAYME
    AI <--> CLAUDE

    NOTIF --> RDS
    SCHED --> RDS
    GW --> RDS
    SIG --> RDS

    SIG --> SFU
    SFU --> REC
    REC --> R2

    PG -. logical replication .-> PGR

    OUTBOX --> RDS
    TRANS --> R2
    AIWORK --> CLAUDE
    EMAIL --> SES
    TG --> TGAPI
```

### Asosiy arxitektura tamoyillari

1. **Modular monolith first.** Boshlang'ich versiya bitta NestJS prosessi sifatida deploy qilinadi,
   lekin har bir modul boshqa modullarga faqat **port/interface** orqali murojaat qiladi (cross-module
   import qat'iy taqiqlanadi — ESLint qoidasi `no-restricted-imports`).
2. **Outbox pattern.** PostgreSQL ichida `outbox_event` jadvali, BullMQ Dispatcher uni o'qib
   tashqi side-effect (email, telegram, fan-out notification, payment recon)ni yuboradi.
   Bu **payment ↔ enrollment atomicity** ni kafolatlaydi.
3. **CQRS-lite.** Read-heavy endpointlar (lesson list, student dashboard) read replica + Redis cache;
   write yo'llari primary db.
4. **Event-driven internal bus.** NestJS `EventEmitter2` + Redis pubsub (cross-instance) — masalan
   `lesson.published`, `schedule.changed`, `submission.graded`.
5. **Idempotency.** Har bir mutating endpoint `Idempotency-Key` headerni qo'llab-quvvatlaydi (24h Redis cache).
6. **Tenancy:** har bir teacher o'z guruhlari ichida izolatsiya qilingan; platforma admin alohida RBAC.

### Public Discovery subsystem

Public discovery — bu ro'yxatdan o'tmagan **visitor** uchun ochiq qidiruv yuzasi (landing page'dan
boshlanadi). Qidiruv ikki o'qda ishlaydi:

1. **Subject (specialty) bo'yicha** — `?specialtyId=...` filteri orqali ushbu fan bo'yicha
   o'qituvchilar ro'yxati (`/discovery/teachers`).
2. **Teacher name bo'yicha** — `?q=...` orqali full-text + trigram qidiruvi.

Implementatsiya:

- **Postgres full-text search** + `pg_trgm` extension (sxema'da allaqachon yoqilgan).
  Maydonlar: `TeacherProfile.fullName`, `TeacherProfile.headline`, `Course.title`, `Group.name`.
  Trigram GIN indeks har bir maydon uchun raw SQL migration sifatida qo'shiladi
  (Prisma `@@index(..., type: Gin)` formatida emas, chunki `pg_trgm` opclass kerak).
- **Read-only**: barcha `/discovery/*` endpointlari read replica'dan o'qiydi (CQRS-lite).
- **Visibility:** `Group.isDiscoverable = false` bo'lgan guruhlar hech qachon `/discovery/*`
  javoblariga tushmaydi (tekshiruv repository qatlamida — testlar bilan kafolatlangan).
- **Phase 9 swap-in:** agar Postgres trigram'i 100k+ teacher uchun yetmasa, qidiruv
  **Meilisearch** (yoki Typesense) ga ko'chiriladi; API kontrakti o'zgarmaydi.

```sql
-- raw SQL migration: trigram indexes
CREATE INDEX teacher_profile_fullname_trgm_idx
  ON "TeacherProfile" USING GIN (full_name gin_trgm_ops);
CREATE INDEX teacher_profile_headline_trgm_idx
  ON "TeacherProfile" USING GIN (headline gin_trgm_ops);
CREATE INDEX course_title_trgm_idx
  ON "Course" USING GIN (title gin_trgm_ops);
CREATE INDEX group_name_trgm_idx
  ON "Group" USING GIN (name gin_trgm_ops);
```

DM (direct messaging) — chat module'ning kichik kengaytmasi. ChatRoom `scope="DM"` bilan ochiladi;
`scopeRef` formati `min(userIdA, userIdB) + ":" + max(userIdA, userIdB)` (sortlangan juftlik) — bu
bir xil DM xonasining ikki marta yaratilishini taqiqlaydi. Birinchi xabar yuborilganda xona
lazy-yaratiladi. Rate-limit qoidasi (Redis token bucket): bir tomonlama `1 msg/min/pair`, qarama-qarshi
tomon javob yozsa **reciprocated** belgisi qo'yiladi va keyin limit olib tashlanadi (faqat global
chat anti-spam limiti qoladi: ~30 msg/min per user).

```mermaid
graph LR
    subgraph CF[Cloudflare]
        DNS[DNS + WAF + CDN]
        R2B[R2 Bucket: edubridge-media]
    end

    subgraph K8S[Kubernetes - Hetzner/AWS]
        ING[Ingress nginx]
        APIPOD[api-deployment<br/>3 replicas]
        SIGPOD[signaling-deployment<br/>2 replicas]
        SFUPOD[sfu-statefulset<br/>auto-scale 2-10]
        WORKPOD[worker-deployment<br/>3 replicas]
        WEBPOD[web-deployment<br/>2 replicas Next.js]
    end

    subgraph DB[Managed Data Layer]
        PGPRIM[(Postgres 16<br/>primary)]
        PGREAD[(Postgres<br/>read replica)]
        REDISCL[(Redis Cluster)]
    end

    subgraph OBS[Observability]
        LOKI[Loki logs]
        GRAF[Grafana]
        TEMPO[Tempo traces]
        SENTRY[Sentry errors]
    end

    DNS --> ING
    ING --> WEBPOD
    ING --> APIPOD
    ING --> SIGPOD
    SIGPOD --> SFUPOD
    APIPOD --> PGPRIM
    APIPOD --> PGREAD
    APIPOD --> REDISCL
    WORKPOD --> PGPRIM
    WORKPOD --> REDISCL
    SFUPOD --> R2B
    APIPOD --> R2B
    APIPOD --> SENTRY
    APIPOD --> LOKI
    APIPOD --> TEMPO
```

**Eslatmalar:**
- `sfu-statefulset` — har bir pod o'zining UDP port range (40000-40100) bilan; `hostNetwork: true`
  yoki `NodePort` orqali NAT traversal uchun ochiq IP.
- `web-deployment` — Next.js standalone build (Vercel'siz self-hosted; Vercel ham qo'llab-quvvatlanadi).
- Bluescreen-free deploy: rolling update + readiness probe + DB migration `prisma migrate deploy`
  pre-deploy job sifatida.


---

## Bounded Contexts

Har bir kontekst NestJS `@Module` bo'lib, o'z `controllers/`, `services/`, `dtos/`, `events/`,
`repositories/` papkasiga ega. Domen modellari **Prisma client** orqali ishlanadi, ammo modullar
faqat o'z table prefiksiga teginadi.

| Module | Mas'uliyat | Asosiy jadvallar | Asosiy eventlar |
|---|---|---|---|
| `auth` | Registration, login, JWT, password reset, email verification, sessions | `User`, `Session`, `EmailVerification`, `PasswordReset` | `user.registered`, `user.email_verified` |
| `teacher` | Teacher profile, onboarding quiz, specialty | `TeacherProfile`, `Specialty`, `OnboardingAnswer` | `teacher.onboarded` |
| `billing` | Trial, subscription, Payme integration, invoices | `Subscription`, `PaymeTransaction`, `Invoice`, `Plan` | `subscription.activated`, `payment.succeeded`, `payment.failed` |
| `catalog` | Courses, groups, lessons, attachments, schedule; per-Group module toggle (`GroupModule`) — when a Group is created, seeds one `GroupModule` row per `SpecialtyModule` of the teacher's specialty | `Course`, `Group`, `Lesson`, `Attachment`, `Schedule`, `ScheduleException`, `GroupModule` | `lesson.published`, `schedule.changed`, `group.module.toggled` |
| `enrollment` | Invite links, join requests, approvals | `InviteLink`, `EnrollmentRequest`, `Enrollment` | `enrollment.requested`, `enrollment.approved` |
| `live` | Live session lifecycle, signaling, recording orchestration | `LiveSession`, `LiveParticipant`, `Recording` | `live.started`, `live.ended`, `recording.ready` |
| `homework` | Assignments, modules, submissions, grading; reads BOTH `SpecialtyModule` (specialty catalog) AND `GroupModule` (per-group toggle state) to gate the assignment-builder picker — only modules with `GroupModule.isEnabled = true` for the lesson's group are pickable, and that subset must lie within the group's specialty catalog | `Assignment`, `AssignmentModule`, `Submission`, `Feedback`, `SpecialtyModule` (read), `GroupModule` (read) | `submission.created`, `submission.graded` |
| `ai` | AI gateway, prompt templates, audit, cost tracking | `AiCall`, `AiPromptTemplate`, `AiUsage` | `ai.call.completed` |
| `notifications` | Multi-channel notification fan-out | `Notification`, `NotificationPreference`, `NotificationDelivery` | `notification.queued`, `notification.delivered` |
| `media` | R2 uploads, transcoding, file metadata | `MediaAsset`, `TranscodingJob` | `media.uploaded`, `media.transcoded` |
| `chat` | Group, live & DM chat; lazy DM-room creation; rate-limited until reciprocated | `ChatRoom`, `ChatMessage`, `DmRateLimit` (Redis) | `chat.message.sent`, `chat.dm.opened` |
| `discovery` | Public read-only search of teachers and courses; trigram + FT indexes; respects `isDiscoverable` flag | `TeacherProfile` (read), `Course`, `Group` (read) | — (read-only) |
| `admin` | Platform admin operations, specialty management, `SpecialtyModule` mapping; **enforces the per-Specialty hard cap of ≤10 active modules** (service-layer guard + `enforce_specialty_module_cap()` DB constraint trigger) | `Specialty`, `SpecialtyModule`, `AdminAuditLog` | `admin.action`, `specialty.modules.updated` |

### Cross-module rules

- Auth modulidan tashqari **hech bir modul `User` jadvalini to'g'ridan-to'g'ri yozmaydi**;
  `auth.users.findById(id)` orqali read-only.
- Billing va Enrollment **outbox** orqali muloqot qiladi (atomicity uchun).
- AI moduli **faqat AI Gateway orqali** chaqiriladi — Claude API endpointi boshqa joydan chaqirilishi taqiqlanadi.

---

## Sequence Diagrams

### Teacher onboarding (registration → trial → quiz → dashboard)

```mermaid
sequenceDiagram
    actor T as Teacher
    participant W as Web (Next.js)
    participant API as NestJS API
    participant AUTH as auth module
    participant TM as teacher module
    participant BM as billing module
    participant DB as Postgres
    participant Q as BullMQ
    participant EM as Email worker

    T->>W: /signup form (email, password, role=TEACHER)
    W->>API: POST /auth/register
    API->>AUTH: register(dto)
    AUTH->>DB: INSERT User(role=TEACHER, status=PENDING_VERIFY)
    AUTH->>DB: INSERT outbox_event(user.registered)
    AUTH-->>API: { userId, emailToken }
    API->>Q: enqueue email.verify
    Q->>EM: process
    EM->>T: verification email
    T->>W: click verification link
    W->>API: POST /auth/verify-email
    API->>AUTH: verifyEmail(token)
    AUTH->>DB: UPDATE User SET status=ACTIVE
    AUTH->>BM: startTrial(userId)
    BM->>DB: INSERT Subscription(status=TRIAL, trialEndsAt=now+14d)
    BM-->>API: ok
    API-->>W: 200 OK
    T->>W: navigates to /onboarding
    W->>API: GET /teacher/onboarding/questions
    API->>TM: getQuestions()
    TM-->>API: questions[]
    W-->>T: render quiz
    T->>W: submit answers
    W->>API: POST /teacher/onboarding/answers
    API->>TM: submitAnswers(dto)
    TM->>TM: classify specialty (rule-based + Claude fallback)
    TM->>DB: UPDATE TeacherProfile SET specialtyId=...
    TM-->>API: { specialty, dashboardUrl }
    W-->>T: redirect to specialty dashboard
```

### Lesson creation (recorded video, with R2 multipart upload)

```mermaid
sequenceDiagram
    actor T as Teacher
    participant W as Web
    participant API as NestJS API
    participant CAT as catalog module
    participant MED as media module
    participant R2 as Cloudflare R2
    participant Q as BullMQ
    participant TR as Transcoding worker

    T->>W: /groups/:id/lessons/new
    W->>API: POST /catalog/lessons (title, type=RECORDED, groupId)
    API->>CAT: createLesson(dto)
    CAT->>DB: INSERT Lesson(status=DRAFT)
    CAT-->>W: { lessonId }
    T->>W: select video file
    W->>API: POST /media/uploads (lessonId, fileName, size, contentType)
    API->>MED: initMultipart(dto)
    MED->>R2: CreateMultipartUpload
    MED->>DB: INSERT MediaAsset(status=UPLOADING)
    MED-->>API: { uploadId, partUrls[] }
    W->>R2: PUT each part (presigned)
    W->>API: POST /media/uploads/:id/complete (parts[])
    API->>MED: completeMultipart(dto)
    MED->>R2: CompleteMultipartUpload
    MED->>DB: UPDATE MediaAsset(status=UPLOADED)
    MED->>Q: enqueue transcoding job
    Q->>TR: process
    TR->>R2: GET source
    TR->>TR: ffmpeg → HLS variants (240p,480p,720p,1080p)
    TR->>R2: PUT manifest + segments
    TR->>MED: mark ASSET ready, attach to Lesson
    MED->>DB: UPDATE Lesson(status=READY) + emit lesson.published
    MED->>Q: enqueue notification fan-out
```

### Group creation seeds module toggles

When a teacher creates a Group, the system atomically inserts one `GroupModule`
row per active `SpecialtyModule` of the teacher's specialty, copying
`SpecialtyModule.defaultEnabled` into `GroupModule.isEnabled`. The teacher can
later toggle any of these via `/catalog/groups/:id/modules`.

```mermaid
sequenceDiagram
    actor T as Teacher
    participant W as Web
    participant API as NestJS API
    participant CAT as catalog module
    participant ADM as admin module (read)
    participant DB as Postgres

    T->>W: /courses/:id/groups/new
    W->>API: POST /catalog/courses/:id/groups
    API->>CAT: createGroup(courseId, dto)
    CAT->>DB: BEGIN TX
    CAT->>DB: INSERT Group(...)
    CAT->>ADM: getSpecialtyModules(teacher.specialtyId)
    ADM->>DB: SELECT SpecialtyModule WHERE specialtyId AND isActive
    ADM-->>CAT: [{ moduleType, defaultEnabled }] (≤10 rows)
    loop for each module in catalog
        CAT->>DB: INSERT GroupModule(groupId, moduleType, isEnabled=defaultEnabled)
    end
    CAT->>DB: COMMIT
    CAT-->>W: { group, modules: [...] }
    Note over T: teacher can later toggle any module via /catalog/groups/:id/modules
```

### Live session — boshlash, kuzatish, yozib olish

```mermaid
sequenceDiagram
    actor T as Teacher
    actor S as Students
    participant W as Web
    participant API as NestJS API
    participant LIVE as live module
    participant SIG as Signaling (Socket.io)
    participant SFU as mediasoup SFU
    participant REC as Recorder worker
    participant R2 as R2

    T->>W: click "Start live"
    W->>API: POST /live/sessions/:lessonId/start
    API->>LIVE: startSession(lessonId, teacherId)
    LIVE->>DB: INSERT LiveSession(status=STARTING)
    LIVE->>SIG: allocate room (lessonId)
    SIG->>SFU: createRouter(roomId)
    SFU-->>SIG: routerRtpCapabilities
    LIVE->>DB: UPDATE LiveSession(status=LIVE)
    LIVE->>REC: spawn recorder (pipe RTP → ffmpeg)
    LIVE->>NOTIF: publish live.started
    NOTIF->>S: in-app + push (enrolled & approved)
    T->>SIG: WS connect /live?room=xxx
    SIG->>SFU: createTransport(producer)
    T->>SFU: produce audio/video
    S->>SIG: WS connect, request consume
    SIG->>SFU: createTransport(consumer)
    S->>SFU: consume streams
    Note over T,S: real-time chat via SIG channel
    T->>API: POST /live/sessions/:id/end
    API->>LIVE: endSession(id)
    LIVE->>SFU: closeRouter
    LIVE->>REC: finalize recording
    REC->>REC: ffmpeg mux + HLS package
    REC->>R2: upload final HLS
    REC->>LIVE: recording.ready(assetId)
    LIVE->>DB: INSERT Recording(lessonId, assetId, durationMs)
    LIVE->>DB: UPDATE LiveSession(status=ENDED)
```

### Student enrollment (invite → register → pay → approve)

```mermaid
sequenceDiagram
    actor T as Teacher
    actor S as Student
    participant W as Web
    participant API as NestJS API
    participant ENR as enrollment module
    participant BM as billing module
    participant PAYME as Payme Gateway
    participant DB as Postgres

    T->>W: /groups/:id/invite
    W->>API: POST /enrollment/invite-links
    API->>ENR: createInvite(groupId, ttl)
    ENR->>DB: INSERT InviteLink(token, expiresAt)
    ENR-->>W: { url: https://edubridge.uz/i/{token} }
    T->>S: shares link
    S->>W: opens /i/{token}
    W->>API: GET /enrollment/invite/:token
    API->>ENR: resolveInvite(token)
    ENR-->>W: { groupSummary, priceUzs }
    S->>W: register (or login)
    W->>API: POST /auth/register (role=STUDENT, inviteToken)
    API->>AUTH: register; link inviteToken to user
    S->>W: clicks "Pay"
    W->>API: POST /billing/checkout (groupId, inviteToken)
    API->>BM: createCheckout()
    BM->>DB: INSERT PaymeTransaction(state=PENDING, idempotencyKey)
    BM->>PAYME: prepare receipts.create
    PAYME-->>BM: receipt_id, pay_url
    BM-->>W: { payUrl }
    S->>PAYME: pay (card)
    PAYME->>API: POST /billing/payme/webhook (Perform/Check/Cancel)
    API->>BM: handleWebhook(authHeader, body)
    BM->>BM: verify Basic Auth + JSON-RPC method
    BM->>DB: BEGIN TX
    BM->>DB: UPDATE PaymeTransaction SET state=PAID
    BM->>DB: INSERT EnrollmentRequest(status=PENDING_APPROVAL)
    BM->>DB: INSERT outbox_event(payment.succeeded)
    BM->>DB: COMMIT
    BM-->>PAYME: JSON-RPC result
    Note over BM: outbox dispatcher → notify teacher + student
    T->>W: /requests
    T->>API: POST /enrollment/requests/:id/approve
    API->>ENR: approve(id, teacherId)
    ENR->>DB: UPDATE EnrollmentRequest(status=APPROVED)
    ENR->>DB: INSERT Enrollment(studentId, groupId, status=ACTIVE)
    ENR->>NOTIF: emit enrollment.approved
    NOTIF->>S: notify "you can now access the group"
```

### Public discovery — search → public profile → DM → enroll

```mermaid
sequenceDiagram
    actor V as Visitor
    participant W as Web (marketing)
    participant API as NestJS API
    participant DISC as discovery module
    participant AUTH as auth module
    participant CHAT as chat module
    participant BM as billing module
    participant ENR as enrollment module
    participant PAYME as Payme
    participant DB as Postgres

    V->>W: opens /search?q=ingliz%20tili
    W->>API: GET /discovery/teachers?q=ingliz tili
    API->>DISC: searchTeachers(q, specialtyId?)
    DISC->>DB: FTS + trigram on TeacherProfile/Course/Group<br/>WHERE Group.isDiscoverable = true
    DISC-->>W: teachers[] (name, photo, specialty, rating, courseCount)
    V->>W: clicks card → /t/{slug}
    W->>API: GET /discovery/teachers/:slug
    API->>DISC: getPublicProfile(slug)
    DISC-->>W: { teacher, courses[], groups[] (only isDiscoverable=true) }
    V->>W: clicks "Message teacher"
    W-->>V: redirects to /register?role=STUDENT&intent=DM&teacher={id}
    V->>API: POST /auth/register (role=STUDENT)
    API->>AUTH: register(dto)
    AUTH-->>V: 200 OK (email verify)
    V->>W: returns to teacher profile, clicks DM
    W->>API: POST /chat/dm/{teacherId}/messages
    API->>CHAT: sendDm(authorId, teacherId, body)
    CHAT->>CHAT: enforce rate limit (1/min until reciprocated)
    CHAT->>DB: UPSERT ChatRoom(scope=DM, scopeRef=sortedPair)
    CHAT->>DB: INSERT ChatMessage
    CHAT->>NOTIF: emit chat.message.sent (notify teacher)
    Note over V: visitor decides to enroll
    V->>W: clicks "Enroll" on a course
    W->>API: POST /billing/student/checkout (groupId)
    API->>BM: createCheckout (no inviteToken needed)
    BM->>DB: INSERT PaymeTransaction(state=PENDING)
    BM->>PAYME: receipts.create
    PAYME-->>BM: payUrl
    BM-->>W: { payUrl }
    V->>PAYME: pay
    PAYME->>API: webhook (PerformTransaction)
    API->>BM: handleWebhook (existing flow)
    BM->>DB: UPDATE Invoice=PAID + INSERT EnrollmentRequest(PENDING_APPROVAL)
    Note over BM,ENR: from here, identical to invite-link path<br/>(teacher approve → Enrollment row)
```

### Homework submission + AI-assisted grading

```mermaid
sequenceDiagram
    actor S as Student
    actor T as Teacher
    participant W as Web
    participant API as NestJS API
    participant HW as homework module
    participant AI as ai gateway
    participant CL as Claude API
    participant DB as Postgres

    S->>W: writing module (assignment)
    W->>API: POST /homework/submissions/draft (autosave every 10s)
    API->>HW: upsertDraft(dto)
    HW->>DB: UPSERT Submission(status=DRAFT, lastEditedAt)
    S->>W: ask AI "explain rule"
    W->>API: POST /ai/tutor (intent=EXPLAIN, text)
    API->>AI: tutor(intent, text, userId)
    AI->>AI: enforce policy (no completion)
    AI->>CL: messages.create (system="never write the answer")
    CL-->>AI: explanation
    AI->>DB: INSERT AiCall(intent=EXPLAIN, costUsd)
    AI-->>W: { explanation }
    S->>W: submit final
    W->>API: POST /homework/submissions/:id/submit
    API->>HW: submit(id)
    HW->>DB: UPDATE Submission(status=SUBMITTED, submittedAt)
    HW->>Q: enqueue ai.grade.precheck
    Q->>AI: gradePrecheck(submissionId)
    AI->>AI: AI-text detector (perplexity + Claude classify)
    AI->>CL: messages.create (template=GRADING_RUBRIC)
    CL-->>AI: { errors, suggestions, aiLikelihood }
    AI->>DB: INSERT Feedback(authorType=AI_DRAFT, payload)
    AI->>DB: UPDATE Submission(status=IN_REVIEW, aiFlagged=?)
    AI->>NOTIF: notify teacher "review ready"
    T->>W: open submission
    W-->>T: student text + AI draft (red highlights)
    T->>W: edit & approve / reject
    T->>API: POST /homework/submissions/:id/grade (score, feedback)
    API->>HW: gradeFinal(dto)
    HW->>DB: UPDATE Submission(status=GRADED, score, finalFeedback)
    HW->>NOTIF: emit submission.graded
    NOTIF->>S: in-app + push
```

### Schedule change → fan-out notification

```mermaid
sequenceDiagram
    actor T as Teacher
    participant W as Web
    participant API as NestJS API
    participant CAT as catalog module
    participant NOTIF as notifications
    participant Q as BullMQ
    participant DB as Postgres
    actor S as Students

    T->>W: edit recurring schedule
    W->>API: PUT /catalog/groups/:id/schedule
    API->>CAT: updateSchedule(dto)
    CAT->>DB: BEGIN TX
    CAT->>DB: UPDATE Schedule(rrule)
    CAT->>DB: INSERT outbox_event(schedule.changed, idempotencyKey=hash(groupId,version))
    CAT->>DB: COMMIT
    CAT-->>W: 200 OK
    Q->>Q: outbox dispatcher picks event
    Q->>NOTIF: handle schedule.changed
    NOTIF->>DB: SELECT enrolled students (status=ACTIVE)
    loop for each student
        NOTIF->>DB: INSERT Notification(idempotencyKey=key+studentId) ON CONFLICT DO NOTHING
    end
    NOTIF->>Q: enqueue per-channel delivery
    Q->>S: in-app + email + telegram
```


---

## Data Models

To'liq Prisma sxemasi quyidagicha. Sxema **Phase 1 → Phase 7** uchun yetarli. Keyingi fazalarda kichik kengaytmalar
(masalan, `MobileDeviceToken`, `AnalyticsSnapshot`) qo'shiladi. Sxema `packages/db/prisma/schema.prisma`
ga joylashtiriladi.

```prisma
// packages/db/prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
  previewFeatures = ["fullTextSearchPostgres", "postgresqlExtensions"]
}

datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  extensions = [pgcrypto, pg_trgm, citext]
}

// ============ ENUMS ============

enum UserRole {
  STUDENT
  TEACHER
  ADMIN
}

enum UserStatus {
  PENDING_VERIFY
  ACTIVE
  SUSPENDED
  DELETED
}

enum SubscriptionStatus {
  TRIAL
  ACTIVE
  PAST_DUE
  CANCELED
  EXPIRED
}

enum PaymeTxState {
  PENDING       // 0
  CREATED       // 1 (CreateTransaction)
  PAID          // 2 (PerformTransaction)
  CANCELED      // -1
  CANCELED_AFTER_PAY // -2
}

enum LessonType {
  RECORDED
  LIVE
  HYBRID
  TEXT_ONLY
}

enum LessonStatus {
  DRAFT
  READY
  ARCHIVED
}

enum LiveSessionStatus {
  SCHEDULED
  STARTING
  LIVE
  ENDED
  RECORDING_FAILED
}

enum EnrollmentStatus {
  PENDING_PAYMENT
  PENDING_APPROVAL
  APPROVED
  REJECTED
  REVOKED
}

enum SubmissionStatus {
  DRAFT
  SUBMITTED
  IN_REVIEW
  GRADED
  RETURNED
}

enum HomeworkModuleType {
  // Language-learning modules
  WRITING
  READING
  LISTENING
  GRAMMAR
  SPELLING
  VOCABULARY
  SPEAKING
  PRONUNCIATION
  // Generic interactive question types
  MULTIPLE_CHOICE
  GAP_FILL
  MATCHING
  DRAG_DROP
  // Project / case-based modules (used by SMM, business, etc.)
  PROJECT_SUBMISSION
  CASE_STUDY
  MARKETING_COPY
  AUDIENCE_ANALYSIS
  CONTENT_CALENDAR
  // Math modules
  MATH_WORD_PROBLEM
  MATH_EQUATION_SOLVER
  MATH_GEOMETRY_PROOF
  // Code modules
  CODE_REVIEW
  CODE_UNIT_TEST
}

enum AiIntent {
  TUTOR_EXPLAIN
  TUTOR_TRANSLATE
  TUTOR_EXAMPLE
  GRADE_PRECHECK
  AI_TEXT_DETECT
  SPECIALTY_CLASSIFY
}

enum NotificationChannel {
  IN_APP
  EMAIL
  TELEGRAM
  PUSH
}

enum NotificationKind {
  ENROLLMENT_APPROVED
  ENROLLMENT_REJECTED
  PAYMENT_SUCCEEDED
  PAYMENT_FAILED
  LESSON_PUBLISHED
  SCHEDULE_CHANGED
  LIVE_STARTED
  LIVE_REMINDER
  HOMEWORK_ASSIGNED
  HOMEWORK_GRADED
  AI_REVIEW_READY
  TRIAL_ENDING
  SUBSCRIPTION_PAST_DUE
}

enum MediaKind {
  VIDEO
  AUDIO
  IMAGE
  PDF
  DOC
  SHEET
  RECORDING
  OTHER
}

enum AssetStatus {
  UPLOADING
  UPLOADED
  TRANSCODING
  READY
  FAILED
}

// ============ AUTH / USERS ============

model User {
  id                String        @id @default(uuid()) @db.Uuid
  email             String        @unique @db.Citext
  phone             String?       @unique
  passwordHash      String
  role              UserRole
  status            UserStatus    @default(PENDING_VERIFY)
  fullName          String
  avatarUrl         String?
  locale            String        @default("uz")
  createdAt         DateTime      @default(now())
  updatedAt         DateTime      @updatedAt

  sessions          Session[]
  emailVerifications EmailVerification[]
  passwordResets    PasswordReset[]

  teacherProfile    TeacherProfile?
  studentProfile    StudentProfile?

  notifications     Notification[]
  notificationPrefs NotificationPreference[]
  aiCalls           AiCall[]
  auditLogs         AdminAuditLog[]

  @@index([role, status])
}

model Session {
  id            String   @id @default(uuid()) @db.Uuid
  userId        String   @db.Uuid
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  refreshTokenHash String
  userAgent     String?
  ip            String?
  expiresAt     DateTime
  revokedAt     DateTime?
  createdAt     DateTime @default(now())

  @@index([userId])
}

model EmailVerification {
  id        String   @id @default(uuid()) @db.Uuid
  userId    String   @db.Uuid
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash String   @unique
  expiresAt DateTime
  consumedAt DateTime?
  createdAt DateTime @default(now())
}

model PasswordReset {
  id        String   @id @default(uuid()) @db.Uuid
  userId    String   @db.Uuid
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash String   @unique
  expiresAt DateTime
  consumedAt DateTime?
  createdAt DateTime @default(now())
}

// ============ TEACHER ============

model Specialty {
  id           String   @id @default(uuid()) @db.Uuid
  slug         String   @unique  // "english", "math", "smm", ...
  nameUz       String
  nameRu       String
  nameEn       String
  isActive     Boolean  @default(true)
  dashboardKey String   // routes/templates the FE uses
  createdAt    DateTime @default(now())

  teachers     TeacherProfile[]
  questions    OnboardingQuestion[]
  modules      SpecialtyModule[]
}

/// Specialty ↔ HomeworkModuleType mapping (admin-managed).
/// Determines which homework module types make up the curated catalog of a
/// given specialty. A module may apply to multiple specialties (e.g.,
/// VOCABULARY → english, russian, uzbek-as-l2).
///
/// Per-Specialty hard cap: at most 10 rows with `isActive = true` per
/// `specialtyId`. Enforced at two layers:
///   1. Service-layer guard in the admin module before insert/update.
///   2. DB-level deferred constraint trigger `enforce_specialty_module_cap()`
///      added via raw SQL migration (see "Specialty cap trigger" below).
///
/// `defaultEnabled` controls the seed value of `GroupModule.isEnabled` when a
/// Group is created in the corresponding specialty (e.g., admin marks
/// reading/writing/listening/speaking as `defaultEnabled=true` for English so
/// every new English Group has them ON by default).
model SpecialtyModule {
  specialtyId    String             @db.Uuid
  specialty      Specialty          @relation(fields: [specialtyId], references: [id], onDelete: Cascade)
  moduleType     HomeworkModuleType
  isActive       Boolean            @default(true)
  /// Seed value applied to GroupModule.isEnabled when a Group of this specialty is created.
  defaultEnabled Boolean            @default(false)
  createdAt      DateTime           @default(now())
  updatedAt      DateTime           @updatedAt

  @@id([specialtyId, moduleType])
  @@index([specialtyId, isActive])
}

model TeacherProfile {
  userId        String     @id @db.Uuid
  user          User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  specialtyId   String?    @db.Uuid
  specialty     Specialty? @relation(fields: [specialtyId], references: [id])
  bio           String?
  yearsOfExperience Int?
  onboardingCompletedAt DateTime?
  createdAt     DateTime   @default(now())

  // === Public discovery (Phase 5) ===
  /// Stable public slug used for URLs like edubridge.uz/t/{slug}.
  /// Null until teacher publishes their profile (or admin generates one).
  publicSlug    String?    @unique
  /// One-line headline shown on search cards (e.g., "IELTS 8.0 instructor, 7y experience").
  headline      String?
  /// Full-name field denormalized from User.fullName for FTS/trigram indexing.
  /// Updated by an event handler on `user.profile_updated`.
  fullName      String?
  /// Optional cover image (R2) for the public profile page.
  coverUrl      String?
  /// Aggregated rating (0..5), denormalised. Null until first review.
  rating        Decimal?   @db.Decimal(3, 2)
  /// Denormalised count of currently-active enrolled students; updated by an
  /// event handler subscribed to enrollment.approved / enrollment.revoked.
  studentsCount Int        @default(0)

  subscriptions Subscription[]
  courses       Course[]
  onboardingAnswers OnboardingAnswer[]
  invoices      Invoice[]

  // FTS / trigram indexes added via raw SQL migration:
  //   CREATE INDEX teacher_profile_fullname_trgm_idx
  //     ON "TeacherProfile" USING GIN (full_name gin_trgm_ops);
  //   CREATE INDEX teacher_profile_headline_trgm_idx
  //     ON "TeacherProfile" USING GIN (headline gin_trgm_ops);
  @@index([specialtyId])
}

model OnboardingQuestion {
  id           String   @id @default(uuid()) @db.Uuid
  specialtyId  String?  @db.Uuid
  specialty    Specialty? @relation(fields: [specialtyId], references: [id])
  order        Int
  // multilingual
  textUz       String
  textRu       String
  textEn       String
  /// JSON: [{ id, label_uz, label_ru, label_en, weight: { specialtySlug: number } }]
  optionsJson  Json
  isActive     Boolean  @default(true)

  answers      OnboardingAnswer[]

  @@index([specialtyId, order])
}

model OnboardingAnswer {
  id           String   @id @default(uuid()) @db.Uuid
  teacherId    String   @db.Uuid
  teacher      TeacherProfile @relation(fields: [teacherId], references: [userId], onDelete: Cascade)
  questionId   String   @db.Uuid
  question     OnboardingQuestion @relation(fields: [questionId], references: [id])
  selectedOptionId String
  createdAt    DateTime @default(now())

  @@unique([teacherId, questionId])
}

model StudentProfile {
  userId        String   @id @db.Uuid
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  dateOfBirth   DateTime?
  primaryLocale String   @default("uz")
  enrollments   Enrollment[]
  enrollmentRequests EnrollmentRequest[]
  submissions   Submission[]
}

// ============ BILLING ============

model Plan {
  id           String   @id @default(uuid()) @db.Uuid
  slug         String   @unique
  nameUz       String
  priceUzs     Int
  intervalDays Int      // 30 = monthly
  maxStudents  Int?     // null = unlimited
  features     Json
  isActive     Boolean  @default(true)
}

model Subscription {
  id            String   @id @default(uuid()) @db.Uuid
  teacherId     String   @db.Uuid
  teacher       TeacherProfile @relation(fields: [teacherId], references: [userId], onDelete: Cascade)
  planId        String?  @db.Uuid
  plan          Plan?    @relation(fields: [planId], references: [id])
  status        SubscriptionStatus
  trialEndsAt   DateTime?
  currentPeriodStart DateTime?
  currentPeriodEnd   DateTime?
  cancelAt      DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  invoices      Invoice[]

  // Invariant: teacher has at most one non-terminal subscription at a time
  @@unique([teacherId, status], name: "teacher_status_unique")
  @@index([status, currentPeriodEnd])

  @@map("subscriptions")
}

model Invoice {
  id            String   @id @default(uuid()) @db.Uuid
  subscriptionId String? @db.Uuid
  subscription  Subscription? @relation(fields: [subscriptionId], references: [id])
  teacherId     String?  @db.Uuid
  teacher       TeacherProfile? @relation(fields: [teacherId], references: [userId])
  studentId     String?  @db.Uuid
  groupId       String?  @db.Uuid
  group         Group?   @relation(fields: [groupId], references: [id])
  kind          String   // "TEACHER_SUBSCRIPTION" | "STUDENT_COURSE"
  amountUzs     Int
  status        String   // "PENDING" | "PAID" | "VOID" | "REFUNDED"
  paymeTxId     String?  @db.Uuid
  paymeTx       PaymeTransaction? @relation(fields: [paymeTxId], references: [id])
  issuedAt      DateTime @default(now())
  paidAt        DateTime?

  @@index([teacherId, status])
  @@index([groupId, studentId, status])
}

model PaymeTransaction {
  id              String   @id @default(uuid()) @db.Uuid
  /// Payme-side id
  paymeId         String?  @unique
  /// our internal account binding (e.g., invoiceId)
  account         Json
  amountUzs       Int
  state           PaymeTxState @default(PENDING)
  createTime      BigInt?
  performTime     BigInt?
  cancelTime      BigInt?
  reason          Int?
  rawPayload      Json?
  idempotencyKey  String   @unique
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  invoices        Invoice[]

  @@index([state, createdAt])
}

// ============ CATALOG ============

model Course {
  id          String   @id @default(uuid()) @db.Uuid
  teacherId   String   @db.Uuid
  teacher     TeacherProfile @relation(fields: [teacherId], references: [userId], onDelete: Cascade)
  title       String
  description String?
  level       String?  // "A1", "B2", "Beginner", ...
  coverUrl    String?
  isPublished Boolean  @default(false)
  /// Whether this course appears in public discovery search results.
  /// `false` keeps the course visible only to enrolled students and the teacher.
  isDiscoverable Boolean @default(true)
  /// Optional "from" price shown on discovery cards; computed/denormalised
  /// from cheapest non-archived Group.priceUzs.
  fromPriceUzs Int?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  groups      Group[]

  @@index([teacherId, isPublished])
  @@index([isPublished, isDiscoverable])
  // FTS/trigram on title added via raw SQL migration:
  //   CREATE INDEX course_title_trgm_idx ON "Course" USING GIN (title gin_trgm_ops);
}

model Group {
  id            String   @id @default(uuid()) @db.Uuid
  courseId      String   @db.Uuid
  course        Course   @relation(fields: [courseId], references: [id], onDelete: Cascade)
  name          String
  priceUzs      Int      @default(0)
  capacity      Int?
  startsOn      DateTime?
  endsOn        DateTime?
  status        String   @default("OPEN")  // OPEN | CLOSED | ARCHIVED
  /// Whether this group appears in public discovery search results.
  /// Default `true`; teacher may flip to `false` for private/closed groups.
  /// Hidden groups are still reachable by direct invite link.
  isDiscoverable Boolean @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  schedule      Schedule?
  scheduleExceptions ScheduleException[]
  lessons       Lesson[]
  inviteLinks   InviteLink[]
  enrollments   Enrollment[]
  enrollmentRequests EnrollmentRequest[]
  invoices      Invoice[]
  /// Per-Group module toggles, seeded from the teacher's SpecialtyModule
  /// catalog when this Group is created. See `GroupModule`.
  modules       GroupModule[]

  @@index([courseId, status])
  @@index([status, isDiscoverable])
  // FTS/trigram on name added via raw SQL migration:
  //   CREATE INDEX group_name_trgm_idx ON "Group" USING GIN (name gin_trgm_ops);
}

/// Per-Group module toggle. When a Group is created, the system seeds one row
/// per (groupId, moduleType) for each entry in SpecialtyModule of the teacher's
/// specialty, with isEnabled=false (or =SpecialtyModule.defaultEnabled if set).
/// Teacher toggles isEnabled at any time. Disabling is non-destructive: past
/// AssignmentModule rows referencing the module continue to function.
model GroupModule {
  groupId     String             @db.Uuid
  group       Group              @relation(fields: [groupId], references: [id], onDelete: Cascade)
  moduleType  HomeworkModuleType
  isEnabled   Boolean            @default(false)
  enabledAt   DateTime?
  disabledAt  DateTime?
  createdAt   DateTime           @default(now())
  updatedAt   DateTime           @updatedAt

  @@id([groupId, moduleType])
  @@index([groupId, isEnabled])
}

model Schedule {
  id        String   @id @default(uuid()) @db.Uuid
  groupId   String   @unique @db.Uuid
  group     Group    @relation(fields: [groupId], references: [id], onDelete: Cascade)
  /// RRULE string per RFC 5545, e.g., "FREQ=WEEKLY;BYDAY=TU,TH,SA;BYHOUR=20;BYMINUTE=0"
  rrule     String
  timezone  String   @default("Asia/Tashkent")
  durationMin Int
  /// monotonic version counter (used for notification idempotency key)
  version   Int      @default(1)
  updatedAt DateTime @updatedAt
}

model ScheduleException {
  id        String   @id @default(uuid()) @db.Uuid
  groupId   String   @db.Uuid
  group     Group    @relation(fields: [groupId], references: [id], onDelete: Cascade)
  /// the original occurrence date being replaced/cancelled
  originalAt DateTime
  cancelled Boolean  @default(false)
  newAt     DateTime?
  reason    String?

  @@index([groupId, originalAt])
}

model Lesson {
  id          String     @id @default(uuid()) @db.Uuid
  groupId     String     @db.Uuid
  group       Group      @relation(fields: [groupId], references: [id], onDelete: Cascade)
  title       String
  description String?
  type        LessonType
  status      LessonStatus @default(DRAFT)
  /// ordering within group (gap-allowed)
  position    Int        @default(0)
  scheduledAt DateTime?
  publishedAt DateTime?
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  attachments Attachment[]
  liveSessions LiveSession[]
  recordings  Recording[]
  assignments Assignment[]

  @@index([groupId, status])
  @@index([groupId, position])
}

model Attachment {
  id         String      @id @default(uuid()) @db.Uuid
  lessonId   String      @db.Uuid
  lesson     Lesson      @relation(fields: [lessonId], references: [id], onDelete: Cascade)
  assetId    String      @db.Uuid
  asset      MediaAsset  @relation(fields: [assetId], references: [id])
  kind       MediaKind
  /// "primary" video, supplementary doc, voice-message, etc.
  role       String      @default("supplementary")
  position   Int         @default(0)
  createdAt  DateTime    @default(now())

  @@index([lessonId])
}

// ============ ENROLLMENT ============

model InviteLink {
  id         String   @id @default(uuid()) @db.Uuid
  groupId    String   @db.Uuid
  group      Group    @relation(fields: [groupId], references: [id], onDelete: Cascade)
  token      String   @unique
  createdById String  @db.Uuid
  expiresAt  DateTime?
  usesLimit  Int?
  usesCount  Int      @default(0)
  isActive   Boolean  @default(true)
  createdAt  DateTime @default(now())

  @@index([groupId, isActive])
}

model EnrollmentRequest {
  id            String   @id @default(uuid()) @db.Uuid
  groupId       String   @db.Uuid
  group         Group    @relation(fields: [groupId], references: [id], onDelete: Cascade)
  studentId     String   @db.Uuid
  student       StudentProfile @relation(fields: [studentId], references: [userId], onDelete: Cascade)
  inviteLinkId  String?  @db.Uuid
  invoiceId     String?  @db.Uuid
  status        EnrollmentStatus @default(PENDING_PAYMENT)
  message       String?
  createdAt     DateTime @default(now())
  decidedAt     DateTime?
  decidedById   String?  @db.Uuid

  @@unique([groupId, studentId])
  @@index([status, createdAt])
}

model Enrollment {
  id            String   @id @default(uuid()) @db.Uuid
  groupId       String   @db.Uuid
  group         Group    @relation(fields: [groupId], references: [id], onDelete: Cascade)
  studentId     String   @db.Uuid
  student       StudentProfile @relation(fields: [studentId], references: [userId], onDelete: Cascade)
  status        EnrollmentStatus @default(APPROVED)
  approvedAt    DateTime @default(now())
  revokedAt     DateTime?
  /// snapshot of the invoice id that authorised this enrollment
  invoiceId     String?  @db.Uuid

  submissions   Submission[]

  @@unique([groupId, studentId])
  @@index([studentId, status])
}

// ============ MEDIA ============

model MediaAsset {
  id            String      @id @default(uuid()) @db.Uuid
  ownerUserId   String      @db.Uuid
  kind          MediaKind
  status        AssetStatus @default(UPLOADING)
  bytes         BigInt?
  contentType   String?
  /// R2 keys
  originalKey   String?
  hlsManifestKey String?
  thumbnailKey  String?
  durationMs    Int?
  /// JSON: { variants: [{ height, bitrate, key }] }
  metadata      Json?
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt

  attachments   Attachment[]
  recordings    Recording[]
  transcodingJobs TranscodingJob[]
}

model TranscodingJob {
  id          String   @id @default(uuid()) @db.Uuid
  assetId     String   @db.Uuid
  asset       MediaAsset @relation(fields: [assetId], references: [id], onDelete: Cascade)
  status      String   // QUEUED|RUNNING|DONE|FAILED
  attempt     Int      @default(0)
  errorMsg    String?
  startedAt   DateTime?
  finishedAt  DateTime?
  createdAt   DateTime @default(now())

  @@index([status, createdAt])
}

// ============ LIVE ============

model LiveSession {
  id          String   @id @default(uuid()) @db.Uuid
  lessonId    String   @db.Uuid
  lesson      Lesson   @relation(fields: [lessonId], references: [id], onDelete: Cascade)
  status      LiveSessionStatus @default(SCHEDULED)
  startedAt   DateTime?
  endedAt     DateTime?
  /// signaling room id (mediasoup router id reference)
  roomId      String?  @unique
  /// active recorder process ref (k8s pod name)
  recorderRef String?
  participants LiveParticipant[]
  recordings   Recording[]

  @@index([lessonId, status])
}

model LiveParticipant {
  id         String   @id @default(uuid()) @db.Uuid
  sessionId  String   @db.Uuid
  session    LiveSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  userId     String   @db.Uuid
  joinedAt   DateTime @default(now())
  leftAt     DateTime?
  role       String   // HOST | VIEWER

  @@index([sessionId])
}

model Recording {
  id           String     @id @default(uuid()) @db.Uuid
  lessonId     String     @db.Uuid
  lesson       Lesson     @relation(fields: [lessonId], references: [id], onDelete: Cascade)
  sessionId    String?    @unique @db.Uuid
  session      LiveSession? @relation(fields: [sessionId], references: [id])
  assetId      String?    @db.Uuid
  asset        MediaAsset? @relation(fields: [assetId], references: [id])
  durationMs   Int?
  status       String     // RECORDING | READY | FAILED
  createdAt    DateTime   @default(now())
}

// ============ HOMEWORK ============

model Assignment {
  id         String   @id @default(uuid()) @db.Uuid
  lessonId   String   @db.Uuid
  lesson     Lesson   @relation(fields: [lessonId], references: [id], onDelete: Cascade)
  title      String
  description String?
  dueAt      DateTime?
  totalPoints Int     @default(100)
  isPublished Boolean @default(false)
  modules    AssignmentModule[]
  submissions Submission[]
  createdAt  DateTime @default(now())
}

model AssignmentModule {
  id           String   @id @default(uuid()) @db.Uuid
  assignmentId String   @db.Uuid
  assignment   Assignment @relation(fields: [assignmentId], references: [id], onDelete: Cascade)
  type         HomeworkModuleType
  order        Int
  /// schema-versioned config per type (rubric, passages, audio refs, etc.)
  configJson   Json
  weight       Int      @default(100)

  @@index([assignmentId, order])
}

model Submission {
  id           String   @id @default(uuid()) @db.Uuid
  assignmentId String   @db.Uuid
  assignment   Assignment @relation(fields: [assignmentId], references: [id], onDelete: Cascade)
  studentId    String   @db.Uuid
  student      StudentProfile @relation(fields: [studentId], references: [userId], onDelete: Cascade)
  enrollmentId String?  @db.Uuid
  enrollment   Enrollment? @relation(fields: [enrollmentId], references: [id])
  status       SubmissionStatus @default(DRAFT)
  /// JSON keyed by module id: { [moduleId]: { answers: ..., timeSpentMs: ... } }
  answersJson  Json
  /// score 0..totalPoints, null until graded
  score        Int?
  aiFlagged    Boolean  @default(false)
  aiLikelihood Float?   // 0..1 — AI text detection confidence
  submittedAt  DateTime?
  gradedAt     DateTime?
  feedbacks    Feedback[]
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@unique([assignmentId, studentId])
  @@index([studentId, status])
}

model Feedback {
  id           String   @id @default(uuid()) @db.Uuid
  submissionId String   @db.Uuid
  submission   Submission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
  authorType   String   // AI_DRAFT | TEACHER
  authorId     String?  @db.Uuid
  /// rich JSON: { highlights: [{from,to,reason,severity}], comments: [...] }
  payload      Json
  isFinal      Boolean  @default(false)
  createdAt    DateTime @default(now())
}

// ============ AI ============

model AiPromptTemplate {
  id          String   @id @default(uuid()) @db.Uuid
  key         String   @unique  // e.g., "writing.precheck.v1"
  intent      AiIntent
  systemText  String
  userTemplate String  // mustache-like {{variables}}
  modelName   String   @default("claude-3-5-sonnet-latest")
  maxTokens   Int      @default(2000)
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
}

model AiCall {
  id            String   @id @default(uuid()) @db.Uuid
  userId        String?  @db.Uuid
  user          User?    @relation(fields: [userId], references: [id])
  intent        AiIntent
  templateKey   String
  modelName     String
  inputTokens   Int
  outputTokens  Int
  costUsd       Decimal  @db.Decimal(10, 6)
  latencyMs     Int
  /// references to domain entity, e.g., submissionId
  refType       String?
  refId         String?
  status        String   // OK | ERROR | RATE_LIMITED | POLICY_BLOCKED
  errorMsg      String?
  createdAt     DateTime @default(now())

  @@index([userId, createdAt])
  @@index([intent, createdAt])
}

// ============ NOTIFICATIONS ============

model Notification {
  id            String   @id @default(uuid()) @db.Uuid
  userId        String   @db.Uuid
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  kind          NotificationKind
  title         String
  body          String
  /// arbitrary contextual payload (e.g., lessonId)
  data          Json?
  /// idempotency key for fan-out dedup
  idempotencyKey String  @unique
  readAt        DateTime?
  createdAt     DateTime @default(now())
  deliveries    NotificationDelivery[]

  @@index([userId, readAt])
}

model NotificationDelivery {
  id              String   @id @default(uuid()) @db.Uuid
  notificationId  String   @db.Uuid
  notification    Notification @relation(fields: [notificationId], references: [id], onDelete: Cascade)
  channel         NotificationChannel
  status          String   // QUEUED | SENT | FAILED | SKIPPED
  attempt         Int      @default(0)
  providerRef     String?  // SES message id, telegram update id, ...
  errorMsg        String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([notificationId, channel])
}

model NotificationPreference {
  id        String   @id @default(uuid()) @db.Uuid
  userId    String   @db.Uuid
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  kind      NotificationKind
  channel   NotificationChannel
  enabled   Boolean  @default(true)

  @@unique([userId, kind, channel])
}

// ============ CHAT ============

model ChatRoom {
  id        String   @id @default(uuid()) @db.Uuid
  /// scope: "GROUP" | "LIVE_SESSION" | "DM"
  scope     String
  /// Foreign id depends on scope:
  ///  - "GROUP"        → groupId
  ///  - "LIVE_SESSION" → liveSessionId
  ///  - "DM"           → sorted pair "min(userIdA,userIdB):max(userIdA,userIdB)"
  ///                     (lazily created on first DM; sorting prevents
  ///                      two rooms for the same pair).
  scopeRef  String
  createdAt DateTime @default(now())

  messages  ChatMessage[]

  @@unique([scope, scopeRef])
}

model ChatMessage {
  id        String   @id @default(uuid()) @db.Uuid
  roomId    String   @db.Uuid
  room      ChatRoom @relation(fields: [roomId], references: [id], onDelete: Cascade)
  authorId  String   @db.Uuid
  body      String
  /// optional attachment asset
  assetId   String?  @db.Uuid
  /// for moderation
  deletedAt DateTime?
  createdAt DateTime @default(now())

  @@index([roomId, createdAt])
}

// ============ ADMIN / OUTBOX ============

model AdminAuditLog {
  id        String   @id @default(uuid()) @db.Uuid
  actorId   String?  @db.Uuid
  actor     User?    @relation(fields: [actorId], references: [id])
  action    String
  target    String?
  payload   Json?
  ip        String?
  createdAt DateTime @default(now())

  @@index([actorId, createdAt])
}

model OutboxEvent {
  id              String   @id @default(uuid()) @db.Uuid
  topic           String
  payload         Json
  /// idempotency key for downstream consumers
  idempotencyKey  String   @unique
  status          String   @default("PENDING") // PENDING|DISPATCHED|FAILED
  attempt         Int      @default(0)
  nextAttemptAt   DateTime @default(now())
  lastError       String?
  createdAt       DateTime @default(now())
  dispatchedAt    DateTime?

  @@index([status, nextAttemptAt])
}

model IdempotencyRecord {
  key        String   @id
  scope      String   // e.g., "POST /enrollment/checkout"
  userId     String?  @db.Uuid
  responseHash String
  responseBody Json
  statusCode Int
  expiresAt  DateTime

  @@index([expiresAt])
}
```

### Sxema bo'yicha asosiy invariantlar (DB darajasida)

| Invariant | Qaerda kuchaytiriladi |
|---|---|
| `Subscription` per teacher: bitta non-terminal | `@@unique([teacherId, status])` + check constraint partial |
| `Enrollment` per (group, student): bitta | `@@unique([groupId, studentId])` |
| `EnrollmentRequest` per (group, student): bitta | `@@unique([groupId, studentId])` |
| `Submission` per (assignment, student): bitta | `@@unique([assignmentId, studentId])` |
| `Notification` idempotency | `@unique idempotencyKey` |
| `OutboxEvent` idempotency | `@unique idempotencyKey` |
| `PaymeTransaction` idempotency | `@unique idempotencyKey` |
| `IdempotencyRecord` per request | PK `key` |

**Partial unique index** (Prisma'da raw SQL migration sifatida) — `subscriptions` jadvali uchun:

```sql
-- only one ACTIVE/TRIAL/PAST_DUE per teacher
CREATE UNIQUE INDEX subscriptions_teacher_active_uniq
ON subscriptions(teacherId)
WHERE status IN ('TRIAL', 'ACTIVE', 'PAST_DUE');
```

**Specialty cap trigger** (Prisma'da raw SQL migration sifatida) — har bir Specialty
uchun **eng ko'pi bilan 10 ta active `SpecialtyModule`** kafolatlanadi. Birinchi
himoya qatlami service-layer guard'da (admin moduli), ikkinchisi — DB-level
deferred constraint trigger:

```sql
-- soft-enforced via service-layer guard + a CHECK trigger
CREATE OR REPLACE FUNCTION enforce_specialty_module_cap() RETURNS trigger AS $$
DECLARE active_count INT;
BEGIN
  SELECT COUNT(*) INTO active_count
  FROM "SpecialtyModule"
  WHERE "specialtyId" = NEW."specialtyId" AND "isActive" = true;
  IF active_count > 10 THEN
    RAISE EXCEPTION 'specialty_module_cap_exceeded: max 10 active modules per specialty';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER specialty_module_cap_trigger
AFTER INSERT OR UPDATE ON "SpecialtyModule"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_specialty_module_cap();
```


---

## API Surface

REST + WebSocket kontrakti. Barcha REST endpointlar `/api/v1/*` prefiksi bilan; JSON; HTTP/2; bearer JWT. Pagination: `?page&pageSize`,
maksimal 100. Filterlar: `?filter[field]=value`. Sort: `?sort=field,-otherField`.

**Common headers:**
- `Authorization: Bearer <jwt>`
- `Idempotency-Key: <uuid>` (mutating endpoints uchun majburiy; serverda 24h saqlanadi)
- `Accept-Language: uz | ru | en`

**Common error envelope:**
```json
{
  "error": {
    "code": "ENROLLMENT_NOT_PAID",
    "message": "Student has not completed payment yet",
    "details": { "groupId": "..." },
    "traceId": "abc..."
  }
}
```

### Auth

| Method | Path | Body / Query | Response | Auth |
|---|---|---|---|---|
| POST | `/auth/register` | `{ email, password, fullName, role, inviteToken? }` | `{ userId }` | public |
| POST | `/auth/login` | `{ email, password }` | `{ accessToken, refreshToken, user }` | public |
| POST | `/auth/refresh` | `{ refreshToken }` | `{ accessToken, refreshToken }` | public |
| POST | `/auth/logout` | — | `204` | bearer |
| POST | `/auth/verify-email` | `{ token }` | `204` | public |
| POST | `/auth/resend-verification` | — | `204` | bearer |
| POST | `/auth/password-reset/request` | `{ email }` | `204` | public |
| POST | `/auth/password-reset/confirm` | `{ token, newPassword }` | `204` | public |
| GET  | `/auth/me` | — | `User` | bearer |

### Teacher / Onboarding

| Method | Path | Notes |
|---|---|---|
| GET  | `/teacher/onboarding/questions` | returns ordered questions in user's locale |
| POST | `/teacher/onboarding/answers` | `{ answers: [{ questionId, optionId }] }` → assigns `specialtyId` |
| GET  | `/teacher/profile` | own profile |
| PATCH| `/teacher/profile` | bio, yearsOfExperience |
| GET  | `/teacher/specialties` | catalog (admin-managed) |

### Billing

| Method | Path | Notes |
|---|---|---|
| GET  | `/billing/plans` | public |
| GET  | `/billing/subscription` | teacher's current subscription |
| POST | `/billing/subscription/checkout` | `{ planId }` → returns Payme `payUrl` |
| POST | `/billing/subscription/cancel` | scheduled cancel at periodEnd |
| POST | `/billing/student/checkout` | `{ groupId, inviteToken }` → returns `payUrl` |
| GET  | `/billing/invoices` | scoped to caller |
| POST | `/billing/payme/webhook` | **Payme JSON-RPC** (Basic Auth) — `Check/Create/Perform/Cancel/Get*Transaction(s)` |

### Catalog (Course / Group / Lesson / Schedule)

| Method | Path | Notes |
|---|---|---|
| POST  | `/catalog/courses` | teacher only |
| GET   | `/catalog/courses` | own courses |
| GET   | `/catalog/courses/:id` | |
| PATCH | `/catalog/courses/:id` | |
| POST  | `/catalog/courses/:id/groups` | |
| GET   | `/catalog/groups/:id` | |
| PATCH | `/catalog/groups/:id` | |
| PUT   | `/catalog/groups/:id/schedule` | RRULE + duration |
| POST  | `/catalog/groups/:id/schedule/exceptions` | one-off cancel/move |
| GET   | `/catalog/groups/:id/lessons` | enrollment-gated for students |
| POST  | `/catalog/groups/:id/lessons` | teacher only |
| GET   | `/catalog/lessons/:id` | enrollment-gated |
| PATCH | `/catalog/lessons/:id` | teacher only |
| POST  | `/catalog/lessons/:id/publish` | sets status=READY → fan-out |
| GET   | `/catalog/lessons/:id/attachments` | |
| POST  | `/catalog/lessons/:id/attachments` | links existing MediaAsset |

#### Group module toggles

Per-Group module switches. The toggle state lives in the `catalog` context
because Groups are owned by it; values are seeded on Group creation from the
teacher's `SpecialtyModule` catalog (`isEnabled = SpecialtyModule.defaultEnabled`).
Disabling a module is **non-destructive**: existing `AssignmentModule` rows
referencing it continue to render and grade; only the `AssignmentBuilder`
picker hides it for new assignments.

| Method | Path | Notes |
|---|---|---|
| GET   | `/catalog/groups/:id/modules` | Returns the full module catalog of the group's specialty with current toggle state: `[{ moduleType, isEnabled, defaultEnabled, displayName }]`. Authorization: group owner / co-teacher. |
| PUT   | `/catalog/groups/:id/modules` | Body: `{ modules: [{ moduleType, isEnabled }] }` — bulk upsert into `GroupModule`. Validates that every `moduleType` is in the group's specialty catalog (i.e., exists as an active `SpecialtyModule` for the teacher's specialty); rejects with `MODULE_NOT_IN_SPECIALTY_CATALOG` otherwise. Emits `group.module.toggled` per row that flipped. |
| POST  | `/catalog/groups/:id/modules/:moduleType/enable` | Convenience single-toggle. Sets `isEnabled=true`, `enabledAt=now()`. |
| POST  | `/catalog/groups/:id/modules/:moduleType/disable` | Convenience single-toggle. Sets `isEnabled=false`, `disabledAt=now()`. Non-destructive — does not touch existing assignments. |

### Media

| Method | Path | Notes |
|---|---|---|
| POST | `/media/uploads` | initiate multipart; returns `{ uploadId, partUrls[], assetId }` |
| POST | `/media/uploads/:id/complete` | finalize multipart |
| POST | `/media/uploads/:id/abort` | cleanup |
| GET  | `/media/assets/:id` | metadata + signed playback URL |

### Enrollment

| Method | Path | Notes |
|---|---|---|
| POST | `/enrollment/invite-links` | teacher creates |
| GET  | `/enrollment/invite/:token` | public — returns group preview |
| POST | `/enrollment/requests` | student initiates after payment success |
| GET  | `/enrollment/requests` | teacher inbox (filter by groupId, status) |
| POST | `/enrollment/requests/:id/approve` | teacher |
| POST | `/enrollment/requests/:id/reject` | teacher |
| GET  | `/enrollment/my` | student's enrolled groups |

### Live

| Method | Path | Notes |
|---|---|---|
| POST | `/live/sessions/:lessonId/start` | teacher |
| POST | `/live/sessions/:id/end` | teacher |
| GET  | `/live/sessions/:id` | participants need enrollment |
| GET  | `/live/sessions/:id/router-capabilities` | for client mediasoup setup |
| POST | `/live/sessions/:id/transports` | create webrtc transport |
| POST | `/live/sessions/:id/transports/:tid/connect` | dtls params |
| POST | `/live/sessions/:id/produce` | for teacher |
| POST | `/live/sessions/:id/consume` | for students |

**WebSocket namespace `/ws/live`**: events `join`, `leave`, `transport-created`,
`producer-new`, `consumer-resumed`, `chat-message`, `pin-message`, `disconnect-reason`.

### Homework

| Method | Path | Notes |
|---|---|---|
| GET   | `/homework/available-modules` | Returns the module-type picker contents for the `AssignmentBuilder`. **With `?groupId=...` (typical call from a teacher inside a Group):** returns ONLY modules currently enabled for that group — joined from `GroupModule WHERE groupId = :groupId AND isEnabled = true`. Authorization: caller must own (or co-teach) that group. **Without `groupId`:** returns the caller's specialty catalog (read-only, informational) — joined from `SpecialtyModule WHERE specialtyId = caller.specialtyId AND isActive = true`. Empty array for STUDENT/ADMIN unless `?specialtyId=` is provided. |
| POST  | `/homework/assignments` | teacher, scoped to lesson; rejects modules whose `GroupModule.isEnabled` is `false` (or absent) for the lesson's group |
| PATCH | `/homework/assignments/:id` | rejects newly-added modules whose `GroupModule.isEnabled` is `false` for the lesson's group |
| POST  | `/homework/assignments/:id/publish` | |
| GET   | `/homework/assignments/:id` | enrollment-gated |
| POST  | `/homework/submissions/draft` | autosave |
| POST  | `/homework/submissions/:id/submit` | finalize → triggers AI precheck |
| GET   | `/homework/submissions/:id` | student or assigned teacher |
| POST  | `/homework/submissions/:id/grade` | teacher final |
| POST  | `/homework/submissions/:id/return` | request rework |

### AI Gateway

| Method | Path | Notes |
|---|---|---|
| POST | `/ai/tutor` | `{ intent: EXPLAIN/TRANSLATE/EXAMPLE, context, text }` — strict policy: never produce final answer |
| POST | `/ai/translate-word` | reading module: `{ word, context }` → translation + part-of-speech |
| POST | `/ai/translate-sentence` | reading module: `{ sentence }` |
| POST | `/ai/grade/precheck` | teacher trigger if not auto-run |
| GET  | `/ai/usage` | teacher + admin: cost reports |

### Discovery (public, unauthenticated)

All endpoints read from the read replica; results are scoped to entities with
`isDiscoverable = true` and (where applicable) `isPublished = true`.

| Method | Path | Notes |
|---|---|---|
| GET | `/discovery/teachers` | Query: `q` (name/headline FTS+trigram), `specialtyId`, `page`, `pageSize`. Returns `{ id, slug, fullName, avatarUrl, headline, specialty, rating, studentsCount, courseCount }[]`. |
| GET | `/discovery/teachers/:slug` | Public profile by `TeacherProfile.publicSlug`. Returns teacher details + their published+discoverable courses + open groups (price, syllabus snippet). |
| GET | `/discovery/courses` | Query: `q`, `specialtyId`, `priceMin`, `priceMax`, `page`. Returns published+discoverable courses with `fromPriceUzs`, `teacher` summary. |
| GET | `/discovery/specialties` | Public list of active specialties (mirrors `/teacher/specialties` but cache-friendly). |

### Chat / DM

DM endpoints require **STUDENT or TEACHER** auth. ADMIN cannot DM. Rate limit:
**1 message / minute / pair** until the peer replies; once reciprocated the
limit relaxes to the global per-user chat limit (~30 msg/min).

| Method | Path | Notes |
|---|---|---|
| POST | `/chat/dm/:peerId/messages` | `{ body, idempotencyKey }`. Lazily creates `ChatRoom(scope="DM", scopeRef=sortedPair)`. Rejects with `429 RATE_LIMITED` when the cooldown is active. |
| GET  | `/chat/dm` | Inbox: list of DM peers ordered by latest message; unread counts. |
| GET  | `/chat/dm/:peerId/messages` | Paginated message history (cursor by `createdAt`). |
| POST | `/chat/dm/:peerId/read` | `{ upToMessageId }` marks messages as read. |

WebSocket namespace `/ws/chat`: events `dm:message`, `dm:read`, `dm:typing`.

### Notifications

| Method | Path | Notes |
|---|---|---|
| GET  | `/notifications` | user's inbox |
| POST | `/notifications/read` | `{ ids: [] }` |
| GET  | `/notifications/preferences` | |
| PUT  | `/notifications/preferences` | bulk |
| POST | `/notifications/devices` | register push token |

### Admin

| Method | Path | Notes |
|---|---|---|
| GET   | `/admin/specialties` | list/manage |
| POST  | `/admin/specialties` | create |
| PATCH | `/admin/specialties/:id` | |
| GET   | `/admin/specialties/:id/modules` | returns full mapping `{ moduleType, isActive }[]` (all `HomeworkModuleType` values, with `isActive=false` for those not enabled) |
| PUT   | `/admin/specialties/:id/modules` | body: `{ modules: [{ moduleType, isActive }] }` — bulk upsert into `SpecialtyModule`; emits `specialty.modules.updated` |
| GET   | `/admin/users` | search |
| POST  | `/admin/users/:id/suspend` | |
| GET   | `/admin/audit-logs` | |
| GET   | `/admin/finance/summary` | revenue + outstanding |


---

## Components and Interfaces

NestJS modullari sifatida tashkil etilgan komponentlar. Har bir modul **public port** (interface) va **private implementation** ga ega. Boshqa modullar
faqat portga bog'lanadi (Dependency Inversion).

### Auth module

```ts
// apps/api/src/modules/auth/auth.types.ts
export interface AuthService {
  register(dto: RegisterDto): Promise<{ userId: string; verificationToken: string }>;
  verifyEmail(token: string): Promise<{ userId: string }>;
  login(dto: LoginDto, meta: ClientMeta): Promise<TokenPair & { user: PublicUser }>;
  refresh(refreshToken: string, meta: ClientMeta): Promise<TokenPair>;
  logout(sessionId: string): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  confirmPasswordReset(token: string, newPassword: string): Promise<void>;
}

export interface UserDirectory {
  // read-only port for other modules
  findById(userId: string): Promise<PublicUser | null>;
  findByEmail(email: string): Promise<PublicUser | null>;
  assertActive(userId: string): Promise<void>; // throws if not ACTIVE
}

export interface TokenPair {
  accessToken: string;   // JWT, 15m
  refreshToken: string;  // opaque, hashed in DB, 30d, rotated
}

export interface PublicUser {
  id: string;
  email: string;
  fullName: string;
  role: 'STUDENT' | 'TEACHER' | 'ADMIN';
  status: 'PENDING_VERIFY' | 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  locale: string;
  avatarUrl?: string;
}
```

### Billing module

```ts
export interface BillingService {
  startTrial(teacherId: string): Promise<Subscription>;
  createSubscriptionCheckout(teacherId: string, planId: string): Promise<{ payUrl: string; invoiceId: string }>;
  createStudentCourseCheckout(input: {
    studentId: string;
    groupId: string;
    inviteToken?: string;
    idempotencyKey: string;
  }): Promise<{ payUrl: string; invoiceId: string }>;
  cancelSubscription(teacherId: string): Promise<Subscription>;
  handlePaymeWebhook(req: PaymeJsonRpcRequest, authHeader: string): Promise<PaymeJsonRpcResponse>;
  getInvoicesForUser(userId: string, page: PageOpts): Promise<Page<Invoice>>;
}

export interface SubscriptionGuard {
  // used by other modules
  ensureTeacherCanCreateLesson(teacherId: string): Promise<void>;
  ensureStudentEnrollmentPaid(studentId: string, groupId: string): Promise<void>;
  isTrialActive(teacherId: string): Promise<boolean>;
}

export interface PaymeJsonRpcRequest {
  method:
    | 'CheckPerformTransaction'
    | 'CreateTransaction'
    | 'PerformTransaction'
    | 'CancelTransaction'
    | 'CheckTransaction'
    | 'GetStatement';
  params: Record<string, unknown>;
  id: number;
}
```

### Catalog module

```ts
export interface CatalogService {
  createCourse(teacherId: string, dto: CreateCourseDto): Promise<Course>;
  createGroup(teacherId: string, courseId: string, dto: CreateGroupDto): Promise<Group>;
  setSchedule(teacherId: string, groupId: string, dto: SetScheduleDto): Promise<Schedule>;
  addScheduleException(teacherId: string, groupId: string, dto: ScheduleExceptionDto): Promise<ScheduleException>;
  createLesson(teacherId: string, groupId: string, dto: CreateLessonDto): Promise<Lesson>;
  publishLesson(teacherId: string, lessonId: string): Promise<Lesson>;
  attachMedia(teacherId: string, lessonId: string, assetId: string, role: string): Promise<Attachment>;
  listLessonsForStudent(studentId: string, groupId: string, page: PageOpts): Promise<Page<LessonSummary>>;
}

export interface LessonAccessGuard {
  // central enforcement of enrollment invariant
  assertCanRead(userId: string, lessonId: string): Promise<void>;
}
```

### Enrollment module

```ts
export interface EnrollmentService {
  createInviteLink(teacherId: string, groupId: string, opts: InviteOpts): Promise<InviteLink>;
  resolveInvite(token: string): Promise<GroupSummary>;
  createRequestAfterPayment(input: {
    studentId: string;
    invoiceId: string;
    groupId: string;
    inviteToken?: string;
  }): Promise<EnrollmentRequest>;
  approve(teacherId: string, requestId: string): Promise<Enrollment>;
  reject(teacherId: string, requestId: string, reason?: string): Promise<EnrollmentRequest>;
  listMyEnrollments(studentId: string): Promise<Enrollment[]>;
  isStudentEnrolled(studentId: string, groupId: string): Promise<boolean>;
}
```

### Live module

```ts
export interface LiveService {
  start(teacherId: string, lessonId: string): Promise<LiveSession>;
  end(teacherId: string, sessionId: string): Promise<LiveSession>;
  getRouterCapabilities(sessionId: string, userId: string): Promise<RtpCapabilities>;
  createTransport(sessionId: string, userId: string, dir: 'send' | 'recv'): Promise<TransportInfo>;
  connectTransport(sessionId: string, transportId: string, dtlsParameters: DtlsParameters): Promise<void>;
  produce(sessionId: string, transportId: string, kind: 'audio' | 'video', rtpParameters: RtpParameters): Promise<{ producerId: string }>;
  consume(sessionId: string, transportId: string, producerId: string, rtpCapabilities: RtpCapabilities): Promise<ConsumerInfo>;
}

export interface RecorderOrchestrator {
  spawnRecorder(sessionId: string, roomId: string): Promise<{ recorderRef: string }>;
  finalize(recorderRef: string): Promise<{ assetId: string; durationMs: number } | { failure: string }>;
}
```

### Homework module

```ts
export interface HomeworkService {
  createAssignment(teacherId: string, lessonId: string, dto: CreateAssignmentDto): Promise<Assignment>;
  publishAssignment(teacherId: string, assignmentId: string): Promise<Assignment>;
  upsertDraft(studentId: string, dto: UpsertDraftDto): Promise<Submission>;
  submit(studentId: string, submissionId: string): Promise<Submission>;
  gradeFinal(teacherId: string, submissionId: string, dto: GradeDto): Promise<Submission>;
  returnForRework(teacherId: string, submissionId: string, comment: string): Promise<Submission>;
  getSubmission(userId: string, submissionId: string): Promise<SubmissionDetail>;
}

export interface AiGradingPort {
  precheck(submissionId: string): Promise<void>; // async, writes Feedback row
}
```

### AI Gateway module

```ts
export interface AiGateway {
  tutor(input: TutorInput): Promise<TutorOutput>;
  translateWord(input: TranslateWordInput): Promise<TranslateWordOutput>;
  translateSentence(input: TranslateSentenceInput): Promise<TranslateSentenceOutput>;
  classifySpecialty(input: { answersJson: unknown }): Promise<{ specialtySlug: string; confidence: number }>;
  detectAiText(input: { text: string }): Promise<{ likelihood: number; signals: string[] }>;
  precheckWritingSubmission(input: PrecheckInput): Promise<PrecheckOutput>;
}

export interface TutorInput {
  userId: string;
  intent: 'EXPLAIN' | 'TRANSLATE' | 'EXAMPLE';
  contextText?: string;     // student's current text (read-only context)
  question: string;
  locale: 'uz' | 'ru' | 'en';
}

export interface TutorOutput {
  reply: string;
  // policy assertion: must NOT contain a complete answer for the active task
  policyChecks: { noFullAnswer: boolean; reason?: string };
}
```

### Notifications module

```ts
export interface NotificationsService {
  // single-user
  notify(input: NotifyInput): Promise<Notification>;
  // fan-out to all enrolled students of a group, idempotent by key
  fanOutToGroup(input: GroupFanOutInput): Promise<{ enqueued: number; deduped: number }>;
  markRead(userId: string, ids: string[]): Promise<void>;
  setPreferences(userId: string, prefs: PrefUpdate[]): Promise<void>;
  registerPushToken(userId: string, token: string, platform: 'ios' | 'android' | 'web'): Promise<void>;
}

export interface GroupFanOutInput {
  groupId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /// stable key used to derive per-user idempotencyKey = `${baseKey}:${userId}`
  baseIdempotencyKey: string;
}
```

### Outbox dispatcher

```ts
export interface OutboxDispatcher {
  enqueue(tx: PrismaTx, topic: string, payload: unknown, idempotencyKey: string): Promise<void>;
  // worker
  pollAndDispatch(): Promise<{ processed: number; failed: number }>;
}
```


---

## Key Algorithms (Low-Level)

Quyida muhim biznes algoritmlari **TypeScript pseudokodi** sifatida formal spetsifikatsiya
(preconditions / postconditions / loop invariants) bilan beriladi. Implementatsiya kodi
Phase ishlab chiqarish bosqichida `apps/api/src/modules/*` ichida real NestJS sintaksisida
yoziladi.

### Payment + Enrollment atomicity (Outbox pattern)

**Funksiya:** `handlePaymeWebhook(req, authHeader)`

**Preconditions:**
- `authHeader` Payme Basic Auth credentialiga mos keladi (`Basic base64(MERCHANT_LOGIN:MERCHANT_KEY)`).
- `req` JSON-RPC 2.0 ga mos.
- `req.params.account.invoiceId` mavjud va `Invoice` jadvalida bor.

**Postconditions:**
- `req.method === 'PerformTransaction'` muvaffaqiyatli bo'lsa:
  - `PaymeTransaction.state = PAID`
  - Tegishli `Invoice.status = PAID`
  - Agar invoice `kind = STUDENT_COURSE` bo'lsa, **bitta** `EnrollmentRequest` yaratiladi (idempotent).
  - **Bitta** `OutboxEvent` (`payment.succeeded`) yaratiladi.
  - Yuqoridagi 3 mutation **bitta DB tranzaktsiyada** sodir bo'ladi.
- Webhook **idempotent**: bir xil `paymeId` bilan ikki marta chaqirilsa, ikkinchi safar oldingi
  natija qaytariladi (state machine'ning fenomenal qoidalariga muvofiq).

**Loop invariants:** N/A (loop yo'q).

```pascal
ALGORITHM handlePaymeWebhook(req, authHeader)
  ASSERT verifyBasicAuth(authHeader) = true OR THROW -32504 (auth)
  ASSERT isValidJsonRpc(req) OR THROW -32600

  SWITCH req.method
    CASE "CheckPerformTransaction":
      RETURN { allow: invoiceExistsAndUnpaid(req.params.account) }

    CASE "CreateTransaction":
      // idempotency: same paymeId returns same result
      tx ← findPaymeTxByPaymeId(req.params.id)
      IF tx ≠ NULL THEN
        ASSERT tx.account = req.params.account OR THROW -31050
        ASSERT tx.state IN { CREATED, PAID } OR THROW -31008
        RETURN serialize(tx)

      BEGIN TX
        invoice ← LOCK invoice BY id = req.params.account.invoiceId
        ASSERT invoice.status = "PENDING" OR THROW -31050
        ASSERT invoice.amountUzs * 100 = req.params.amount OR THROW -31001

        tx ← INSERT PaymeTransaction(
              paymeId = req.params.id,
              account = req.params.account,
              amountUzs = invoice.amountUzs,
              state = CREATED,
              createTime = req.params.time,
              idempotencyKey = "payme:" + req.params.id)
        UPDATE invoice SET paymeTxId = tx.id
      COMMIT
      RETURN { create_time: tx.createTime, transaction: tx.id, state: 1 }

    CASE "PerformTransaction":
      tx ← findPaymeTxByPaymeId(req.params.id)
      IF tx = NULL THEN THROW -31003
      IF tx.state = PAID THEN
        RETURN { perform_time: tx.performTime, transaction: tx.id, state: 2 }
      IF tx.state ≠ CREATED THEN THROW -31008

      BEGIN TX
        UPDATE PaymeTransaction
          SET state = PAID, performTime = now_ms()
          WHERE id = tx.id AND state = CREATED  -- optimistic
        IF rowsAffected = 0 THEN THROW -31008

        invoice ← LOCK invoice BY paymeTxId = tx.id
        UPDATE invoice SET status = "PAID", paidAt = now()

        IF invoice.kind = "STUDENT_COURSE" THEN
          INSERT EnrollmentRequest(
            groupId = invoice.groupId,
            studentId = invoice.studentId,
            invoiceId = invoice.id,
            status = PENDING_APPROVAL)
          ON CONFLICT (groupId, studentId) DO UPDATE
            SET status = PENDING_APPROVAL, invoiceId = EXCLUDED.invoiceId

        IF invoice.kind = "TEACHER_SUBSCRIPTION" THEN
          UPDATE Subscription FOR teacher
            SET status = ACTIVE,
                currentPeriodStart = now(),
                currentPeriodEnd = now() + plan.intervalDays
            WHERE teacherId = invoice.teacherId

        INSERT OutboxEvent(
          topic = "payment.succeeded",
          payload = { invoiceId, kind, ... },
          idempotencyKey = "payment.succeeded:" + invoice.id)
      COMMIT

      RETURN { perform_time, transaction: tx.id, state: 2 }

    CASE "CancelTransaction":
      // similar idempotent state transitions
      ...

    CASE "CheckTransaction":
      RETURN serialize(tx)

    CASE "GetStatement":
      RETURN listTransactions(req.params.from, req.params.to)
  END SWITCH
END
```

### Enrollment-gated lesson access

**Funksiya:** `assertCanRead(userId, lessonId)`

**Preconditions:**
- `userId` ACTIVE foydalanuvchi.
- `lessonId` mavjud.

**Postconditions:**
- Quyidagilardan biri to'g'ri bo'lsa, **muvaffaqiyatli qaytaradi** (void):
  1. user `lessonId.group.course.teacherId` ga teng (egasi).
  2. user TEACHER lekin guruh boshqasiniki — **rad etadi** (`FORBIDDEN`).
  3. user STUDENT, `Enrollment(groupId=lessonId.groupId, studentId=user.id, status=APPROVED)` mavjud — **OK**.
  4. user ADMIN — **OK** (read-only audit).
- Aks holda `ForbiddenException("LESSON_ACCESS_DENIED")` ko'taradi.
- **Hech qachon** payment yoki approval holatini chetlab o'tmaydi.

```pascal
ALGORITHM assertCanRead(userId, lessonId)
  user ← getUserById(userId)
  ASSERT user.status = ACTIVE OR THROW Forbidden

  lesson ← getLessonWithGroup(lessonId)
  ASSERT lesson ≠ NULL OR THROW NotFound

  IF user.role = ADMIN THEN RETURN

  IF user.role = TEACHER THEN
    IF lesson.group.course.teacherId = userId THEN RETURN
    THROW Forbidden("NOT_OWNING_TEACHER")

  IF user.role = STUDENT THEN
    enrollment ← findEnrollment(userId, lesson.groupId)
    IF enrollment = NULL THEN THROW Forbidden("NOT_ENROLLED")
    IF enrollment.status ≠ APPROVED THEN THROW Forbidden("NOT_APPROVED")
    RETURN

  THROW Forbidden("UNKNOWN_ROLE")
END
```

### Schedule change → idempotent fan-out notification

**Funksiya:** `fanOutScheduleChanged(groupId, version)`

**Preconditions:**
- `groupId` mavjud, `Schedule.version` `version` ga teng (snapshot).

**Postconditions:**
- Har bir `Enrollment(groupId, status=APPROVED)` uchun **aynan bitta** `Notification` yaratiladi
  (idempotency: `idempotencyKey = "schedule.changed:" + groupId + ":v" + version + ":" + studentId`).
- Bir xil event ikki marta ishlatilsa (worker retry), takroriy yozuv yaratilmaydi.

**Loop invariant:** har bir iteratsiya yakunida `processedSet` ⊆ approvedStudents bo'lib qoladi
va `processedSet` da har bir studentId uchun aynan bitta Notification yaratilgan.

```pascal
ALGORITHM fanOutScheduleChanged(groupId, version)
  enrollments ← SELECT studentId FROM Enrollment
                WHERE groupId = groupId AND status = APPROVED

  baseKey ← "schedule.changed:" + groupId + ":v" + version
  enqueued ← 0
  deduped ← 0

  FOR each studentId IN enrollments DO
    INVARIANT: ∀ s ∈ processedSet : exists 1 Notification with
               idempotencyKey = baseKey + ":" + s

    key ← baseKey + ":" + studentId
    result ← INSERT Notification(
        userId = studentId,
        kind = SCHEDULE_CHANGED,
        title = title(locale(studentId)),
        body = body(locale(studentId)),
        data = { groupId, version },
        idempotencyKey = key)
      ON CONFLICT (idempotencyKey) DO NOTHING
      RETURNING id

    IF result.inserted THEN
      enqueued ← enqueued + 1
      ENQUEUE delivery jobs for { IN_APP, EMAIL, TELEGRAM, PUSH }
              filtered by NotificationPreference
    ELSE
      deduped ← deduped + 1
    END IF
    processedSet ← processedSet ∪ { studentId }
  END FOR

  RETURN { enqueued, deduped }
END
```

### Trial → Active obuna state machine

**Funksiya:** `transitionSubscription(teacherId, event)` — kuniga bir marta cron + payment webhook'lar
chaqiradi.

**Holatlar:** `TRIAL → ACTIVE | EXPIRED`, `ACTIVE → PAST_DUE | CANCELED`,
`PAST_DUE → ACTIVE | EXPIRED`, `CANCELED` terminal.

**Invariant:** har bir teacher uchun *ko'pi bilan bitta* non-terminal holat (DB partial unique index).

```pascal
ALGORITHM transitionSubscription(teacherId, event)
  sub ← LOCK Subscription WHERE teacherId = teacherId
        AND status IN (TRIAL, ACTIVE, PAST_DUE)
  IF sub = NULL THEN
    IF event.type = TEACHER_REGISTERED_AND_VERIFIED THEN
      INSERT Subscription(teacherId, status=TRIAL, trialEndsAt=now+14d)
      RETURN
    ELSE THROW IllegalState

  SWITCH (sub.status, event.type)
    CASE (TRIAL, PAYMENT_SUCCEEDED):
      // single-billing: trial bills nothing; active starts on success
      sub.status ← ACTIVE
      sub.currentPeriodStart ← now()
      sub.currentPeriodEnd ← now() + plan.intervalDays
      sub.trialEndsAt ← null
      EMIT subscription.activated

    CASE (TRIAL, TRIAL_EXPIRED) where now() ≥ sub.trialEndsAt:
      sub.status ← EXPIRED
      EMIT subscription.expired
      // teacher loses ability to publish lessons — read-only

    CASE (ACTIVE, PERIOD_END_REACHED):
      sub.status ← PAST_DUE
      EMIT subscription.past_due

    CASE (PAST_DUE, PAYMENT_SUCCEEDED):
      sub.status ← ACTIVE
      sub.currentPeriodStart ← now()
      sub.currentPeriodEnd ← now() + plan.intervalDays

    CASE (PAST_DUE, GRACE_EXPIRED) where now() ≥ sub.currentPeriodEnd + 7d:
      sub.status ← EXPIRED

    CASE (*, CANCEL_REQUESTED):
      sub.cancelAt ← sub.currentPeriodEnd

    DEFAULT:
      // ignored — same event, idempotent
  END SWITCH
END
```

**Double-billing'ning oldini olish:** TRIAL holatida hech qanday `Invoice` `PENDING` qilib yaratilmaydi
— faqat foydalanuvchi `subscription/checkout` ni o'zi bossa yaratiladi va u muvaffaqiyatli
to'lansagina TRIAL → ACTIVE o'tadi. Cron faqat `TRIAL_EXPIRED` ni qayd etadi.

### AI Gateway — Tutor mode policy enforcement

**Funksiya:** `tutor(input)` — student "uy vazifasini bajaruvchi" emas, "tushuntiruvchi" oladi.

**Preconditions:**
- `input.userId` STUDENT.
- `input.intent ∈ { EXPLAIN, TRANSLATE, EXAMPLE }`.
- `input.question` non-empty.

**Postconditions:**
- Javob hech qachon student'ning aktiv submissioniga aynan to'g'ri keladigan yakuniy javobni
  o'z ichiga olmaydi.
- AI chaqiruvi `AiCall` jadvaliga audit yoziladi (cost, latency, tokens).
- Quvvat chegarasidan oshsa, `RateLimitException`.

**Algoritm:**

```pascal
ALGORITHM tutor(input)
  // 1) rate limit (token bucket per userId, 60 calls / 10 min)
  ASSERT rateLimit(input.userId) OR THROW TOO_MANY_REQUESTS

  // 2) load template
  template ← getActiveTemplate("tutor." + input.intent + ".v1")

  // 3) build system prompt enforcing the no-completion policy
  system ← template.systemText + `
    HARD RULES:
    - NEVER write a complete sentence/paragraph that the student could submit verbatim.
    - NEVER produce final answers to fill-in tasks.
    - You may give: rules, examples about a different topic, partial hints.
    - If asked to "do" the task, refuse politely and offer to explain instead.`

  user ← renderTemplate(template.userTemplate, input)

  // 4) call Claude
  start ← now()
  response ← anthropic.messages.create({
    model: template.modelName,
    system, messages: [{ role: "user", content: user }],
    max_tokens: template.maxTokens
  })
  latency ← now() - start

  // 5) post-filter: ensure the reply is not too similar to active submission
  similarity ← cosineSim(response.text, input.contextText ?? "")
  policyOk ← similarity < 0.7 AND NOT looksLikeAnswerKey(response.text)

  IF NOT policyOk THEN
    response.text ← rephraseAsHint(response.text)
    flag ← "POLICY_RECTIFIED"

  // 6) audit
  INSERT AiCall(userId, intent, templateKey, modelName,
    inputTokens, outputTokens, costUsd = computeCost(...),
    latencyMs, status = "OK", refType="tutor")

  RETURN { reply: response.text, policyChecks: { noFullAnswer: policyOk } }
END
```

### AI grading precheck pipeline

**Funksiya:** `precheckWritingSubmission(submissionId)` — teacherga yordam berish uchun
xatolarni qizil bilan belgilangan draft fikr-mulohaza.

```pascal
ALGORITHM precheckWritingSubmission(submissionId)
  s ← LOCK Submission WHERE id = submissionId
  ASSERT s.status = SUBMITTED

  text ← extractText(s.answersJson, moduleType=WRITING)

  // a) AI text detection (heuristic + Claude classifier)
  perplexity ← computePerplexity(text)
  classifier ← claudeClassify(text, prompt="Is this human-written? 0..1")
  aiLikelihood ← weightedAvg(perplexity, classifier)

  // b) error highlighting (grammar, spelling, coherence)
  rubric ← getRubricFor(s.assignment.modules.WRITING)
  prompt ← renderTemplate("writing.precheck.v1", {
    text, rubric, language: detectLanguage(text)
  })
  raw ← claude.messages.create(prompt)
  parsed ← parseJsonStrict(raw.text)
  // parsed: { highlights: [{from,to,severity,reason}], summary, suggestedScore }

  // c) compose Feedback
  INSERT Feedback(
    submissionId, authorType=AI_DRAFT, isFinal=false,
    payload = { highlights: parsed.highlights,
                summary: parsed.summary,
                suggestedScore: parsed.suggestedScore,
                aiLikelihood })

  UPDATE Submission
    SET status = IN_REVIEW,
        aiFlagged = (aiLikelihood >= 0.75),
        aiLikelihood = aiLikelihood

  EMIT submission.precheck_ready (notify teacher via Notifications)
END
```

### Live recording finalization

**Funksiya:** `finalizeRecording(sessionId)` — har bir tugagan jonli sessiya uchun majburiy qadam.

**Postcondition:** `LiveSession.status ∈ { ENDED, RECORDING_FAILED }`. Hech qachon `LIVE` da
qolib ketmaydi.

```pascal
ALGORITHM finalizeRecording(sessionId)
  session ← LOCK LiveSession WHERE id = sessionId
  ASSERT session.status = LIVE

  // 1) close mediasoup router (idempotent)
  TRY: sfu.closeRouter(session.roomId)

  // 2) flush recorder (ffmpeg -- copy → MP4 → HLS package)
  result ← recorderOrchestrator.finalize(session.recorderRef)

  IF result.failure ≠ NULL THEN
    UPDATE LiveSession SET status = RECORDING_FAILED, endedAt = now()
    INSERT Recording(lessonId, sessionId, status="FAILED")
    EMIT live.ended (with failure flag)
    RETURN

  // 3) attach as MediaAsset + Recording
  asset ← INSERT MediaAsset(kind=RECORDING, status=READY,
                            hlsManifestKey=result.manifestKey,
                            durationMs=result.durationMs,
                            ownerUserId=session.lesson.teacherId)
  rec ← INSERT Recording(lessonId, sessionId, assetId=asset.id,
                         durationMs=result.durationMs, status="READY")
  // also auto-attach to lesson as supplementary
  INSERT Attachment(lessonId, assetId=asset.id, kind=RECORDING,
                    role="recording", position=nextPos())

  UPDATE LiveSession SET status = ENDED, endedAt = now()
  INSERT OutboxEvent(topic="recording.ready",
                     idempotencyKey="recording.ready:" + sessionId,
                     payload={ lessonId, recordingId: rec.id })
END
```

### Reading module — per-word & per-sentence translation (cached)

```pascal
ALGORITHM translateWord(word, contextSentence, locale)
  norm ← lowercase(trim(stripPunct(word)))
  cacheKey ← "tr:word:" + locale + ":" + sha1(norm + "|" + contextSentence)

  cached ← redis.get(cacheKey)
  IF cached ≠ NULL THEN RETURN cached

  // First check static dictionary (preloaded common words)
  dict ← lookupDictionary(norm, locale)
  IF dict ≠ NULL AND dict.requiresContext = false THEN
    redis.setex(cacheKey, 30d, dict)
    RETURN dict

  // Otherwise call Claude with constrained JSON schema
  prompt ← renderTemplate("translate.word.v1", { word: norm, context: contextSentence, locale })
  raw ← claude.messages.create(prompt)
  parsed ← parseJsonStrict(raw)
  // { translation, partOfSpeech, examples: [...], note? }

  redis.setex(cacheKey, 7d, parsed)
  INSERT AiCall(intent=TUTOR_TRANSLATE, refType="word", refId=cacheKey, ...)
  RETURN parsed
END
```

### Specialty classification (onboarding)

```pascal
ALGORITHM classifySpecialty(answers)
  // 1) deterministic rule pass: sum option weights per specialty
  scores ← map<specialtySlug, number>
  FOR each ans IN answers DO
    option ← lookupOption(ans.questionId, ans.optionId)
    FOR each (slug, weight) IN option.weights DO
      scores[slug] ← scores[slug] + weight

  best ← argmax(scores)
  IF best.score / sum(scores) ≥ 0.55 THEN
    RETURN { specialtySlug: best.slug, confidence: best.score / sum(scores) }

  // 2) ambiguous → fall back to Claude with full answer text
  prompt ← renderTemplate("specialty.classify.v1", { answers, knownSpecialties })
  parsed ← claude(prompt) // schema: { specialtySlug, confidence, reasoning }
  RETURN parsed
END
```


---

## Frontend Architecture

Next.js 14 (App Router) bilan qurilgan veb ilovasi.

### Asosiy tamoyillar

- **App Router** + React Server Components (RSC) standart; client komponentlar faqat interaktivlik
  kerak bo'lganda (`"use client"`).
- **Server Actions** ishlatilmaydi (NestJS API monorepo'da o'z avtoritetini saqlaydi); barcha
  mutatsiyalar API'ga `fetch` orqali (typed client `packages/api-client`).
- **State:** server data — TanStack Query (client) + RSC streaming (server); UI state — Zustand;
  forma — react-hook-form + zod.
- **Auth:** httpOnly cookie (refresh token) + memory access token; SSR'da cookie orqali avtorizatsiya.
- **i18n:** `next-intl` (uz/ru/en); URL prefiksli locale (`/uz/...`, `/ru/...`).
- **Theming:** Tailwind + CSS variables + shadcn/ui; dark mode opsional.
- **Real-time:** `socket.io-client` faqat live & notifications sahifalarida; reconnect backoff.

### Sahifalar xaritasi (App Router)

```
app/
├── (marketing)/            # public, unauthenticated
│   ├── page.tsx                 # / landing
│   ├── pricing/page.tsx
│   ├── for-teachers/page.tsx
│   ├── i/[token]/page.tsx       # invite landing
│   ├── search/page.tsx          # public discovery: search by subject/name
│   ├── t/[slug]/page.tsx        # public teacher profile
│   └── c/[courseId]/page.tsx    # public course detail page
├── (auth)/
│   ├── login/page.tsx
│   ├── register/page.tsx
│   ├── verify-email/page.tsx
│   └── reset-password/page.tsx
├── (teacher)/                  # role=TEACHER guard
│   ├── onboarding/page.tsx           # quiz
│   ├── dashboard/page.tsx            # specialty-specific via dashboardKey
│   ├── courses/
│   │   ├── page.tsx                  # list
│   │   ├── new/page.tsx
│   │   └── [courseId]/
│   │       ├── page.tsx
│   │       ├── groups/[groupId]/
│   │       │   ├── page.tsx          # group detail
│   │       │   ├── lessons/
│   │       │   │   ├── page.tsx
│   │       │   │   ├── new/page.tsx
│   │       │   │   └── [lessonId]/
│   │       │   │       ├── page.tsx
│   │       │   │       ├── live/page.tsx
│   │       │   │       └── homework/[assignmentId]/page.tsx
│   │       │   ├── schedule/page.tsx
│   │       │   ├── members/page.tsx
│   │       │   ├── modules/page.tsx  # <GroupModulesPanel> — per-Group module toggles
│   │       │   └── requests/page.tsx
│   ├── billing/page.tsx
│   └── settings/page.tsx
├── (student)/                  # role=STUDENT guard
│   ├── dashboard/page.tsx
│   ├── groups/[groupId]/
│   │   ├── page.tsx                  # lessons list
│   │   ├── lessons/[lessonId]/
│   │   │   ├── page.tsx              # player + materials
│   │   │   └── live/page.tsx
│   │   └── homework/
│   │       └── [assignmentId]/page.tsx  # writing/reading/...
│   ├── checkout/[groupId]/page.tsx   # Payme redirect
│   └── profile/page.tsx
├── (admin)/                    # role=ADMIN
│   └── ...
├── api-types.d.ts              # generated from OpenAPI
└── layout.tsx
```

### Asosiy komponentlar (UI)

| Komponent | Vazifa |
|---|---|
| `<LessonPlayer>` | HLS.js + chapters + progress save (debounced API) |
| `<LiveStage>` | mediasoup-client; teacher producer / student consumer |
| `<ChatPanel>` | live & group chat, virtualized list |
| `<UploadDropzone>` | resumable multipart with R2 |
| `<SchedulePicker>` | RRULE builder UI (BYDAY, BYHOUR) |
| `<WritingEditor>` | TipTap editor; autosave; AI side-panel |
| `<ReadingViewer>` | passage with hover-translate + selection-translate |
| `<AssignmentBuilder>` | Modular tabs picker. **Filtered by per-Group toggle**: calls `GET /homework/available-modules?groupId=...` and shows only the modules currently ENABLED for the lesson's group (not the full specialty catalog). Modules disabled in the group are hidden, not greyed out. The picker re-fetches when the teacher flips a toggle in the parallel `<GroupModulesPanel>`. |
| `<GroupModulesPanel>` | Per-Group module configuration UI (in group settings → "Modules" tab). Lists the group's specialty catalog with each module's toggle, label, and short description. Optimistic UI; on toggle calls `POST /catalog/groups/:id/modules/:moduleType/enable` or `.../disable`. Falls back to bulk `PUT /catalog/groups/:id/modules` for "save all". Surfaces a non-destructive notice ("Past assignments using this module will keep working") when disabling a module that has historical `AssignmentModule` rows. |
| `<TeacherGradingPanel>` | shows AI draft (red highlights) + edit + approve |
| `<EnrollmentRequestList>` | teacher inbox |
| `<NotificationBell>` | socket-driven inbox dropdown |
| `<TeacherSearchBar>` | Public marketing search input with debounced query, calls `GET /discovery/teachers` and `GET /discovery/courses`; SSR-rendered initial results |
| `<TeacherCard>` | Search-result card: avatar, fullName, headline, specialty pill, rating, student count, "View profile" CTA |
| `<TeacherPublicProfile>` | Public teacher page (`/t/{slug}`): cover, bio, courses grid, "Message teacher" CTA (gates on auth) |
| `<DmThread>` | Two-pane DM view: messages list + composer; reactive via `/ws/chat` socket; surfaces rate-limit cooldown |
| `<DmInbox>` | Inbox of DM peers, unread badges, last-message preview |

### Auth & RBAC route guards

- `middleware.ts` decodes JWT from cookie, sets `x-user-role` header for RSC.
- Each segment uses a `layout.tsx` that calls `requireRole('TEACHER' | 'STUDENT' | 'ADMIN')`
  via server-side helper; on mismatch returns `notFound()` or redirects.

### Performance budget

- Marketing TTI < 1.5s 4G; LCP < 2.0s.
- App pages: route-level code splitting; mediasoup-client lazy-loaded only on `/live`.
- Images via `next/image` + R2 CDN; AVIF/WebP.

---

## Folder Structure

Backend va frontend uchun papka tuzilmasi. Monorepo: **pnpm workspaces** + **Turborepo**.

```
edubridge/
├── apps/
│   ├── api/                          # NestJS backend
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── common/
│   │   │   │   ├── guards/
│   │   │   │   │   ├── jwt-auth.guard.ts
│   │   │   │   │   ├── roles.guard.ts
│   │   │   │   │   └── lesson-access.guard.ts
│   │   │   │   ├── interceptors/
│   │   │   │   │   ├── idempotency.interceptor.ts
│   │   │   │   │   ├── logging.interceptor.ts
│   │   │   │   │   └── trace.interceptor.ts
│   │   │   │   ├── filters/all-exceptions.filter.ts
│   │   │   │   ├── pipes/zod-validation.pipe.ts
│   │   │   │   ├── dtos/page.dto.ts
│   │   │   │   └── decorators/
│   │   │   │       ├── current-user.decorator.ts
│   │   │   │       └── roles.decorator.ts
│   │   │   ├── config/
│   │   │   │   ├── env.schema.ts          # zod
│   │   │   │   └── config.module.ts
│   │   │   ├── infra/
│   │   │   │   ├── prisma/
│   │   │   │   │   ├── prisma.service.ts
│   │   │   │   │   └── prisma.module.ts
│   │   │   │   ├── redis/
│   │   │   │   │   ├── redis.service.ts
│   │   │   │   │   └── redis.module.ts
│   │   │   │   ├── bullmq/
│   │   │   │   │   ├── queues.ts
│   │   │   │   │   └── bullmq.module.ts
│   │   │   │   ├── r2/
│   │   │   │   │   ├── r2.service.ts
│   │   │   │   │   └── r2.module.ts
│   │   │   │   └── outbox/
│   │   │   │       ├── outbox.service.ts
│   │   │   │       ├── outbox.dispatcher.ts
│   │   │   │       └── outbox.module.ts
│   │   │   ├── modules/
│   │   │   │   ├── auth/
│   │   │   │   │   ├── auth.module.ts
│   │   │   │   │   ├── auth.controller.ts
│   │   │   │   │   ├── auth.service.ts
│   │   │   │   │   ├── tokens.service.ts
│   │   │   │   │   ├── strategies/jwt.strategy.ts
│   │   │   │   │   ├── dto/*.ts
│   │   │   │   │   └── repositories/users.repository.ts
│   │   │   │   ├── teacher/
│   │   │   │   │   ├── teacher.module.ts
│   │   │   │   │   ├── teacher.controller.ts
│   │   │   │   │   ├── onboarding.service.ts
│   │   │   │   │   ├── specialty.service.ts
│   │   │   │   │   └── dto/*.ts
│   │   │   │   ├── billing/
│   │   │   │   │   ├── billing.module.ts
│   │   │   │   │   ├── billing.controller.ts
│   │   │   │   │   ├── billing.service.ts
│   │   │   │   │   ├── subscription-state-machine.ts
│   │   │   │   │   ├── payme/
│   │   │   │   │   │   ├── payme.controller.ts
│   │   │   │   │   │   ├── payme.service.ts
│   │   │   │   │   │   ├── payme-auth.guard.ts
│   │   │   │   │   │   └── jsonrpc.types.ts
│   │   │   │   │   └── dto/*.ts
│   │   │   │   ├── catalog/
│   │   │   │   │   ├── catalog.module.ts
│   │   │   │   │   ├── courses.controller.ts
│   │   │   │   │   ├── groups.controller.ts
│   │   │   │   │   ├── lessons.controller.ts
│   │   │   │   │   ├── schedule.controller.ts
│   │   │   │   │   ├── catalog.service.ts
│   │   │   │   │   ├── lesson-access.service.ts
│   │   │   │   │   └── dto/*.ts
│   │   │   │   ├── enrollment/
│   │   │   │   ├── media/
│   │   │   │   ├── live/
│   │   │   │   │   ├── live.module.ts
│   │   │   │   │   ├── live.controller.ts
│   │   │   │   │   ├── live.gateway.ts        # socket.io
│   │   │   │   │   ├── sfu.client.ts          # talks to apps/sfu
│   │   │   │   │   └── recorder.orchestrator.ts
│   │   │   │   ├── homework/
│   │   │   │   ├── ai/
│   │   │   │   │   ├── ai.module.ts
│   │   │   │   │   ├── ai.controller.ts
│   │   │   │   │   ├── ai.gateway.service.ts
│   │   │   │   │   ├── policy.ts             # no-completion enforcement
│   │   │   │   │   ├── prompts/*.ts
│   │   │   │   │   └── claude.client.ts
│   │   │   │   ├── notifications/
│   │   │   │   ├── chat/
│   │   │   │   └── admin/
│   │   │   ├── workers/
│   │   │   │   ├── transcoding.processor.ts
│   │   │   │   ├── email.processor.ts
│   │   │   │   ├── telegram.processor.ts
│   │   │   │   ├── ai-grading.processor.ts
│   │   │   │   ├── notification-fanout.processor.ts
│   │   │   │   └── outbox-dispatcher.processor.ts
│   │   │   └── health/health.controller.ts
│   │   ├── test/                          # e2e jest
│   │   ├── Dockerfile
│   │   ├── nest-cli.json
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── web/                          # Next.js 14 frontend
│   │   ├── app/                      # (see §12.2)
│   │   ├── components/
│   │   │   ├── ui/                  # shadcn primitives
│   │   │   ├── lesson/
│   │   │   ├── live/
│   │   │   ├── homework/
│   │   │   └── common/
│   │   ├── lib/
│   │   │   ├── api-client.ts        # uses packages/api-client
│   │   │   ├── auth.ts              # cookie helpers
│   │   │   ├── socket.ts
│   │   │   ├── i18n.ts
│   │   │   └── env.ts
│   │   ├── hooks/
│   │   ├── styles/globals.css
│   │   ├── middleware.ts
│   │   ├── next.config.mjs
│   │   ├── tailwind.config.ts
│   │   ├── postcss.config.js
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── sfu/                          # mediasoup SFU (Phase 4)
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── worker.ts
│   │   │   ├── router.ts
│   │   │   ├── transport.ts
│   │   │   ├── recorder.ts          # ffmpeg pipe
│   │   │   └── api.ts               # internal HTTP for live module
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   └── mobile/                       # Expo (Phase 8)
│
├── packages/
│   ├── db/                           # Prisma schema + migrations
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── migrations/
│   │   │   └── seed.ts
│   │   ├── src/index.ts              # re-export PrismaClient
│   │   └── package.json
│   ├── api-client/                   # generated from OpenAPI
│   │   ├── src/index.ts
│   │   └── package.json
│   ├── ui/                           # shared shadcn-based components
│   ├── config/
│   │   ├── eslint/
│   │   ├── tsconfig/
│   │   └── tailwind/
│   ├── shared-types/                 # zod schemas + DTO types shared FE↔BE
│   └── i18n/
│       └── locales/{uz,ru,en}/*.json
│
├── infra/
│   ├── docker/
│   │   ├── docker-compose.yml        # local dev: pg, redis, minio (R2 emu)
│   │   └── docker-compose.prod.yml
│   ├── k8s/
│   │   ├── api.yaml
│   │   ├── web.yaml
│   │   ├── sfu.yaml
│   │   ├── workers.yaml
│   │   └── ingress.yaml
│   ├── github-actions/
│   │   ├── ci.yml
│   │   └── deploy.yml
│   └── grafana/
│       └── dashboards/
│
├── package.json                      # workspace root
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── .env.example
├── .editorconfig
├── .gitignore
├── README.md
└── LICENSE
```

### `package.json` (root)

```json
{
  "name": "edubridge",
  "private": true,
  "version": "0.1.0",
  "packageManager": "pnpm@9.6.0",
  "scripts": {
    "dev": "turbo run dev --parallel",
    "build": "turbo run build",
    "lint": "turbo run lint",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck",
    "db:migrate": "pnpm --filter @edubridge/db prisma:migrate",
    "db:seed": "pnpm --filter @edubridge/db prisma:seed",
    "openapi:gen": "pnpm --filter @edubridge/api openapi:gen && pnpm --filter @edubridge/api-client gen"
  },
  "devDependencies": {
    "turbo": "^2.0.6",
    "typescript": "^5.5.0",
    "prettier": "^3.3.3"
  }
}
```

### `apps/api/package.json` (selected)

```json
{
  "name": "@edubridge/api",
  "version": "0.1.0",
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "start": "node dist/main.js",
    "test": "jest",
    "test:e2e": "jest --config test/jest-e2e.json",
    "lint": "eslint \"src/**/*.ts\"",
    "openapi:gen": "ts-node scripts/generate-openapi.ts"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.0",
    "@nestjs/core": "^10.4.0",
    "@nestjs/platform-express": "^10.4.0",
    "@nestjs/jwt": "^10.2.0",
    "@nestjs/passport": "^10.0.3",
    "@nestjs/swagger": "^7.4.0",
    "@nestjs/bullmq": "^10.2.0",
    "@nestjs/event-emitter": "^2.0.4",
    "@nestjs/websockets": "^10.4.0",
    "@nestjs/platform-socket.io": "^10.4.0",
    "@anthropic-ai/sdk": "^0.27.0",
    "@aws-sdk/client-s3": "^3.620.0",
    "@aws-sdk/s3-request-presigner": "^3.620.0",
    "@prisma/client": "^5.18.0",
    "argon2": "^0.40.3",
    "bullmq": "^5.12.0",
    "ioredis": "^5.4.1",
    "passport-jwt": "^4.0.1",
    "rrule": "^2.8.1",
    "socket.io": "^4.7.5",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.4.0",
    "@nestjs/testing": "^10.4.0",
    "@types/jest": "^29.5.12",
    "@types/node": "^22.0.0",
    "jest": "^29.7.0",
    "prisma": "^5.18.0",
    "ts-jest": "^29.2.4",
    "ts-node": "^10.9.2",
    "typescript": "^5.5.0"
  }
}
```

### `apps/web/package.json` (selected)

```json
{
  "name": "@edubridge/web",
  "version": "0.1.0",
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start -p 3000",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "14.2.5",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "@tanstack/react-query": "^5.51.0",
    "@radix-ui/react-dialog": "^1.1.1",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.1",
    "hls.js": "^1.5.13",
    "mediasoup-client": "^3.7.16",
    "next-intl": "^3.17.4",
    "react-hook-form": "^7.52.1",
    "socket.io-client": "^4.7.5",
    "tailwind-merge": "^2.4.0",
    "zod": "^3.23.8",
    "zustand": "^4.5.4"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^18.3.3",
    "autoprefixer": "^10.4.19",
    "eslint": "^9.8.0",
    "eslint-config-next": "14.2.5",
    "postcss": "^8.4.40",
    "tailwindcss": "^3.4.7",
    "typescript": "^5.5.0"
  }
}
```

### `tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "incremental": true,
    "baseUrl": ".",
    "paths": {
      "@edubridge/db": ["packages/db/src/index.ts"],
      "@edubridge/shared-types": ["packages/shared-types/src/index.ts"],
      "@edubridge/api-client": ["packages/api-client/src/index.ts"],
      "@edubridge/ui": ["packages/ui/src/index.ts"]
    }
  }
}
```

### `infra/docker/docker-compose.yml` (local dev)

```yaml
version: "3.9"
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: edubridge
      POSTGRES_PASSWORD: edubridge
      POSTGRES_DB: edubridge
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: edubridge
      MINIO_ROOT_PASSWORD: edubridge12345
    ports: ["9000:9000", "9001:9001"]
    volumes: [miniodata:/data]

  mailhog:
    image: mailhog/mailhog
    ports: ["1025:1025", "8025:8025"]

volumes:
  pgdata:
  miniodata:
```

### `.env.example` (root → split per app on copy)

```dotenv
# === Common ===
NODE_ENV=development
APP_NAME=EduBridge
APP_URL=http://localhost:3000
API_URL=http://localhost:4000

# === Auth ===
JWT_ACCESS_SECRET=replace-me-32+chars
JWT_REFRESH_SECRET=replace-me-32+chars
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=30d
ARGON2_MEMORY=19456

# === Database ===
DATABASE_URL=postgresql://edubridge:edubridge@localhost:5432/edubridge?schema=public
DATABASE_REPLICA_URL=

# === Redis ===
REDIS_URL=redis://localhost:6379

# === Storage (R2 / S3-compatible) ===
S3_ENDPOINT=http://localhost:9000
S3_REGION=auto
S3_ACCESS_KEY=edubridge
S3_SECRET_KEY=edubridge12345
S3_BUCKET=edubridge-media
S3_PUBLIC_BASE_URL=http://localhost:9000/edubridge-media

# === Email ===
SMTP_URL=smtp://localhost:1025
EMAIL_FROM="EduBridge <noreply@edubridge.uz>"

# === AI ===
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-3-5-sonnet-latest
AI_DAILY_USD_BUDGET=100

# === Payme ===
PAYME_MERCHANT_ID=
PAYME_MERCHANT_KEY=
PAYME_BASE_URL=https://checkout.paycom.uz
PAYME_WEBHOOK_PATH=/api/v1/billing/payme/webhook

# === Telegram ===
TELEGRAM_BOT_TOKEN=

# === Live / SFU ===
SFU_INTERNAL_URL=http://sfu:3500
SFU_ANNOUNCED_IP=127.0.0.1
SFU_RTC_PORT_MIN=40000
SFU_RTC_PORT_MAX=40100

# === Observability ===
SENTRY_DSN=
LOKI_URL=
OTEL_EXPORTER_OTLP_ENDPOINT=
```


---

## Correctness Properties

Quyidagi xususiyatlar **property-based testing** (fast-check) va integratsiya testlari orqali
tekshiriladi. Tasks fazasida har bir property uchun alohida test fayli yoziladi.

### Property 1: Enrollment access invariant

*For any* user and lesson pair, `canRead(user, lesson)` returns true if and only if: user is ADMIN, or user is TEACHER and owns the lesson's course, or user is STUDENT with an APPROVED enrollment in the lesson's group.

```ts
// ∀ user, lesson:
//   canRead(user, lesson) ⟺
//     user.role = ADMIN
//   ∨ (user.role = TEACHER ∧ lesson.group.course.teacherId = user.id)
//   ∨ (user.role = STUDENT
//       ∧ ∃ enrollment(groupId = lesson.groupId, studentId = user.id, status = APPROVED))
```

**Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**

**Test idea (fast-check):** generate random `(user, lesson, enrollment)` triples, including all status
permutations; assert `assertCanRead` throws iff predicate is false.

### Property 2: Trial / billing exclusivity

*For any* teacher, at most one non-terminal subscription (TRIAL, ACTIVE, PAST_DUE) exists at any time, and while in TRIAL state no pending TEACHER_SUBSCRIPTION invoice exists.

```ts
// ∀ teacher: |{ s ∈ Subscription | s.teacherId = teacher.id ∧ s.status ∈ {TRIAL, ACTIVE, PAST_DUE} }| ≤ 1
// ∧ (s.status = TRIAL ⟹ no Invoice exists with kind=TEACHER_SUBSCRIPTION ∧ status=PENDING)
```

**Validates: Requirements 3.2, 3.7**

**Enforcement:** partial unique index + service-level guard.

### Property 3: Notification fan-out idempotency

*For any* group, schedule version, and enrolled student, exactly one notification exists regardless of how many times the worker re-processes the same OutboxEvent.

```ts
// ∀ groupId, version, studentId in approvedEnrolledOf(groupId):
//   |{ n ∈ Notification |
//        n.userId = studentId ∧ n.kind = SCHEDULE_CHANGED
//        ∧ n.idempotencyKey = "schedule.changed:" + groupId + ":v" + version + ":" + studentId }| = 1
//
// regardless of how many times the worker re-processes the same OutboxEvent.
```

**Validates: Requirements 10.2, 10.3, 10.4, 10.6**

**Test:** simulate 3× retry of the worker; assert total Notification rows == |students|.

### Property 4: AI tutor never produces a complete answer

*For any* tutor call during a student's active submission, the AI response similarity to the student's context text is below 0.7 and the response never contains a verbatim submittable answer.

```ts
// ∀ submission, tutorCalls(submission.userId) during draft:
//   ∀ call ∈ tutorCalls:
//     longestCommonSubstring(call.reply, submission.finalAnswer) / |submission.finalAnswer| < 0.5
//   ∧ similarity(call.reply, submission.contextText) < 0.7
```

**Validates: Requirements 13.3, 13.6**

**Test:** offline corpus of past submissions; replay tutor with intent=EXPLAIN; assert similarity < 0.7.

### Property 5: Payment to Enrollment atomicity

*For any* successful Payme PerformTransaction webhook, exactly one Invoice is marked PAID, exactly one EnrollmentRequest is created (for STUDENT_COURSE), and exactly one OutboxEvent is emitted — all atomically within a single DB transaction. The webhook is idempotent: invoking multiple times produces the same DB state.

```ts
// ∀ paymeWebhook(method=PerformTransaction, paymeId=p):
//   after_handler:
//     PaymeTransaction(paymeId=p).state = PAID
//     ⟹ ∃! Invoice(status=PAID, paymeTxId=p.txId)
//        ∧ if invoice.kind = STUDENT_COURSE then ∃! EnrollmentRequest(invoiceId=invoice.id)
//        ∧ ∃! OutboxEvent(idempotencyKey="payment.succeeded:" + invoice.id)
//   webhook is idempotent: invoking twice produces the same DB state.
```

**Validates: Requirements 4.2, 4.4, 4.5, 19.4**

**Test:** chaos test — invoke webhook 5× concurrently; assert single Invoice update, single
EnrollmentRequest, single OutboxEvent.

### Property 6: Live recording completion

*For any* live session that reaches LIVE status, it eventually transitions to either ENDED (with a READY Recording and Attachment) or RECORDING_FAILED — it never remains in LIVE state.

```ts
// ∀ liveSession s where s.status reached LIVE:
//   eventually s.status ∈ {ENDED, RECORDING_FAILED}
//   ∧ if s.status = ENDED then
//      ∃ recording r where r.sessionId = s.id ∧ r.status = "READY"
//      ∧ ∃ attachment a where a.lessonId = s.lessonId ∧ a.kind = RECORDING ∧ a.assetId = r.assetId
```

**Validates: Requirements 9.6, 9.7, 9.8**

**Test:** simulate finalize success and failure paths; assert state machine never stays in LIVE.

### Property 7: Authorization completeness

*For any* controller route handler, it must be either decorated with @Public() or protected by JwtAuthGuard AND a Roles guard or domain-specific guard.

```ts
// For every controller route handler `h`:
//   h must be either:
//     decorated with @Public()
//   OR has a JwtAuthGuard
//     AND a Roles guard  OR  a domain-specific guard (e.g., LessonAccessGuard)
```

**Validates: Requirements 17.3, 17.4**

**Enforcement:** custom ESLint rule + a runtime check in `app.bootstrap.ts` that scans the metadata
of all routes and asserts the predicate.

### Property 8: Schedule monotonic versioning

*For any* schedule update, the version counter increments by exactly 1, and every ScheduleException references a real RRULE occurrence in the current schedule.

```ts
// ∀ schedule s after update:
//   s.version = old.version + 1
// ∀ ScheduleException e:
//   e.originalAt corresponds to a real RRULE occurrence in current schedule.
```

**Validates: Requirements 10.1**

### Property 9: Group-scoped homework module toggle (with specialty catalog ⊇ group toggles)

*For any* assignment, all its modules must be ENABLED in the parent group at creation time (P9a). *For any* GroupModule, its moduleType must exist in the group's specialty catalog (P9b). *For any* specialty, at most 10 active SpecialtyModules exist (P9c). Disabling a module is non-destructive — past assignments continue to function.

```ts
// P9a: An assignment may only contain modules ENABLED in its parent group.
//   ∀ assignment a, ∀ module m ∈ a.modules:
//     ∃ GroupModule(groupId = a.lesson.groupId, moduleType = m.type, isEnabled = true)
//   AT THE TIME OF a.createdAt or a.publishedAt.
// (Past assignments retain their modules even if the toggle is later flipped off — non-destructive.)
//
// P9b: A GroupModule may only exist for modules in the group's specialty catalog.
//   ∀ GroupModule gm:
//     ∃ SpecialtyModule(specialtyId = group(gm.groupId).course.teacher.specialtyId,
//                       moduleType = gm.moduleType, isActive = true)
//
// P9c: Per-specialty cap.
//   ∀ Specialty s: |{ sm ∈ SpecialtyModule | sm.specialtyId = s.id ∧ sm.isActive }| ≤ 10
```

**Validates: Requirements 11.1, 11.4, 11.5, 11.6, 11.7, 11.8**

**Enforcement:**
1. `GET /homework/available-modules?groupId=...` returns the per-Group enabled
   subset; `<AssignmentBuilder>` UI hides everything else.
2. `POST/PATCH /homework/assignments*` re-validates server-side against
   `GroupModule.isEnabled = true` for the lesson's group before write
   (defence in depth — UI compromise must not bypass it).
3. `PUT /catalog/groups/:id/modules` rejects any `moduleType` not present in
   the group's specialty catalog (`MODULE_NOT_IN_SPECIALTY_CATALOG`),
   maintaining P9b.
4. `enforce_specialty_module_cap()` deferred constraint trigger maintains
   P9c at the DB layer; admin service-layer guard rejects earlier with a
   friendlier error.
5. Disabling is non-destructive: existing `AssignmentModule` rows keep
   functioning; only the picker hides the module for new assignments.

**Tests (fast-check):**
- Generate random specialties with up to 12 modules; assert that inserting or
  flipping `isActive=true` on the 11th throws `specialty_module_cap_exceeded`.
- Generate random `(group, moduleType, toggleState)` combinations; assert
  `createAssignment` succeeds iff every requested module has
  `GroupModule.isEnabled = true` for that group at submission time.
- Generate a stream of toggle flips interleaved with assignment creations and
  past-assignment renders; assert that flipping a module OFF never breaks the
  rendering or grading of assignments created while it was ON.

### Property 10: Discovery visibility respects `isDiscoverable`

*For any* Group with isDiscoverable=false, it never appears in /discovery/* responses. *For any* Course with isDiscoverable=false or isPublished=false, it is excluded from discovery. *For any* TeacherProfile with publicSlug=NULL, it is excluded from teacher search results.

```ts
// ∀ Group g where g.isDiscoverable = false:
//   g ∉ response of any /discovery/* endpoint
// ∀ Course c where c.isDiscoverable = false OR c.isPublished = false:
//   c ∉ response of /discovery/courses
//   AND c is omitted from /discovery/teachers/:slug.courses[]
// ∀ TeacherProfile t where t.publicSlug = NULL:
//   t ∉ response of /discovery/teachers
//   AND /discovery/teachers/:slug returns 404 for any slug binding to t
```

**Validates: Requirements 14.2, 14.3, 14.4**

**Test:** seed mixed discoverable/non-discoverable rows; assert response
contains exactly the expected subset across all `/discovery/*` endpoints.

### Property 11: DM rate-limit until reciprocated

*For any* DM message from user A to user B, if B has not yet replied (not reciprocated), subsequent messages from A within 60 seconds are rejected with 429. Once B replies, only the global per-user limit applies. Additionally, for any unordered pair (A, B), at most one DM ChatRoom exists.

```ts
// ∀ DM message m authored by `a` to `b` at time t:
//   if ∄ prior message from b → a (i.e. not reciprocated):
//     ∀ subsequent message m' from a → b at time t' with t' < t + 60s:
//       request rejected with 429 RATE_LIMITED
//   if ∃ prior message from b → a (reciprocated):
//     only the global per-user chat limit applies (~30 msg/min)
//
// AND
// ∀ DM ChatRoom r:
//   r.scope = "DM" ∧ r.scopeRef = `${min(uA,uB)}:${max(uA,uB)}`
// ⟹ at most ONE such row exists per unordered pair (uA, uB)
```

**Validates: Requirements 15.2, 15.3, 15.4, 15.5**

**Test:** stateful fast-check model — generate sequences of `sendDm` actions
between two pairs and one already-reciprocated pair; assert the rate-limiter
state machine matches the property; assert UNIQUE constraint on
`(scope, scopeRef)` is never violated.

### Property 12: Subscription state machine valid transitions

*For any* sequence of events applied to a subscription, only valid state transitions occur according to the defined state machine (TRIAL→ACTIVE, TRIAL→EXPIRED, ACTIVE→PAST_DUE, ACTIVE→CANCELED, PAST_DUE→ACTIVE, PAST_DUE→EXPIRED). Invalid transitions are rejected.

```ts
// ∀ subscription s, event e:
//   transition(s.status, e) ∈ validTransitions
//   where validTransitions = {
//     (TRIAL, PAYMENT_SUCCEEDED) → ACTIVE,
//     (TRIAL, TRIAL_EXPIRED) → EXPIRED,
//     (ACTIVE, PERIOD_END_REACHED) → PAST_DUE,
//     (ACTIVE, CANCEL_REQUESTED) → sets cancelAt,
//     (PAST_DUE, PAYMENT_SUCCEEDED) → ACTIVE,
//     (PAST_DUE, GRACE_EXPIRED) → EXPIRED
//   }
```

**Validates: Requirements 3.1, 3.3, 3.4, 3.5, 3.6**

**Test (fast-check):** generate random sequences of subscription events; assert only valid transitions occur and terminal states are absorbing.

### Property 13: Group module seeding matches specialty catalog

*For any* newly created group, the set of GroupModule rows exactly matches the teacher's active SpecialtyModule catalog, with isEnabled values matching defaultEnabled.

```ts
// ∀ group g created by teacher t:
//   { gm.moduleType | gm ∈ g.modules } = { sm.moduleType | sm ∈ SpecialtyModule, sm.specialtyId = t.specialtyId, sm.isActive = true }
//   ∧ ∀ gm ∈ g.modules: gm.isEnabled = correspondingSM.defaultEnabled
```

**Validates: Requirements 7.2, 7.3, 11.2**

**Test (fast-check):** generate random specialty catalogs (1-10 modules with various defaultEnabled values); create groups; assert GroupModule set matches exactly.

### Property 14: Idempotency-Key produces same response

*For any* mutating request with an Idempotency-Key, sending the same request twice with the same key produces the same response and does not create duplicate side effects.

```ts
// ∀ request r with Idempotency-Key k:
//   response(r, k, attempt=1) = response(r, k, attempt=2)
//   ∧ sideEffects(r, k, attempt=1) = sideEffects(r, k, attempt=2)
// ∀ request r' with same k but different payload:
//   response = 409 IDEMPOTENCY_CONFLICT
```

**Validates: Requirements 19.1, 19.2, 18.6**

**Test (fast-check):** generate random valid requests with idempotency keys; send each twice; assert responses match and DB state is unchanged after second call.

### Property 15: Translation cache round-trip

*For any* word or sentence translation, if the result is cached, subsequent requests return the cached value without calling Claude API. Cache keys are deterministic based on input.

```ts
// ∀ word w, context c, locale l:
//   let key = "tr:word:" + l + ":" + sha1(normalize(w) + "|" + c)
//   translateWord(w, c, l) at t1 → result R, redis.set(key, R)
//   translateWord(w, c, l) at t2 (t2 < t1 + TTL) → R (from cache, no Claude call)
```

**Validates: Requirements 22.3, 22.4, 22.5**

**Test (fast-check):** generate random words and contexts; call translate twice; assert second call returns same result and does not invoke Claude.

### Property 16: Progressive brute-force lockout

*For any* user account, if 5 consecutive failed login attempts occur, the account is temporarily locked for 30 minutes. If 3 more failed attempts occur during lockout, the account is permanently locked and admin is notified. The lockout counter resets after a successful login.

```ts
// ∀ user u, sequence of login attempts L:
//   |{ l ∈ L | l.success = false ∧ l consecutive }| ≥ 5
//     ⟹ u.lockStatus = TEMP_LOCKED ∧ u.lockExpiresAt = now + 30min
//   |{ l ∈ L | l.success = false ∧ l during TEMP_LOCKED }| ≥ 3
//     ⟹ u.lockStatus = PERM_LOCKED ∧ admin notified
//   ∀ successful login: failedAttemptCounter resets to 0
```

**Validates: Requirements 27.4, 27.5**

**Test (fast-check):** generate random sequences of login attempts (success/failure); assert lockout triggers at exact thresholds and resets correctly.

### Property 17: Impossible travel detection

*For any* two consecutive login events for the same user, if the geographic distance exceeds 500km and the time difference is less than 1 hour, the session is blocked and MFA re-verification is required.

```ts
// ∀ user u, login events (e1, e2) where e2.time - e1.time < 3600s:
//   haversine(e1.location, e2.location) > 500km
//     ⟹ e2.session.blocked = true ∧ e2.requiresMfaReauth = true
//   haversine(e1.location, e2.location) ≤ 500km
//     ⟹ e2.session.blocked = false (normal flow)
```

**Validates: Requirements 27.3**

**Test (fast-check):** generate random pairs of (latitude, longitude, timestamp); compute haversine distance; assert blocking decision matches the 500km/1h threshold.

### Property 18: Rate-based IP blocking thresholds

*For any* single IP address, if 10 or more distinct user accounts receive login attempts from that IP within a sliding window, the IP is blocked for 24 hours. For honeypot endpoints, any single request triggers immediate IP blocking.

```ts
// ∀ IP address ip, time window w (sliding):
//   |{ distinct userId | loginAttempt(ip, userId) within w }| ≥ 10
//     ⟹ ip.blocked = true ∧ ip.blockExpiresAt = now + 24h
// ∀ request r to honeypot endpoint:
//   r.sourceIp is immediately added to blocklist
```

**Validates: Requirements 27.8, 27.9**

**Test (fast-check):** generate random login attempt sequences from various IPs to various accounts; assert IP blocking triggers at exactly 10 distinct accounts. Generate random requests to honeypot endpoints; assert immediate blocking.

### Property 19: Encryption round-trip (AES-256-GCM)

*For any* valid plaintext data, encrypting with AES-256-GCM and then decrypting with the same key produces the original plaintext. Column-level encrypted fields (phone, address, cardLastFour) maintain this round-trip property through the application layer.

```ts
// ∀ plaintext p, key k:
//   decrypt(encrypt(p, k), k) = p
// ∀ User u with phone field:
//   readDecrypted(u.phone) = originalPlaintext
//   AND stored value in DB ≠ originalPlaintext (encrypted at rest)
```

**Validates: Requirements 28.1, 28.3**

**Test (fast-check):** generate random strings (including unicode, empty, max-length); encrypt then decrypt; assert equality. Generate random User records; save to DB; assert stored bytes differ from plaintext; read back; assert equality.

### Property 20: PII masking in logs

*For any* log message or error output, PII patterns (email addresses, phone numbers, IP addresses, card numbers) are automatically masked before output. The masked output never contains the original PII value.

```ts
// ∀ log message m containing PII pattern p:
//   maskPII(m) does NOT contain p
//   ∧ maskPII(m) contains masked version (e.g., "u***@...", "***1234")
// ∀ error response e:
//   e.message does NOT match any PII regex pattern
```

**Validates: Requirements 28.6**

**Test (fast-check):** generate random strings containing email/phone/IP/card patterns; pass through PII masking function; assert original values are not present in output; assert masked placeholders are present.

### Property 21: Crypto-shredding makes data unrecoverable

*For any* user whose encryption key is deleted (crypto-shredding), all previously encrypted data for that user becomes permanently unrecoverable. Decryption attempts with the deleted key fail with an appropriate error.

```ts
// ∀ user u, encrypted data d = encrypt(plaintext, u.encryptionKey):
//   after deleteKey(u.encryptionKey):
//     decrypt(d, u.encryptionKey) throws KEY_NOT_FOUND
//     ∧ no method exists to recover plaintext from d
```

**Validates: Requirements 28.7**

**Test (fast-check):** generate random user data; encrypt; delete key from Vault/KMS; attempt decryption; assert failure. Verify key no longer exists in key store.

### Property 22: Key rotation preserves data access

*For any* encryption key rotation event, all data previously encrypted with the old key remains accessible (re-encrypted with new key) with zero downtime. The rotation is atomic — no data is left in an inconsistent state.

```ts
// ∀ key rotation from k_old to k_new:
//   ∀ data d encrypted with k_old:
//     after rotation: decrypt(re-encrypt(d, k_old, k_new), k_new) = original_plaintext
//     ∧ no window exists where d is unreadable
```

**Validates: Requirements 28.4**

**Test (fast-check):** generate random encrypted records; perform key rotation; assert all records are still readable and now encrypted with new key.

### Property 23: Role-based MFA enforcement

*For any* user with TEACHER or ADMIN role, authentication without MFA (TOTP or hardware key) is rejected. For ADMIN role specifically, WebAuthn/FIDO2 hardware key is required — TOTP alone is insufficient. STUDENT role does not require MFA.

```ts
// ∀ user u:
//   u.role = ADMIN ⟹ login requires WebAuthn/FIDO2 (hardware key mandatory)
//   u.role = TEACHER ⟹ login requires TOTP or SMS (MFA mandatory)
//   u.role = STUDENT ⟹ login does NOT require MFA (optional)
// ∀ login attempt without required MFA factor:
//   response = 403 MFA_REQUIRED
```

**Validates: Requirements 29.1, 29.7**

**Test (fast-check):** generate random users with different roles; attempt login with/without MFA; assert enforcement matches role requirements.

### Property 24: Session binding to IP and User-Agent

*For any* active session, if the request IP or User-Agent changes from the values recorded at session creation, the session is immediately invalidated and re-authentication is required.

```ts
// ∀ session s created with (ip_0, ua_0):
//   ∀ request r using s where r.ip ≠ ip_0 ∨ r.userAgent ≠ ua_0:
//     s.status = INVALIDATED ∧ response = 401 SESSION_BINDING_VIOLATED
//   ∀ request r using s where r.ip = ip_0 ∧ r.userAgent = ua_0:
//     s remains valid (normal flow)
```

**Validates: Requirements 29.3**

**Test (fast-check):** generate random sessions with initial IP/UA; generate subsequent requests with same/different IP/UA; assert session invalidation occurs exactly when binding is violated.

### Property 25: Password policy validation

*For any* password string, the validation function correctly accepts passwords meeting all criteria (≥12 chars, uppercase, lowercase, digit, special char, not in breach database) and rejects passwords failing any criterion.

```ts
// ∀ password p:
//   isValid(p) = true ⟺
//     p.length ≥ 12
//     ∧ ∃ c ∈ p: c.isUpperCase
//     ∧ ∃ c ∈ p: c.isLowerCase
//     ∧ ∃ c ∈ p: c.isDigit
//     ∧ ∃ c ∈ p: c.isSpecialChar
//     ∧ p ∉ breachedPasswordsDB
```

**Validates: Requirements 29.5**

**Test (fast-check):** generate random strings of varying lengths and character compositions; assert validation function correctly classifies each as valid/invalid based on all criteria.

### Property 26: HMAC request signing verification

*For any* request to a critical endpoint (payment, enrollment, admin), the request is accepted if and only if it carries a valid HMAC-SHA256 signature computed over the request body with the shared secret. Tampered signatures or missing signatures result in 401.

```ts
// ∀ request r to critical endpoint:
//   let sig = HMAC-SHA256(sharedSecret, r.body)
//   r.headers["X-Signature"] = sig ⟹ request accepted
//   r.headers["X-Signature"] ≠ sig ⟹ 401 INVALID_SIGNATURE
//   r.headers["X-Signature"] missing ⟹ 401 SIGNATURE_REQUIRED
```

**Validates: Requirements 30.1**

**Test (fast-check):** generate random request bodies; compute valid HMAC; assert acceptance. Tamper with body or signature; assert rejection.

### Property 27: Secure response envelope (headers + no internal leakage)

*For any* HTTP response from the platform, all required security headers are present with correct values, and error responses never contain stack traces, internal file paths, or database schema information.

```ts
// ∀ HTTP response r:
//   r.headers["Content-Security-Policy"] exists ∧ is strict
//   ∧ r.headers["X-Frame-Options"] = "DENY"
//   ∧ r.headers["X-Content-Type-Options"] = "nosniff"
//   ∧ r.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
//   ∧ r.headers["Permissions-Policy"] exists
// ∀ error response e (4xx, 5xx):
//   e.body does NOT match /at\s+\w+\s+\(.*:\d+:\d+\)/ (stack trace)
//   ∧ e.body does NOT contain "/home/", "/app/", "node_modules"
//   ∧ e.body does NOT contain table/column names from schema
```

**Validates: Requirements 30.3, 30.9**

**Test (fast-check):** generate random API requests (valid and invalid); assert all responses contain required security headers. Trigger various error conditions; assert no internal details leak.

### Property 28: Input sanitization prevents injection

*For any* user-provided input containing XSS, SQL injection, or command injection patterns, the sanitization layer neutralizes the dangerous content before it reaches the application logic.

```ts
// ∀ input i containing injection pattern:
//   sanitize(i) does NOT contain executable script tags, SQL keywords in dangerous positions,
//   or shell metacharacters
//   ∧ sanitize(i) preserves the semantic content where safe
// ∀ parameterized query q with user input:
//   q is immune to SQL injection regardless of input content
```

**Validates: Requirements 30.2**

**Test (fast-check):** generate random strings with embedded XSS payloads (<script>, onerror=, javascript:), SQL injection patterns (' OR 1=1--), and command injection (;rm -rf); pass through sanitization; assert dangerous patterns are neutralized.

### Property 29: Audit trail completeness and tamper-proof integrity

*For any* sensitive operation (login, logout, permission change, data access, payment, admin action), an audit log entry is created with all required fields. The audit log maintains cryptographic hash chaining — each entry's hash includes the previous entry's hash, making tampering detectable.

```ts
// ∀ sensitive operation op:
//   ∃ auditEntry e where:
//     e.userId = op.actor ∧ e.action = op.type ∧ e.timestamp ≈ op.time
//     ∧ e.ip exists ∧ e.device exists ∧ e.context exists
// ∀ consecutive audit entries (e_n, e_{n+1}):
//   e_{n+1}.prevHash = hash(e_n)
//   ∧ verifyChain(auditLog) = true (no gaps, no modifications)
```

**Validates: Requirements 32.3, 32.4**

**Test (fast-check):** generate random sequences of sensitive operations; assert audit entries are created with all fields. Generate audit log chains; verify hash integrity. Attempt to modify/delete an entry; assert chain verification fails.

### Property 30: GDPR data subject rights completeness

*For any* user requesting data export, the exported data contains ALL personal data stored across all modules. *For any* user requesting data deletion, ALL personal data is removed (via crypto-shredding) and no residual PII remains in any table or log.

```ts
// ∀ user u requesting data export:
//   export(u) ⊇ { all PII fields across User, TeacherProfile, Enrollment, Submission, ChatMessage, ... }
//   ∧ export is delivered within 30 days
// ∀ user u requesting data deletion:
//   after deletion: ∀ table t: ¬∃ row r in t where r contains u.PII
//   ∧ audit log records the deletion request and completion
```

**Validates: Requirements 32.2**

**Test (fast-check):** generate random users with data across multiple modules; request export; assert all known PII fields are included. Request deletion; scan all tables; assert no residual PII.

---

## Error Handling

### Standart kodlar

| HTTP | Domen kodi | Sabab |
|---|---|---|
| 400 | `VALIDATION_FAILED` | zod validation |
| 401 | `UNAUTHENTICATED` | missing/invalid token |
| 403 | `FORBIDDEN_ROLE` | role guard |
| 403 | `LESSON_ACCESS_DENIED` | enrollment guard |
| 403 | `SUBSCRIPTION_EXPIRED` | teacher expired tries to publish |
| 404 | `RESOURCE_NOT_FOUND` | |
| 409 | `IDEMPOTENCY_CONFLICT` | same key, different payload |
| 409 | `STATE_TRANSITION_INVALID` | submission/sub/enrollment state |
| 422 | `BUSINESS_RULE_VIOLATED` | e.g., paying for own group |
| 429 | `RATE_LIMITED` | |
| 451 | `AI_POLICY_BLOCKED` | tutor call refused for policy |
| 500 | `INTERNAL_ERROR` | |
| 502 | `UPSTREAM_ERROR` | Payme/Claude/SES |

### Domen-specific xato senariyalari

**Payment failure during checkout**
- *Condition:* Payme returns -31001 (invalid amount) or -31050 (account not found).
- *Response:* user sees a localized message; system updates `PaymeTransaction.state = CANCELED`;
  `Invoice` remains `PENDING` (so user can retry). Outbox emits `payment.failed`.
- *Recovery:* student may retry checkout; idempotencyKey rotated.

**R2 multipart upload aborted (network drop)**
- *Condition:* `complete` not called for 24h.
- *Response:* daily cron `media-cleanup` calls `AbortMultipartUpload` and deletes
  `MediaAsset` rows in `UPLOADING` for >24h.
- *Recovery:* user simply re-uploads.

**Live recorder crash mid-session**
- *Condition:* recorder process exits non-zero.
- *Response:* `LiveSession.status = LIVE` continues for participants; supervisor restarts recorder
  and stitches segments. If unrecoverable: on `endSession`, status = `RECORDING_FAILED`.
- *Recovery:* teacher notified; given option to re-upload locally captured backup.

**Claude API outage**
- *Condition:* timeout or 5xx.
- *Response:* AI Gateway returns degraded mode: tutor returns a localized "AI offline" message;
  grading precheck queue retries with exponential backoff (up to 24h). Teacher can grade manually
  meanwhile.

**Payme webhook with mismatched signature**
- *Condition:* Basic Auth invalid.
- *Response:* JSON-RPC error `-32504`; logged to security audit; rate-limited to prevent probing.

**Schedule RRULE invalid**
- *Condition:* user supplies malformed RRULE.
- *Response:* zod-level validation rejects (`VALIDATION_FAILED`); never persisted.

---

## Testing Strategy

### Layers

1. **Unit tests** (Jest) — pure domain logic: state machines, RRULE expansion, idempotency derivation,
   AI policy check.
2. **Property-based tests** (fast-check) — invariants P1..P8 above.
3. **Integration tests** (Jest + Testcontainers) — Postgres + Redis + minio; full module wiring.
4. **Contract tests** — OpenAPI spec drift detection (Spectral lint + breaking-change check).
5. **End-to-end tests** (Playwright) — critical user journeys: teacher signup → onboarding → publish
   lesson; student invite → pay → enrolled → watch.
6. **Load tests** (k6) — `/lessons`, `/notifications`, live signaling room of 500 viewers.
7. **Chaos** — kill api pod mid-payment-webhook; assert idempotency.

### Property-based testing library

**`fast-check`** (TypeScript). Configuration: `numRuns: 200` for CI, `numRuns: 2000` nightly.

### Test data

- Prisma `seed.ts` provides: 3 teachers, 1 admin, 5 specialties, 6 onboarding questions, 2 plans.
- Per-test factories under `test/factories/*` (fishery-style).

### Coverage targets

| Layer | Threshold |
|---|---|
| Domain services | 90% |
| Controllers | 75% |
| Workers | 80% |
| FE components | 60% (pyramid base) |

---

## Performance Considerations

- **Read paths:** `GET /catalog/groups/:id/lessons` cached in Redis 60s with cache-key per
  `(groupId, version, userId.role)`; invalidated on `lesson.published` and `schedule.changed`.
- **Group module toggles:** `GET /catalog/groups/:id/modules` returns a small
  list (≤10 rows). Cached in Redis 60s by `groupId`; invalidated on any toggle
  flip (single-toggle endpoints or bulk PUT). Read-through: the first request
  after a flip recomputes from Postgres. The same key is reused by
  `GET /homework/available-modules?groupId=...` so the picker hits the same
  warm cache.
- **N+1 prevention:** all list endpoints use Prisma `include` carefully; common patterns extracted
  to `repositories/*.ts`.
- **Pagination:** keyset (cursor) pagination for `lessons`, `notifications`, `submissions` (>10k rows).
- **HLS delivery:** R2 + Cloudflare CDN; signed URLs valid 6h.
- **Live SFU sizing:** 1 worker handles ~250 simultaneous consumers; auto-scale per CPU.
- **DB indexes:** every `@@index` declared in schema is justified by a query in the service layer
  (documented in `docs/db-indexes.md`).
- **BullMQ:** separate queues per workload to prevent head-of-line blocking
  (`email`, `telegram`, `transcoding`, `ai-grading`, `notification-fanout`, `outbox`).
- **Discovery search indexes:** `pg_trgm` GIN indexes on
  `TeacherProfile.fullName`, `TeacherProfile.headline`, `Course.title`, `Group.name`
  (added via raw SQL migration since Prisma cannot express `gin_trgm_ops` opclass).
  Combined with `to_tsvector('simple', ...)` full-text vectors for name/headline
  ranking. Discovery list endpoints are cached in Redis 30s by `(query, page)`,
  invalidated on `teacher.profile_updated` and `course.published` events.
  At >100k teachers a Phase 9 swap-in to **Meilisearch / Typesense** is planned;
  the API contract stays unchanged so the swap is transparent to clients.
- **DM rate-limit storage:** Redis sorted set per pair-key
  (`dm:rl:{sortedPair}`) with last-message timestamps; reciprocation flag stored
  as a single `dm:recip:{sortedPair}` boolean key (TTL: persistent until
  explicitly revoked).

---

## Security Considerations

- **Password hashing:** Argon2id (m=19MiB, t=2, p=1).
- **JWT:** HS256 access (15m), opaque refresh (30d, hashed in DB; rotated on each refresh, family-revoke on theft detection).
- **Cookies:** `HttpOnly; Secure; SameSite=Lax`; refresh in cookie, access in memory only.
- **CSRF:** double-submit token for cookie-bound endpoints (login, refresh, payment redirect).
- **Rate limiting:** Redis token bucket per IP and per user; stricter on `/auth/*` and `/ai/*`.
- **Input validation:** zod at controller boundary; Prisma rejects unknown fields.
- **R2 signed URLs:** short TTL (≤6h); per-user; never expose bucket directly.
- **Payme webhook:** strict Basic Auth + IP allowlist (Payme's documented ranges) + idempotent state machine.
- **Audit logging:** every admin action + every billing mutation + every AI call; immutable Loki sink.
- **PII:** email/phone considered PII; `pg_crypto` field-level encryption for `User.phone` (AEAD).
- **Tenancy isolation:** every catalog query parameterized by `teacherId` derived from JWT; cross-teacher
  access is impossible at the repository layer (asserted by tests).
- **Secrets:** `doppler` or `sealed-secrets` in K8s; never in env files committed.
- **OWASP Top 10:** addressed via Helmet, parameterized queries (Prisma), output encoding (React),
  CSP `default-src 'self'` + R2 + CDN.
- **AI safety:** prompt injection mitigated by quoting user content with `<<<` fences, instruction
  hierarchy, and post-processing validation.
- **Content moderation:** chat messages run through a profanity filter; flagged messages quarantined.

---

## Observability and Operations

- **Logs:** structured JSON via `pino`; trace-id propagation; shipped to Loki.
- **Metrics:** Prometheus client; RED + USE; per-queue depth + age; AI cost/hour.
- **Tracing:** OpenTelemetry → Tempo; spans on Prisma, Redis, R2, Claude.
- **Errors:** Sentry for FE + BE.
- **Dashboards (Grafana):**
  1. *Business* — DAU/MAU, active subs, conversion trial→paid, Payme success rate.
  2. *Live* — concurrent viewers, SFU CPU, recorder failures.
  3. *AI* — cost, latency, policy-blocked rate, tutor calls/student/day.
  4. *Reliability* — error rate, p95 latency, queue lag.
- **Alerting:** PagerDuty on: payment webhook 5xx > 1% over 5m; live recorder failure ratio > 5%;
  outbox dispatcher lag > 5 min; AI daily budget exceeded.
- **Runbooks:** `docs/runbooks/*.md` per common incident.
- **Backups:** Postgres PITR (WAL-G) to R2 every 5m; weekly restore drill; R2 cross-region replication
  for media.

---

## Dependencies

### External services

| Service | Used by | Notes |
|---|---|---|
| **Cloudflare R2** | Media, recordings | S3-compatible API |
| **Anthropic Claude** | AI Gateway | `claude-3-5-sonnet-latest`, fall back to haiku for translate |
| **Payme** | Billing | JSON-RPC + receipts API |
| **SES / SMTP** | Email worker | transactional |
| **Telegram Bot API** | Notifications | for users who linked TG |
| **mediasoup** | SFU | self-hosted |
| **Cloudflare CDN/WAF** | Edge | TLS, DDoS, caching |

### Internal NPM packages

`@edubridge/db`, `@edubridge/api-client`, `@edubridge/shared-types`, `@edubridge/ui`,
`@edubridge/config`, `@edubridge/i18n`.

### Asosiy uchinchi tomon kutubxonalar

Backend: NestJS, Prisma, Argon2, ioredis, BullMQ, socket.io, mediasoup, @aws-sdk/client-s3,
@anthropic-ai/sdk, rrule, zod, pino, OpenTelemetry SDK.

Frontend: Next.js 14, React 18, Tailwind, shadcn/ui, TanStack Query, react-hook-form, zod,
hls.js, mediasoup-client, socket.io-client, next-intl, zustand, TipTap (writing editor).

Workers: ffmpeg (system binary), bullmq, resemble-perf-detector for AI text heuristic.

---

## Yakuniy eslatma

Ushbu dizayn hujjati EduBridge platformasining barcha asosiy fazalarini, modullarini, ma'lumot
modellarini, API yuzasini va kritik algoritmlarni qamrab oladi. Phase 1 (MVP Foundation) ushbu
hujjat asosida to'liq production-ready kod sifatida ishlab chiqiladi. Keyingi qadam — `tasks.md`
faylida har bir Phase'ni amalga oshirish uchun bajariladigan vazifalarga ajratish.
