# 00 — Loyihaning haqiqiy holati (kod auditi)

> **Metodologiya.** Bu hujjat `.kiro/specs/**` hujjatlariga emas, **faqat kodga** asoslanadi.
> Kiro spec'lari eskirgan: `tasks.md` da 31 ta task ham `[x]`, lekin design.md mediasoup
> haqida gapiradi — kod esa LiveKit'ga o'tgan; `gamification`, `group-chat`, `reports`,
> `ai-conversations`, multi-tenant subdomain kabi katta bo'laklar spec'da umuman yo'q.
> Har bir da'vo fayl havolasi bilan tasdiqlangan.
>
> Audit sanasi: 2026-07-29.

---

## 1. Bir qarashda

| O'lcham | Qiymat |
|---|---|
| Backend (NestJS) | ~146 700 satr, 675 fayl, 22 modul |
| Frontend (Next.js 14) | ~55 400 satr, 332 fayl, 80 route |
| Mobile (Expo) | ~4 300 satr |
| Prisma | 60 model, 16 enum, 20 migratsiya, 1282 satr |
| Backend testlar | 205 `.spec.ts` fayl |
| Frontend testlar | **2 ta fayl** |
| E2E testlar | **0 ta** |
| `tsc --noEmit` (api) | ✅ 0 xato |
| `tsc --noEmit` (web) | ✅ 0 xato |
| Git repository | ❌ **yo'q** |

**Xulosa:** bu prototip emas. Bu kech bosqichdagi, tipi toza, jiddiy platforma.
Asosiy xavf — *yozilmagan kod* emas, balki **tekshirilmagan chegara** (E2E yo'q,
frontend testsiz) va **bir nechta arxitektura assimetriyasi**.

---

## 2. Haqiqiy mahsulot nima ekan

Kiro spec'i buni "ikki tomonlama ta'lim platformasi" deb ta'riflaydi. Kod boshqa narsani
ko'rsatadi — va bu ancha kuchliroq g'oya:

**Har bir o'qituvchi o'zining onlayn maktabini oladi.**

[apps/web/lib/tenant.ts](../../apps/web/lib/tenant.ts) — `slug.bilgim.uz` subdomain'ini
o'qituvchi `publicSlug`'iga xaritalaydi. `www`, `api`, `app`, `admin`, `cdn`, `mail`,
`docs` rezerv qilingan. [apps/web/middleware.ts](../../apps/web/middleware.ts) (359 satr)
buni routing bilan bog'laydi.

Bu pozitsiyalashni tubdan o'zgartiradi:

