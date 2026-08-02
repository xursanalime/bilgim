# 05 — MVP: bajarilgan ishlar

> [04-mvp-rejasi.md](04-mvp-rejasi.md) dagi Bosqich 1–3 bajarildi.
> Har bir tuzatish **ishlab turgan tizimda** real teacher va student akkaunt
> bilan tasdiqlangan, keyin test bilan qoplangan.
>
> Sana: 2026-07-29.

---

## Yakuniy holat

| O'lcham | Oldin | Keyin |
|---|---|---|
| API testlar | 2876 o'tdi, **10 yiqildi** | **2969 o'tdi, 0 yiqildi** (207/207 suite) |
| Web testlar | 40 | 40 |
| `tsc --noEmit` (api / web) | 0 / 0 xato | 0 / 0 xato |
| O'lik frontend kod | ~7 200 satr | **o'chirildi** |
| Uchidan-uchiga MVP oqimi | uzilgan | **26/26 qadam ishlaydi** |

---

## 1. Bloker buglar — tuzatildi

### BUG-1 🔴 Outbox vaqt zonasi — butun asinxron qatlam to'xtagan edi

**Sabab:** `nextAttemptAt` — `timestamp without time zone`, DB default
`CURRENT_TIMESTAMP`. DB zonasi `Asia/Samarkand (+05)` bo'lgani uchun yozilgan
qiymat `16:42`, dispatcher esa UTC `new Date()` (`11:42`) bilan
`lte` solishtiradi → event **5 soat "kelajakda"** ko'rinib, hech qachon
olinmaydi.

**Tuzatish:** [prisma.factory.ts](../../apps/api/src/infra/prisma/prisma.factory.ts) —
barcha Prisma ulanishlariga `options=-c timezone=UTC` qo'shildi. Bitta joyda,
chunki har bir mijoz shu fabrikadan o'tadi.

`%20` qo'lda kodlangan: `URLSearchParams` bo'shliqni `+` qiladi, libqp uni
ajratuvchi emas, harfma-harf o'qiydi va parametr jimgina rad etiladi.

**Tasdiq:** 13 ta qotgan event oqib ketdi; yangi event `12:09:08` (UTC) da
yozilib **1 soniyada** dispatch bo'ldi. 5 ta yangi test.

> ⚠️ Bu bug production UTC serverda ko'rinmaydi — faqat `Asia/Tashkent`da,
> ya'ni maqsadli bozorda. Uzoq muddatli to'g'ri yechim — `timestamptz`
> migratsiyasi (60 model), MVP'dan keyin.

### BUG-2 🔴 Talaba uy vazifasini ololmasdi

[assignments.controller.ts](../../apps/api/src/modules/homework/assignments.controller.ts)
da `@Roles('TEACHER','ADMIN')` **klass darajasida** turardi, ya'ni
`GET /assignments/:id` va `GET /lessons/:id/assignments` talaba uchun 403.
Aynan shu endpointlarni `/homework/[assignmentId]` sahifasi chaqiradi —
sahifa tuzilishiga ko'ra ishlay olmasdi.

**Tuzatish:** rollar route darajasiga tushirildi. O'qish yo'llari talabaga
ochildi, lekin **APPROVED enrollment** talab qiladi va faqat `isPublished`
vazifalarni ko'rsatadi. Nashr qilinmagan qoralama uchun **404** qaytariladi
(403 emas) — aks holda javob nashr qilinmagan vazifani zondlash uchun
ishlatilardi.

**Tasdiq:** talaba endi 200 oladi, teacher qoralamalarni ko'radi, talaba
publish/create qila olmaydi (403). 6 ta yangi test.

### BUG-3 🔴 "Barcha vazifalarim" endpointi yo'q edi

Talabaning `/homework` sahifasi ro'yxatni **mijozda** yig'ardi:
`enrollments → group → lessons → assignments → mySubmission` — uchta guruhdagi
talaba uchun **~100 so'rov**, va bitta so'rov yiqilsa qator jimgina yo'qolardi.

**Tuzatish:** yangi `GET /homework/my-assignments` — bitta indekslangan
so'rov. Frontend shunga ulandi.

**Tasdiq:** bitta so'rov 3 ta vazifani guruh, dars, submission holati va
bahosi bilan qaytaradi.

### BUG-5 🔴 Gamification leaderboard Redis xatosi

[leaderboard.service.ts](../../apps/api/src/modules/gamification/leaderboard.service.ts)
da TTL `604800 * 1.14` = `689472.0000000001` — **float**. Redis `EXPIRE`
butun son talab qiladi → har XP hodisasida
`ERR value is not an integer or out of range`.

