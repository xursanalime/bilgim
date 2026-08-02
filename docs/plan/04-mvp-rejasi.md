# 04 — MVP rejasi (real sinovga asoslangan)

> **Bu hujjat taxminga emas, ishlab turgan tizimga asoslangan.**
> Lokal stack ko'tarildi (`scripts/bilgim.sh`), real teacher va student akkaunt
> yaratildi, butun yo'l API orqali bosqichma-bosqich bosib o'tildi:
> maktab → kurs → guruh → dars → jadval → vazifa → talaba qo'shildi →
> topshirdi → o'qituvchi baholadi. Har bir da'vo tekshirilgan.
>
> **AI MVP'dan chiqarilgan** — foydalanuvchi qaroriga ko'ra, AI integratsiyasi
> MVP'dan keyin butun platformaga qo'shiladi.
>
> Sana: 2026-07-29.

---

## 0. Sinov akkauntlari

| Rol | Email | Parol |
|---|---|---|
| Teacher | `teacher.mvp@bilgim.uz` | `TeacherMvp123!@#` |
| Student | `student.mvp@bilgim.uz` | `StudentMvp123!@#` |
| Admin (seed) | `admin@edubridge.uz` | `Admin123!@#` |

Ishga tushirish: `bash scripts/bilgim.sh` → API `:4000`, Web `:3000`.
API prefiksi: `/api/v1`.

---

## 1. Yaxshi xabar: asosiy halqa ishlaydi

Quyidagi zanjir **to'liq ishladi** (har biri 2xx):

```
Teacher: login → maktab profili → kurs yaratish → publish →
         guruh → dars → dars publish → RRULE jadval → vazifa → publish → invite link
Student: login → qo'shilish so'rovi → (teacher tasdiqladi) →
         darslarni ko'rish → jadval → topshiriq yaratish → autosave → SUBMIT
Teacher: grading queue → submission ochish → GRADE 85/100
Student: natijani ko'rdi (GRADED, 85)
```