- ❌ **Preply/italki emas** (marketplace, platforma o'qituvchini egallaydi)
- ✅ **Teachable/Kajabi + Google Classroom gibridi**, ingliz tili uchun ixtisoslashgan,
  O'zbekiston to'lov relslarida

O'qituvchi platformaning "ishchisi" emas — **mijozi**. U obuna to'laydi
(`Subscription`: TRIAL 14 kun → ACTIVE), talabalardan o'zi pul oladi
(`Invoice.kind = STUDENT_COURSE`). Bu marketplace'ning 20–33% take rate'idan butunlay
boshqa biznes model — va O'zbekiston bozori uchun ancha mos.

---

## 3. Modullar xaritasi (backend)

Kod satri bo'yicha, `.spec.ts` fayllarsiz:

| Modul | LOC | Test | Holat |
|---|---:|---:|---|
| `security` | 17 135 | 49 | 🟢 Chuqur ishlangan |
| `homework` | 5 834 | 11 | 🟡 Runtime bo'shlig'i (§5.1) |
| `ai` | 5 301 | 11 | 🟡 Xarajat nazorati yo'q (§5.3) |
| `live` | 4 706 | 12 | 🟡 Recorder adapter stub (§5.4) |
| `auth` | 4 660 | 8 | 🟢 |
| `notifications` | 2 878 | 7 | 🟡 Telegram bog'lanmagan (§5.5) |
| `media` | 2 824 | 8 | 🟢 |
| `admin` | 2 711 | **1** | 🔴 Testsiz |
| `catalog` | 2 454 | 5 | 🟢 |
| `billing` | 2 418 | 10 | 🟢 |
| `teacher` | 2 405 | 3 | 🟡 |
| `mfa` | 1 743 | 3 | 🟡 |
| `reports` | 1 644 | 4 | 🟢 |
| `dm` | 1 529 | 5 | 🟢 |
| `gamification` | 1 349 | **0** | 🔴 Testsiz |
| `group-chat` | 1 332 | 1 | 🟡 |
| `threat-protection` | 1 216 | 3 | 🟢 |
| `enrollment` | 1 187 | 1 | 🔴 Kam test (pul yo'lida!) |
| `discovery` | 979 | 5 | 🟢 |
| `schedule` | 838 | 5 | 🟢 |
| `users` | 175 | 1 | 🟢 |
| `live-stream` | 118 | **0** | ⚠️ `live` bilan dublikat? |

### Spec'da yo'q, kodda bor

`gamification` (XP, badge, streak, daily challenge, leaderboard, reward shop —
10 Prisma modeli), `group-chat`, `reports` (CSV stream + moliyaviy hisobot),
`ai/conversations` (AI chat tarixi), `mfa` (alohida modul), `threat-protection`,
`users`, multi-tenant subdomain routing.

Bu Kiro'dan keyingi o'sish — spec'ga ishonmaslik kerakligining isboti.

---

## 4. Kuchli tomonlar (saqlash kerak)

**4.1. Xavfsizlik arxitekturasi haqiqiy.**
`security/kms/` port/adapter naqshi bilan yozilgan: [kms.port.ts](../../apps/api/src/modules/security/kms/kms.port.ts)
interfeys, `LocalKmsProvider` (Postgres) va `VaultKmsProvider` (HashiCorp Vault Transit)
implementatsiyalari, `reencrypt.processor.ts` zero-downtime kalit rotatsiyasi uchun.
Bu "xavfsizlik teatri" emas — to'g'ri muhandislik.

Shuningdek real: `brute-force` (823 satr, bosqichma-bosqich lockout),
`impossible-travel` (665 satr, Haversine + GeoIP), `waf.middleware`,
`audit-trail` (hash chaining), `gdpr` (crypto-shredding), `siem/correlation.engine`.

**4.2. Ma'lumot yaxlitligi jiddiy qabul qilingan.**
Outbox pattern (`infra/outbox/`), `IdempotencyRecord`, partial unique indekslar,
`enforce_specialty_module_cap()` DB trigger'i, `@@unique([assignmentId, studentId])`.
To'lov → enrollment yo'li bitta tranzaksiyada.

**4.3. Tip xavfsizligi.** Ikkala app ham `tsc --noEmit` dan 0 xato bilan o'tadi —
200k+ satr uchun bu kamdan-kam hol.

**4.4. Testlar mazmunli.** 205 spec fayli orasida `fast-check` property testlari bor
(enrollment invariant, idempotency, brute-force lockout, encryption round-trip).
Bu misol-testlardan kuchliroq.

---

## 5. Aniqlangan bo'shliqlar

### 5.1. 🔴 Homework runtime assimetriyasi — eng jiddiy mahsulot+xavfsizlik nuqsoni

Frontend'da **7 ta** modul runtime bor:
`reading`, `writing`, `speaking`, `listening`, `grammar`, `vocabulary`, `gap-fill`
([components/homework/module-runtimes/](../../apps/web/components/homework/module-runtimes/)).

Backend'da **2 ta**:

```ts
// apps/api/src/modules/homework/runtimes/registry.ts:36-37
this.register(writingRuntime);
this.register(readingRuntime);
```

`registry.get()` boshqa hamma tur uchun `null` qaytaradi, va kod izohi buni ochiq aytadi:

> *"Module types without a registered runtime return `null` … The AssignmentService and
> SubmissionService treat that as 'validate as opaque JSON for forward-compat'"*

**Oqibati:** SPEAKING, LISTENING, GRAMMAR, VOCABULARY, GAP_FILL, MULTIPLE_CHOICE,
MATCHING, DRAG_DROP javoblari **server tomonda umuman validatsiya qilinmaydi**.
`Submission.answersJson` — tekshirilmagan `Json` ustuni.

### 5.2. 🔴 Speaking bahosi mijoz tomonda hisoblanadi

[speaking-runtime.tsx](../../apps/web/components/homework/module-runtimes/speaking-runtime.tsx)
brauzerning `webkitSpeechRecognition` API'sidan foydalanadi, `calcScore()` bilan
so'zlarni solishtiradi va **`score`ni javob JSON'iga yozib yuboradi**.

Uchta alohida muammo:

1. **Xavfsizlik:** talaba shunchaki `{"attempts":[{"score":100}]}` POST qila oladi.
   §5.1 sababli backend buni tekshirmaydi. Baho butunlay soxtalashtiriladi.
2. **Mahsulot:** Web Speech API — *talaffuz baholash* emas, u shunchaki nutqni matnga
   o'giradi. Fonema darajasidagi aniqlik, ravonlik, urg'u — hech biri yo'q.
   Faqat Chrome'da ishlaydi, internet talab qiladi.
3. **Maxfiylik:** `webkitSpeechRecognition` talaba ovozini **Google serverlariga**
   yuboradi. Hech qanday oshkor qilish yoki rozilik yo'q. Bolalar ovozi uchun bu
   jiddiy huquqiy risk.

### 5.3. 🟡 AI xarajat nazorati — optimizatsiya richaglari ishlatilmagan

`AiCall` jadvali har chaqiruvni audit qiladi, `cost-calculator.ts` narxni hisoblaydi.
Lekin:

```
grep -rn "cache_control|ephemeral|batches" apps/api/src/modules/ai/  → 0 natija
```

**Prompt caching yo'q. Batch API yo'q.** Tadqiqot ko'rsatishicha bu ikkisi birga
xarajatni ~90–95% gacha kamaytiradi (§ tadqiqot hisoboti). Pre-launch bosqichda
bu tuzatish arzon; 10 000 talabada bu oyiga minglab dollar farq.

Shuningdek `ai.constants.ts` da kunlik budjet chegarasi topilmadi — Req 26.7
"AI daily budget alert" talab qiladi, lekin implementatsiya ko'rinmadi.

### 5.4. 🟡 Live recording adapter stub

[mediasoup-recorder.adapter.ts](../../apps/api/src/modules/live/recording/mediasoup-recorder.adapter.ts):

```
// TODO(live-recording): replace with real mediasoup PlainTransport
// TODO(live-recording): drive the real ffmpeg flush + R2 upload.
```

Yonida `livekit-egress-recorder.adapter.ts` bor — ya'ni migratsiya boshlangan lekin
eski adapter qolib ketgan. Qaysi biri ishlatilayotganini aniqlashtirish kerak.
`live-stream` moduli (118 satr, 0 test) ham `live` (4706 satr) bilan dublikat bo'lishi mumkin.

### 5.5. 🟡 Telegram kanali ishlamaydi

[telegram.processor.ts](../../apps/api/src/modules/notifications/workers/telegram.processor.ts):

```
// TODO (Phase 5): once the bot /start handler binds a `telegramChatId`
Telegram job ${job.id}: TODO: resolve user's chat id → marking FAILED
```

`TELEGRAM_BOT_TOKEN` `.env` da bor, lekin `chatId` binding yo'q — barcha Telegram
xabarnomalar FAILED bo'ladi. O'zbekistonda Telegram — asosiy kanal, bu MVP uchun muhim.

### 5.6. 🟡 Account recovery yarim

[account-recovery.service.ts:404,433](../../apps/api/src/modules/security/password/account-recovery.service.ts):
`storeVerificationCode` va `verifyCode` — `not implemented` deb throw qiladi.
Test fayli buni ataylab kutadi (`const NOT_IMPLEMENTED = /not implemented/i`) —
ya'ni bu ongli ravishda qoldirilgan bo'shliq, yashirin bug emas.

### 5.7. 🔴 Test qamrovi nomutanosib

- **E2E: 0 ta.** `test:e2e` skripti bor, `*.e2e-spec.ts` fayli yo'q. Ya'ni
  ro'yxatdan o'tish → to'lov → enrollment → dars ko'rish zanjiri **hech qachon
  uchidan-uchiga tekshirilmagan**.
- **Frontend: 2 ta test** / 332 fayl. 8215 satrlik homework UI, 1176 satrlik
  assignment-builder — testsiz.
- **`enrollment`: 1 ta test** — bu pul kirib keladigan yo'l.
- **`gamification`: 0 ta test** — XP/badge/reward iqtisodiyoti manipulyatsiyaga ochiq.
- **`admin`: 1 ta test** — 2711 satr, eng yuqori imtiyozli modul.

### 5.8. 🔴 Git yo'q

Loyiha git repository emas. 200k+ satr kod versiya nazoratisiz. Bu eng oson
tuzatiladigan va eng katta yo'qotish riski.

### 5.9. 🟡 Bitta test buzilgan (trivial)

`submission.service.spec.ts:1494` — test `threshold: 0.7` kutadi, kod `0.75` yuboradi.
Talab 13.8 aynan `>= 0.75` deydi, ya'ni **kod to'g'ri, test eskirgan**.
`jest_output.txt` boshqa mashinadan (`/home/xursanalime/Desktop/bilgimAI (Copy)`),
ya'ni eski artefakt.

### 5.10. 🟡 `.env` repoda

`.env` fayli (8581 bayt) real kalitlar bilan loyiha ildizida turibdi:
`ANTHROPIC_API_KEY`, `PAYME_KEY`, `JWT_SECRET`, `MASTER_ENCRYPTION_KEY`,
`LIVEKIT_API_SECRET`, `R2_SECRET_ACCESS_KEY`, `TELEGRAM_BOT_TOKEN`, `SMTP_PASS`.

✅ **Tekshirildi:** `.gitignore` to'g'ri yozilgan — `.env` va `infra/local/` ignore
qilingan. Ya'ni `git init` kalitlarni tarixga yozmaydi.

⚠️ **Lekin kalitlar baribir rotatsiya qilinishi kerak:** ular uzoq vaqt himoyalanmagan
fayl tizimida turgan va loyiha nusxalari orasida tarqalgan — `jest_output.txt` ichida
`/home/xursanalime/Desktop/bilgimAI (Copy)` yo'li ko'rinadi, ya'ni kamida bitta boshqa
nusxa mavjud bo'lgan.

Kichik tuzatish: `jest_output.txt` `.gitignore` ga tushmaydi (`*.log` naqshiga mos emas) —
qo'shilsin yoki o'chirilsin.

---

## 6. Prioritetlangan xulosa

**P0 — launch'dan oldin majburiy**

| # | Ish | Sabab |
|---|---|---|
| 1 | Git init (+ `.gitignore` audit, kalitlarni rotatsiya) | §5.8, §5.10 |
| 2 | Homework runtime'larni backendga to'ldirish | §5.1 — baho soxtalashtirish |
| 3 | Speaking'ni server tomonga ko'chirish | §5.2 — baho + maxfiylik |
| 4 | E2E: register→pay→enroll→lesson zanjiri | §5.7 — pul yo'li tekshirilmagan |
| 5 | Telegram chatId binding | §5.5 — asosiy kanal |

**P1 — launch'dan keyin tez**

| # | Ish | Sabab |
|---|---|---|
| 6 | Prompt caching + batch API | §5.3 — marja |
| 7 | AI kunlik budjet + alert | §5.3 |
| 8 | `enrollment`, `admin`, `gamification` testlari | §5.7 |
| 9 | Live recorder adapterni aniqlashtirish | §5.4 |
| 10 | Account recovery yakunlash | §5.6 |

**P2 — barqarorlashtirish**

Frontend test qamrovi, `live-stream` vs `live` dublikatini hal qilish,
Kiro spec'larini arxivga ko'chirish (chalg'itmasligi uchun).

---

**Keyingi hujjatlar:**
[01 — Tadqiqot hisoboti](01-tadqiqot-hisoboti.md) ·
[02 — Arxitektura va kod rejasi](02-arxitektura-va-kod-rejasi.md) ·
[03 — Xavfsizlik va kontent rejasi](03-xavfsizlik-va-kontent-rejasi.md)