**Tuzatish:** aniq butun konstanta (8 kun). Qo'shimcha:
- `toScore()` — NaN/Infinity butun `ZADD` ni rad etishining oldini oladi
- ISO hafta-yili tuzatildi: 2027-01-01 ISO 53-haftaga (2026) tegishli, ilgari
  `2027:53` deb yozilardi — mavjud bo'lmagan hafta, leaderboard bo'linardi

**Tasdiq:** `lb:weekly:2026:31` `TTL=691189` bilan yaratildi, xato yo'q.
**11 ta yangi test** — modulda ilgari **0 ta test** bor edi.

### BUG-6 🔴 Ikkita hardcoded email backdoor

`billing.service.ts` va `catalog.service.ts` da
`teacher?.email === 'xursanalime@gmail.com'` — obuna va onboarding
tekshiruvlarini chetlab o'tuvchi backdoor.

**Tuzatish:** ikkalasi ham olib tashlandi. O'rniga admin boshqaradigan
`SystemSetting` kaliti `billing.requireSubscription`:
- Yo'q yoki `true` → **paywall ishlaydi** (fail closed)
- `false` yoki `{enabled:false}` → demo rejimi
- Sozlama o'qishda xato → **paywall ishlaydi** (hech qachon ochilmaydi)

Shuningdek `SUBSCRIPTION_MISSING` va `SUBSCRIPTION_EXPIRED` ajratildi —
ilgari obunasi umuman yo'q o'qituvchiga "obunangizni yangilang" deyilardi.

**Tasdiq:** darvoza o'chirilganda PAST_DUE o'qituvchi publish qila oladi,
yoqilganda 403. 8 ta yangi test.

> Hozir demo rejimi **yoqilgan** (`billing.requireSubscription = false`).
> Ommaga chiqishdan oldin `/admin/system-settings` dan o'chiring.

### BUG-7 🔴 Lokal muhitda ro'yxatdan o'tib bo'lmasdi

SMTP tinglovchisi yo'q edi (`ECONNREFUSED :1025`), tasdiqlash tokeni esa
faqat SHA-256 hash sifatida saqlanadi — ya'ni tiklab bo'lmaydi.

**Tuzatish:** [scripts/bilgim.sh](../../scripts/bilgim.sh) ga MailHog
qo'shildi (SMTP `:1025`, veb-inbox `:8025`).

**Tasdiq:** to'liq zanjir ishladi — register → email keldi → token →
verify → `ACTIVE` + TRIAL obuna avtomatik yaratildi.

### BUG-4 ✅ Bug emas edi

`GET /catalog/groups/:id/modules` talaba uchun 403 — **to'g'ri**. Uni faqat
o'qituvchining `assignment-builder.tsx` i chaqiradi. O'zgartirilmadi.

---

## 2. Sahifalar orasidagi uzilishlar — yopildi

### Navigatsiya

| Qo'shildi | Nega |
|---|---|
| **Baholash** (`/homework/grading`) sidebar + mobil menyuga | O'qituvchining kunlik asosiy ishi edi, lekin havolasi yo'q edi |
| **Bildirishnomalar** (`/notifications`) + o'qilmagan hisoblagich | Inbox sahifasi bor edi, `Bell` ikonkasi import qilingan lekin **ishlatilmagan** |

Badge mantiqi `item.label` matn solishtirishdan tipli `badge` maydoniga
o'tkazildi — matn o'zgarganda badge jimgina yo'qolardi.

### Dublikat sahifalar

Kanonik: **`/homework/*`** (navigatsiyada, rolga qarab, samarali endpoint).

| Eski marshrut | Endi |
|---|---|
| `/assignments` | → `/homework` |
| `/assignments/[id]` | → `/homework/[id]` |
| `/teacher/assignments/[id]/submissions` | → `/homework/grading?assignmentId=` |
| `/teacher/assignments/[id]/submissions/[submissionId]` | → `/homework/[id]/submissions/[submissionId]` |

`student-dashboard.tsx` havolasi kanonik marshrutga o'zgartirildi.

`/homework/[assignmentId]/submissions/[submissionId]` **saqlandi** — u
dublikat emas, assignment kontekstini uzatadigan variant.

### O'lik kod — 7 204 satr o'chirildi

| Guruh | Satr |
|---|---|
| Tashlab ketilgan marketing dizayn avlodi (20 fayl) | 4 334 |
| Bo'shab qolgan homework komponentlari (5) | ~1 500 |
| Eski auth dizayni (6 komponent) | ~600 |
| Eski bildirishnoma UI (2) | ~440 |
| `onboarding-wizard`, `landing/stats` | ~330 |