Shuningdek ishlaydi: rol nazorati (talaba kurs yarata olmaydi → 403, admin
sahifasiga kira olmaydi → 403, o'z ishini baholay olmaydi → 403), enrollment
gate (tasdiqlanmagan talaba darsni ko'ra olmaydi → 403), gamification, DM,
group-chat, notification preferences, teacher analytics, CSV eksport, discovery.

**Ya'ni MVP uzoq emas.** Muammo yetishmayotgan funksiyalarda emas — bir necha
aniq uzilishda.

---

## 2. 🔴 P0 — MVP'ni bloklaydigan nosozliklar

### BUG-1. Outbox dispatcher vaqt zonasi sababli to'xtagan

**Ta'siri: barcha bildirishnoma, email va fan-out ishlamaydi.**

Isbot:

```sql
SELECT status, count(*), min("nextAttemptAt"), max("nextAttemptAt")
FROM "OutboxEvent" GROUP BY status;

   status   | count |         oldest          |         newest
------------+-------+-------------------------+-------------------------
 PENDING    |    13 | 2026-07-29 16:23:47.349 | 2026-07-29 16:41:48.472
 DISPATCHED |     7 | 2026-07-26 11:39:53.679 | 2026-07-26 11:44:46.95
```

Sabab zanjiri:

1. `OutboxEvent.nextAttemptAt` ustuni — `timestamp without time zone`,
   DB default `CURRENT_TIMESTAMP` ([schema.prisma](../../packages/db/prisma/schema.prisma))
2. DB sessiya zonasi — `Asia/Samarkand (+05)`, ya'ni `CURRENT_TIMESTAMP` = `16:42`
3. Dispatcher esa UTC bilan so'raydi:
   [outbox.dispatcher.ts:173](../../apps/api/src/infra/outbox/outbox.dispatcher.ts#L173)
   `nextAttemptAt: { lte: new Date() }` → `11:42`
4. `16:42 <= 11:42` = **false** → event hech qachon olinmaydi

Natijada `enrollment.approved`, `homework.graded`, `lesson.published`,
`user.registered` — hammasi navbatda qotib qoladi. Sinovda talaba baho olgandan
keyin **bitta ham bildirishnoma olmadi**.

**Nega bu ayniqsa xavfli:** production UTC'da bo'lsa muammo ko'rinmaydi, lekin
`Asia/Tashkent` — maqsadli bozor zonasi. Ya'ni bug faqat real muhitda paydo bo'ladi.

**Tuzatish variantlari** (birini tanlash):

| Variant | Baho |
|---|---|
| Ulanish satriga `?options=-c timezone=UTC` yoki `PGTZ=UTC` | Eng tez, MVP uchun yetarli |
| `postgresql.conf` da `timezone = 'UTC'` | Infra darajasida, ishonchli |
| Ustunlarni `timestamptz` ga migratsiya | To'g'ri uzoq muddatli yechim, lekin 60 model |

**Tavsiya:** MVP uchun UTC majburlash + regressiya testi
("event yaratilgandan keyin ≤N soniyada DISPATCHED bo'lishi").
`timestamptz` migratsiyasi MVP'dan keyin.

---

### BUG-2. Talaba uy vazifasini ololmaydi (403)

**Ta'siri: talabaning uy vazifasi sahifalari ishlamaydi.**

[assignments.controller.ts:56-57](../../apps/api/src/modules/homework/assignments.controller.ts#L56):

```ts
@Controller()
@Roles('TEACHER', 'ADMIN')   // ← klass darajasida, barcha route uchun
```

Shuning uchun:

| Endpoint | Talaba uchun | Kim chaqiradi |
|---|---|---|
| `GET /assignments/:id` | **403** | `/homework/[assignmentId]` sahifasi (`HomeworkAssignmentView`) |
| `GET /lessons/:lessonId/assignments` | **403** | dars sahifasidagi vazifalar ro'yxati |

Ya'ni `/uz/homework/<id>` sahifasi talaba uchun **hech qachon ma'lumot yuklay olmaydi**.
`components/homework/homework-assignment-view.tsx` → `homeworkApi.getAssignment()` →
`GET /assignments/:id` → 403.

**Tuzatish:** klass darajasidagi `@Roles` ni olib tashlab, har bir route'ga
alohida qo'yish. O'qish route'lari (`GET /assignments/:id`,
`GET /lessons/:id/assignments`) talabaga ochilsin — lekin **enrollment gate**
bilan (talaba faqat o'zi a'zo bo'lgan guruhning vazifalarini ko'rsin) va
faqat `isPublished=true` bo'lganlarini. Yozish route'lari
(`POST`, `publish`) teacher'da qolsin.

---

### BUG-3. "Mening barcha vazifalarim" endpointi yo'q

`GET /submissions/me` **majburiy** `assignmentId` talab qiladi
([submission.dto.ts:114](../../apps/api/src/modules/homework/dto/submission.dto.ts#L114)):

```ts
export const GetMySubmissionQuerySchema = z.object({
  assignmentId: z.string().uuid(),   // required
});
```

Lekin talabaning `/homework` sahifasi (`HomeworkOverview`) **barcha** vazifalar
ro'yxatini ko'rsatishi kerak — bir nechta guruh, bir nechta dars bo'ylab.
Bunday endpoint yo'q.

**Tuzatish:** yangi `GET /homework/my-assignments` — talabaning APPROVED
enrollment'lari bo'yicha barcha published assignment'lar + har biriga o'z
submission holati (DRAFT/SUBMITTED/GRADED) va muddat. Keyset pagination.
Bu MVP'da talabaning eng ko'p ishlatadigan ekrani.

---

### BUG-4. Guruh modullarini talaba ko'ra olmaydi

`GET /catalog/groups/:groupId/modules` → talaba uchun **403**.

Agar talabaning UI'si qaysi modul turlari yoqilganini bilishi kerak bo'lsa
(masalan submission formasi qaysi runtime'ni chizishini tanlash uchun) — bu
uziladi. Tekshirish kerak: talaba UI'siga bu ma'lumot kerakmi? Agar ha — read-only
ruxsat berilsin; agar yo'q — assignment javobida modul ro'yxati birga qaytsin.

---

### BUG-5. Gamification leaderboard Redis xatosi

API loglarida takroriy:

```
ERROR [GamificationService] Failed to update leaderboard for user ...
ReplyError: ERR value is not an integer or out of range
```

Redis sorted-set operatsiyasiga (`ZADD`/`ZINCRBY`) noto'g'ri tipdagi qiymat
uzatilmoqda — ehtimol `undefined`, `NaN` yoki float. Har XP hodisasida takrorlanadi.

Leaderboard sahifasi bor va navigatsiyada, ya'ni MVP yuzasi.
`gamification` modulida **0 ta test** ([00-holat-auditi](00-holat-auditi.md)) —
tuzatish bilan birga test yozilishi kerak.

---

### BUG-6. Faollashtirilgan lekin obunasiz o'qituvchi qulflanadi

Sinov davomida topildi: o'qituvchi `status=ACTIVE` bo'lsa-yu, obunasi bo'lmasa,
dars publish qilishga urinishda:

```
403 SUBSCRIPTION_EXPIRED — "Active subscription required to publish lessons."
```

Sabab: trial faqat `activateUser()` ichida yaratiladi
([auth.service.ts:337](../../apps/api/src/modules/auth/auth.service.ts#L337)),
u esa faqat status `ACTIVE` **emas** bo'lganda ishlaydi. Boshqa yo'l bilan
faollashgan (admin qo'li, migratsiya, seed) o'qituvchi abadiy blokda qoladi va
xato xabari chalg'ituvchi — "expired" deydi, aslida obuna **umuman yo'q**.

**Tuzatish:** (a) publish guard'i "obuna yo'q" va "obuna tugagan" holatlarini
ajratsin, (b) obunasi yo'q TEACHER uchun trial lazy yaratilsin yoki aniq
`SUBSCRIPTION_MISSING` xatosi qaytsin.

---

### BUG-7. Lokal muhitda email tasdiqlash imkonsiz

`scripts/bilgim.sh` Postgres, Redis, MinIO, LiveKit, ffmpeg — hammasini
ko'taradi, lekin **SMTP catcher yo'q**:

```
WARN [EmailProcessor] Outbox email send failed topic=user.registered
     to=...: connect ECONNREFUSED 127.0.0.1:1025
```

Port `1025` — MailHog/Maildev standarti, ya'ni mo'ljallangan lekin qo'shilmagan.
Natijada hech kim lokal muhitda ro'yxatdan o'tishni yakunlay olmaydi
(token DB'da hash'langan, tiklab bo'lmaydi).

**Tuzatish:** `bilgim.sh` ga MailHog qo'shish (Docker'siz binar mavjud).
Bu MVP funksiyasi emas, lekin **har bir ishlab chiquvchi va tester uchun blok**.

---

## 3. 🟡 P1 — Sahifalar orasidagi uzilishlar

### 3.1. Navigatsiyadan ochilmaydigan sahifalar (orphan)

Sidebar va top-nav'da havolasi yo'q, ya'ni foydalanuvchi ularga **hech qachon
yeta olmaydi**:

| Sahifa | Nima qiladi | Baho |
|---|---|---|
| `/homework/grading` | **O'qituvchi baholash navbati** (`TeacherGradingQueue`, 462 satr) | 🔴 MVP yuzasi, ochilmaydi |
| `/homework/new` | Vazifa yaratish | 🔴 Vazifa yaratib bo'lmaydi |
| `/notifications` | Bildirishnoma inbox | 🟡 Qo'ng'iroq belgisi kerak |
| `/assignments`, `/assignments/[id]` | Vazifalar ro'yxati (dublikat) | 🟡 §3.2 |
| `/submissions/[id]` | Submission tahrirlash | 🟡 |
| `/teacher-search` | O'qituvchi qidirish (talaba) | 🟡 |

**Eng jiddiy:** o'qituvchi baholash navbatiga va vazifa yaratishga navigatsiya
orqali kira olmaydi. Bu ikkalasi — o'qituvchining kunlik asosiy ishi.

**Tuzatish:** sidebar'da "Uy ishlari" ostida ichki havolalar yoki `/homework`
sahifasida rolга qarab tab'lar: o'qituvchiga *Vazifalar | Baholash navbati | Yangi vazifa*.

### 3.2. Dublikat sahifa oilalari

Bir xil ishni bajaradigan bir nechta parallel yuza — qaysi biri "haqiqiy"
ekani noaniq:

**Baholash (o'qituvchi) — 3 ta parallel UI:**

| Route | Komponent | LOC |
|---|---|---|
| `/homework/grading` | `TeacherGradingQueue` | 462 |
| `/homework/grading/[submissionId]` | — | — |
| `/homework/[assignmentId]/submissions/[submissionId]` | `TeacherGradingDetail` | 518 |
| `/teacher/assignments/[id]/submissions` | `TeacherSubmissionsList` | 224 |
| `/teacher/assignments/[id]/submissions/[submissionId]` | — | — |
| (komponent) | `TeacherSubmissionReview` | 447 |

**Vazifalar ro'yxati — 2 ta:**
`/homework` (`HomeworkOverview`, 531) va `/assignments` (`AssignmentsList`, 376)

**Vazifa tafsiloti — 2 ta:**
`/homework/[assignmentId]` (`HomeworkAssignmentView`, 402) va
`/assignments/[id]` (`StudentAssignmentDetail`, 362)

**Qidiruv/discovery — 4 ta:**
`/search`, `/discover`, `/teachers`, `/teacher-search`

**Tuzatish:** har oila uchun bittasini kanonik deb tanlash, qolganlarini
o'chirish yoki redirect qilish. Tavsiya: `/homework/*` daraxtini saqlash
(rol-aware), `/assignments/*` ni o'chirish; discovery uchun `/search` ni
kanonik qilish.

### 3.3. Ikkita dublikat auth helper

| Fayl | Eksport | Foydalanish |
|---|---|---|
| `lib/auth-server.ts` | `requireAuth`, `getServerUser` | 32 sahifa |
| `lib/server-auth.ts` | `requireRole`, `getServerUser`, `getServerAccessToken` | 13 sahifa |

Ikkalasida ham `getServerUser` bor — turli tiplar bilan (`ServerUser` va
`ServerAuthUser`). Nomlar deyarli bir xil (`auth-server` / `server-auth`) —
bu kelajakdagi bug manbai.

**Tuzatish:** bittaga birlashtirish (`requireAuth` keng tarqalgan → uni saqlash,
`requireRole` funksionalligini unga qo'shish).

---

## 4. 🟡 P1 — Eski dizaynda qolgan sahifalar

### 4.1. Migratsiya holati: ~50%

Dizayn tizimi tokenlari (`bg-base`, `text-ink-strong`, `bg-surface`, `border-line`)
va xom Tailwind kulranglari (`bg-white`, `text-gray-*`, `bg-slate-*`) yonma-yon
ishlatilmoqda:

```
Dizayn tokeni ishlatilishi : 1038
Xom kulrang ishlatilishi   : 1066   ← migratsiya yarim yo'lda
```

### 4.2. Ikkita sahifa avlodi

**Yangi naqsh** — sahifa yupqa wrapper, mantiq komponentda:

```tsx
// app/[locale]/(dashboard)/my-courses/page.tsx — 17 satr
export default function MyCoursesPage({ params: { locale } }) {
  unstable_setRequestLocale(locale);
  requireAuth({ locale, roles: ['STUDENT'] });
  return <StudentCourses locale={locale} />;
}
```

**Eski naqsh** — sahifa ichida server fetch + inline markup + xom kulranglar
(`/groups` 253 satr, `/admin/*` 139–289 satr, `/i/[token]` 213 satr).

### 4.3. Yangilanishi kerak bo'lgan sahifalar (ustuvorlik tartibida)

| Sahifa | LOC | Nega |
|---|---|---|
| `/groups` | 253 | Teacher kunlik yuzasi, eski naqsh + xom kulrang |
| `/i/[token]` | 213 | **Invite qabul qilish — birinchi taassurot**, talaba ko'radigan birinchi sahifa |
| `/admin/*` (10 sahifa) | 139–289 | Hammasi eski naqsh; MVP'da admin kam ishlatiladi → P2 |
| `/dashboard/courses/[courseId]/...` | 180–229 | Teacher kurs boshqaruvi |

### 4.4. Eng ko'p xom kulrang ishlatadigan komponentlar

| Komponent | Xom kulrang soni |
|---|---|
| `module-runtimes/vocabulary-runtime.tsx` | 35 |
| `module-runtimes/grammar-runtime.tsx` | 35 |
| `assignment-builder.tsx` | 32 |
| `module-runtimes/listening-runtime.tsx` | 31 |
| `module-runtimes/speaking-runtime.tsx` | 24 |
| `messages/message-thread.tsx` | 22 |
| `messages/group-chat-thread.tsx` | 22 |
| `module-runtimes/reading-runtime.tsx` | 22 |

Ya'ni **uy vazifa runtime'lari va xabarlar** — talaba eng ko'p vaqt o'tkazadigan
ikkita joy — eng eski ko'rinishda.

---

## 5. 🟢 P2 — O'lik kod (o'chirish)

Hech qayerdan import qilinmagan komponentlar (tekshirilgan):

| Guruh | Fayllar | ~LOC |
|---|---|---|
| **Eski landing avlodi** — `marketing/sections/*` (`hero-v3`, `bento-features`, `pricing-section`, `faq-section`, `landing-header`, `landing-footer`, `stats-strip`, `specialties-section`), `hero-v2`, `hero-visual`, `services-showcase`, `featured-discovery`, `trust-marquee`, `audience-toggle`, `cta-button`, `enroll-cta`, `role-switcher` | ~3 500 |
| **Eski auth dizayni** — `auth/brand-panel`, `role-selector`, `password-strength`, `password-input`, `form-button`, `auth-form-card` | ~600 |
| **Eski bildirishnoma UI** — `notification-bell` (270), `notifications-list` (171) | ~440 |
| `dashboard/onboarding-wizard` | 241 |
| `homework/assignment-card` | 89 |
| `landing/stats` | 87 |

**Jami ~5 000 satr o'lik kod.**

Joriy landing (`components/landing/*`) ishlaydi va **saqlanadi** —
`marketing/sections/*` tashlab ketilgan oldingi urinish.

⚠️ **Ogohlantirish:** `notification-bell.tsx` o'chirilishidan oldin — u
`/notifications` sahifasiga qo'ng'iroq qo'shish uchun **kerak bo'lishi mumkin**
(§3.1). Avval qaraladi, keyin qaror qilinadi.

---

## 6. MVP'dan chiqariladigan narsalar

Foydalanuvchi qaroriga ko'ra **AI MVP'dan chiqarildi**. Amaliy oqibatlari:

| Element | Harakat |
|---|---|
| Sidebar `/ai-chat` ("BilgimAI") — teacher **va** student menyusida | **Yashirish** (feature flag) |
| `/ai-chat` sahifasi, `components/ai/*` | Kodda qoladi, marshrutdan uziladi |
| AI grading precheck (`SUBMITTED → IN_REVIEW`) | O'chirilsin — vazifa to'g'ridan-to'g'ri o'qituvchiga borsin |
| Reading runtime tarjima popup'i | AI'siz ishlashi tekshirilsin (statik lug'at) |
| `/admin/ai` (AI Prompts) sahifasi | Admin menyusidan yashirilsin |
| `.env` `ANTHROPIC_API_KEY` | MVP'da kerak emas |

**Muhim tekshirish:** submission lifecycle AI'siz ham to'liq ishlashi kerak.
Sinovda `SUBMIT → GRADE` ishladi, ya'ni AI majburiy emas — lekin
`IN_REVIEW` holati AI precheck'ga bog'liq bo'lsa, u chetlab o'tilishi kerak.

---

## 7. MVP uchun yetishmayotgan funksiyalar

Sinov davomida aniqlangan, MVP uchun **kerak** bo'lgan lekin yo'q narsalar:

| # | Funksiya | Qayerda kerak | Holat |
|---|---|---|---|
| F1 | "Mening barcha vazifalarim" ro'yxati | Talaba `/homework` | ❌ Endpoint yo'q (BUG-3) |
| F2 | Bildirishnoma qo'ng'irog'i + hisoblagich | Top-nav (barcha rollar) | ❌ Komponent bor, ulanmagan |
| F3 | Baholash navbatiga navigatsiya | Teacher sidebar | ❌ Sahifa bor, havola yo'q |
| F4 | Vazifa yaratishga navigatsiya | Teacher | ❌ Sahifa bor, havola yo'q |
| F5 | Talaba uchun dars ichida vazifalar ro'yxati | `/lessons/[id]` | ❌ 403 (BUG-2) |
| F6 | Email tasdiqlash (lokal) | Dev muhit | ❌ MailHog yo'q (BUG-7) |
| F7 | To'lovsiz qo'shilish oqimi | `/i/[token]` | 🟡 `POST /enrollment/requests` ishlaydi, UI tekshirilmagan |

---

## 8. Bajarish tartibi

**Muhim:** tartib tasodifiy emas — har bosqich keyingisini ochadi.

### Bosqich 1 — Tizimni "tirik" qilish

1. **BUG-1** outbox TZ (UTC majburlash) — busiz bildirishnoma umuman yo'q
2. **BUG-7** MailHog — busiz hech kim ro'yxatdan o'ta olmaydi
3. **BUG-5** gamification Redis + test
4. **BUG-6** obuna guard'i xato xabari

*Chiqish mezoni:* yangi foydalanuvchi ro'yxatdan o'tib, emailini tasdiqlab,
bildirishnoma ola oladi.

### Bosqich 2 — Talaba yo'lini tuzatish

5. **BUG-2** `@Roles` ni route darajasiga tushirish + enrollment gate
6. **BUG-3** `GET /homework/my-assignments`
7. **BUG-4** guruh modullari (kerak bo'lsa)
8. **F1** talaba `/homework` sahifasini yangi endpointga ulash

*Chiqish mezoni:* talaba vazifani ko'radi, ochadi, topshiradi, bahosini ko'radi.

### Bosqich 3 — Navigatsiyani yopish

9. **F2** bildirishnoma qo'ng'irog'i top-nav'ga
10. **F3, F4** baholash navbati va vazifa yaratish havolalari
11. **§3.2** dublikat sahifalarni hal qilish (kanonik tanlash + redirect)
12. **§6** AI yuzalarini yashirish

*Chiqish mezoni:* har bir kerakli sahifaga navigatsiya orqali yetish mumkin;
o'lik yo'l qolmagan.

### Bosqich 4 — Dizaynni birxillashtirish

13. `/i/[token]` — invite sahifasi (birinchi taassurot)
14. `module-runtimes/*` — talaba eng ko'p ko'radigan joy
15. `messages/*`
16. `/groups`, `/dashboard/courses/*`

*Chiqish mezoni:* xom kulrang ishlatilishi sezilarli kamaygan; talaba va
o'qituvchining asosiy yo'llari bir xil ko'rinadi.

### Bosqich 5 — Tozalash

17. §5 o'lik kodni o'chirish (~5 000 satr)
18. §3.3 auth helper'larni birlashtirish
19. Asosiy yo'l uchun E2E test (Playwright): register → enroll → submit → grade

### MVP'dan keyin

- AI integratsiyasi (butun platforma bo'ylab)
- `timestamptz` migratsiyasi
- Admin sahifalari dizayni
- [02-arxitektura-va-kod-rejasi.md](02-arxitektura-va-kod-rejasi.md) dagi
  homework runtime backend qatlami va baho yaxlitligi

---

## 9. Ochiq savollar

| # | Savol | Nega muhim |
|---|---|---|
| Q1 | MVP'da to'lov (Payme) bormi yoki faqat bepul/invite oqimi? | Sinovda `POST /enrollment/requests` (to'lovsiz) ishladi. Agar MVP to'lovsiz bo'lsa — checkout oqimini yashirish kerak |
| Q2 | Jonli dars (LiveKit) MVP'gami? | Kod bor va ulangan, lekin sinalmagan. MVP'ga kirsa — alohida sinov kerak |
| Q3 | Dublikat oilalarda qaysi biri "haqiqiy"? (§3.2) | Men tavsiya berdim, lekin siz qaysi UI'ni yoqtirishingizni bilmayman |
| Q4 | Admin panel MVP'gami? | 10 sahifa, hammasi eski dizayn. Agar MVP'da kerak bo'lmasa — Bosqich 4 dan chiqariladi |
| Q5 | Mobil ilova MVP'gami? | `apps/mobile` (4 300 satr) bu rejaga kiritilmagan |

---

[← 03 Xavfsizlik rejasi](03-xavfsizlik-va-kontent-rejasi.md) ·
[00 Holat auditi](00-holat-auditi.md) ·
[README](README.md)