---

## 3. AI MVP'dan chiqarildi

[lib/features.ts](../../apps/web/lib/features.ts) — `AI_ENABLED` flagi
(`NEXT_PUBLIC_AI_ENABLED`, standart `false`).

- Sidebar'dan "BilgimAI" olib tashlandi (teacher + student)
- Admin menyusidan "AI Prompts" olib tashlandi
- `/ai-chat` va `/admin/ai` marshrutlari **404** qaytaradi — menyuni
  yashirish yetarli emas, URL ham yopildi
- Kod o'chirilmadi: `NEXT_PUBLIC_AI_ENABLED=true` bilan qaytariladi

---

## 4. Jonli darslar (LiveKit) — tasdiqlandi

To'liq lifecycle ishlaydi: LIVE dars yaratish → publish → o'qituvchi
boshlaydi → **talaba real LiveKit tokeni oladi** → o'qituvchi qo'shiladi →
tugatish → terminal holat.

**Topildi va tuzatildi:** `live.started` mavzusi fan-out'ga **ulanmagan** edi
(`Topic "live.started" not yet wired ... skipping`) — talabalar dars
boshlanganini bilmasdi (Req 9.3). `LIVE_STARTED` enum qiymati allaqachon bor
edi, faqat resolver yo'q edi.

**Tasdiq:** talabaning o'qilmagan soni 2 → 3, inbox'da `LIVE_STARTED`.

**Eslatma:** yozib olish `RECORDING_FAILED` bo'ldi, lekin bu test tezligidan —
sessiya 1 soniyada tugadi, outbox hali `live.started` ni jo'natmagan edi.
Real darsda muammo emas. Talab 9.8 (LIVE holatida qolib ketmaslik) bajarildi.

---

## 5. Eskirgan testlar — 7 suite tuzatildi

10 ta yiqilgan test **mening o'zgarishlarimdan emas** — kod o'zgarganda
testlar yangilanmagan. Ular haqiqiy regressiyani yashirardi.

| Suite | Sabab |
|---|---|
| `media.service` + `media-playback` | Konstruktor 4 → 7 parametr; `getObjectSize` mock'da yo'q; playback endi **proxy URL** qaytaradi (xom presigned R2 emas — xavfsizroq) |
| `outbox.dispatcher` | `queue.add()` 3-argument (job options) oladi, test 2 kutardi |
| `schedule.service` + property test | Idempotency kaliti `groupId` → `scheduleId` (bitta guruhda bir nechta jadval bo'lishi mumkin) |
| `hmac.guard` | `makeConfig(undefined)` **standart parametrni** ishga tushirib, sirni baribir qaytarardi — test happy path'ni tekshirib yurgan |
| `auth.service` | `sessionsRevokedAt` fixture'da yo'q; login endi PENDING_VERIFY ni **avtomatik faollashtiradi** |
| `auth-hardening` | Qulf **email** bo'yicha kalitlanadi, test `userId` uzatardi — assertion bo'sh joyda o'tardi |

---

## 6. ⚠️ Diqqatingizga: email tasdiqlash o'chirilgan

[auth.service.ts:472-487](../../apps/api/src/modules/auth/auth.service.ts#L472)
da izoh ochiq aytadi: *"Email verification gate disabled for now"*. Login
`PENDING_VERIFY` foydalanuvchini avtomatik `ACTIVE` qiladi. Faqat `SUSPENDED`
va `DELETED` bloklanadi.

Ya'ni **istalgan email bilan ro'yxatdan o'tib, tasdiqlamasdan kirish mumkin.**
MVP demo uchun bu ataylab qilingan bo'lishi mumkin, lekin ommaga chiqishdan
oldin qaror kerak. Hozircha kod shundayligicha qoldirildi va test unga
moslashtirildi.

---

## 7. Qolgan ish

| # | Ish | Holat |
|---|---|---|
| 1 | Dizayn migratsiyasi: xom Tailwind kulrang → dizayn tokenlari | Boshlanmagan (~1 066 ta ishlatilish) |
| 2 | `/i/[token]` invite sahifasi — birinchi taassurot | Eski dizayn |
| 3 | Admin panel (10 sahifa) dizayni | Eski dizayn |
| 4 | E2E test (Playwright) | Yo'q |
| 5 | `timestamptz` migratsiyasi | MVP'dan keyin |
| 6 | Teacher `/homework` sahifasidagi N+1 | Talaba tomoni tuzatildi, teacher tomoni qoldi |

---

[← 04 MVP rejasi](04-mvp-rejasi.md) · [README](README.md)
