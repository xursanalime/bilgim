# 06 — Eski dizayn inventari va migratsiya

> ✅ **BAJARILDI** — 2026-07-29.
>
> | | Oldin | Keyin |
> |---|---:|---:|
> | Yashil (`green`/`accent2`/`aurora`) | 247 | **0** |
> | Qorong'i mavzu tokenlari (`cream`/`ink-surface`/`white/[0.0x]`) | ~380 | **0** |
> | Havo rang (`blue`) | ~800 | **1250** |
> | O'chirilgan o'lik kod | — | **1 461 satr** |
> | Typecheck / testlar | — | 0 xato / 40 o'tdi |
> | Sahifalar (teacher + student + public) | — | **17/17 → 200** |
>
> 81 fayl, 458 satr o'zgartirildi. Quyidagi tahlil — o'sha ish uchun asos.

---

## Asosiy belgi: yashil vs havo rang

Eski dizaynning asosiy rangi — **yashil**, yangisiniki — **havo rang**.
`tailwind.config.ts` da ikkalasi ham bir xil yashilga ishora qiladi:

```ts
aurora:  { DEFAULT: '#34C759' }   // "Map old aurora to green" — eski primary
accent2: { DEFAULT: '#34C759' }   // xuddi shu yashil
blue:    { DEFAULT: '#0071E3' }   // joriy primary
```

Ya'ni **`aurora-*` yoki `accent2-*` ishlatgan komponent — eski avlodniki.**

Eng ishonchli filtr: *yashil bor, havo rang umuman yo'q*. Ikkalasi ham bor
bo'lsa, yashil odatda o'rinli ishlatilgan ("to'g'ri javob", "jonli efir") —
tegmaslik kerak.

| Komponent | Yashil | Havorang |
|---|---:|---:|
| `homework/homework-assignment-view.tsx` | 14 | **0** |
| `homework/teacher-grading-detail.tsx` | 10 | **0** |
| `homework/submission-editor.tsx` | 9 | **0** |
| `notifications/notification-inbox.tsx` | 8 | **0** |
| `homework/homework-submission-form.tsx` | 8 | **0** |
| `notifications/notification-filters.tsx` | 4 | **0** |
| `auth/forgot-password-form.tsx` | 3 | **0** |
| `auth/auth-layout.tsx` (o'lik) | 3 | **0** |

Bu ro'yxat quyidagi qorong'i-token tahlili bilan **aynan bir xil sahifalarga**
olib keladi — ikki mustaqil signal bir joyni ko'rsatmoqda.

---

## Muammo nima

Bu "biroz eskirgan rang" emas. Ekran rasmlarida ko'rinib turganidek, bu
**qorong'i mavzu uchun yozilgan komponentlar yorug' fonda** render bo'lyapti.

Eski avlod klasslari:

```
text-cream       text-cream-dim      bg-ink-surface     bg-ink-base
border-white/[0.06]   divide-white/[0.06]   bg-white/[0.04]   accent2-500
```

Yorug' fonda `text-cream` deyarli oq — **matn ko'rinmaydi**.
`border-white/[0.06]` — chegara yo'qoladi. Natija: `/homework/grading/...`
sahifasida javob maydoni bo'sh ko'rinadi, yorliqlar o'qilmaydi.

Joriy dizayn tizimi (sidebar, dashboard — to'g'ri ishlaydigan qism):

```
bg-base   bg-canvas   bg-tint   border-rim
text-ink-strong   text-ink-soft   text-ink-faint   bg-blue
```

---

## Javob: 12 ta sahifa, 21 ta komponent

Sahifalar tranzitiv bog'liqlik bo'yicha hisoblangan (komponent ichidagi
komponentlar ham). "Eski" ustuni — o'sha sahifa daraxtidagi eski token soni.

### 🔴 To'liq buzilgan — 100% eski (6 sahifa)

Bu sahifalarda **bitta ham** yangi dizayn tokeni yo'q.

| # | Sahifa | Eski | Asosiy komponent |
|---|---|---:|---|
| 1 | `/homework/grading/[submissionId]` | 185 | `teacher-grading-detail` (47) |
| 2 | `/homework/[assignmentId]/submissions/[submissionId]` | 185 | `teacher-grading-detail` (47) |
| 3 | `/homework/[assignmentId]` | 177 | `homework-assignment-view` (64) |
| 4 | `/homework/[assignmentId]/submit` | 158 | `homework-submission-form` (45) |
| 5 | `/submissions/[id]` | 155 | `submission-editor` (42) |
| 6 | `/notifications` | 33 | `notification-inbox` (33) |

> 1 va 2 — aynan siz yuborgan ekran rasmlaridagi sahifalar.
> 3, 4, 5 — talabaning uy vazifasi bilan ishlaydigan **butun yo'li**.

### 🟡 Qisman (6 sahifa)

| # | Sahifa | Eski | Sabab |
|---|---|---:|---|
| 7 | `/homework/new` | 153 (76%) | `ai-test-generator` (36) + runtime'lar |
| 8 | `/homework` | 4 (10%) | `submission-status-badge` |
| 9 | `/homework/grading` | 4 (11%) | `submission-status-badge` |
| 10 | `.../lessons/[lessonId]/edit` | 3 (9%) | `lesson-delete-button` |
| 11 | `.../groups/[groupId]/edit` | 3 (10%) | `group-delete-button` |
| 12 | `.../courses/[courseId]/edit` | 3 (12%) | `course-delete-button` |

---

## Komponentlar bo'yicha (21 ta jonli + 2 ta o'lik)

### Sahifa darajasidagi komponentlar (6)

| Komponent | Eski token |
|---|---:|
| `homework/homework-assignment-view.tsx` | 64 |
| `homework/teacher-grading-detail.tsx` | 47 |
| `homework/homework-submission-form.tsx` | 45 |
| `homework/submission-editor.tsx` | 42 |
| `notifications/notification-inbox.tsx` | 33 |
| `homework/assignment-builder.tsx` | 8 |

### Modul runtime'lari (7) — talaba eng ko'p vaqt o'tkazadigan joy

| Komponent | Eski token |
|---|---:|
| `module-runtimes/reading-runtime.tsx` | 29 |
| `module-runtimes/writing-runtime.tsx` | 19 |
| `module-runtimes/listening-runtime.tsx` | 16 |
| `module-runtimes/grammar-runtime.tsx` | 14 |
| `module-runtimes/vocabulary-runtime.tsx` | 11 |
| `module-runtimes/gap-fill-runtime.tsx` | 11 |
| `module-runtimes/speaking-runtime.tsx` | 9 |

Bular 5 ta sahifada takrorlanadi — shuning uchun **bitta tuzatish 5 sahifani
yaxshilaydi**. Eng yuqori foyda/xarajat.

### Kichik komponentlar (5)

`notification-filters` (10), `notification-item` (8),
`submission-status-badge` (4), `lesson-delete-button` (3),
`group-delete-button` (3), `course-delete-button` (3)

### AI komponentlari (2) — **migratsiya qilinmasin**

| Komponent | Eski token | Nima qilish kerak |
|---|---:|---|
| `ai/ai-test-generator.tsx` | 36 | `AI_ENABLED` flagi ortiga olish |
| `ai/ai-grading-panel.tsx` | 25 | `AI_ENABLED` flagi ortiga olish |

AI MVP'dan chiqarilgan, lekin bu ikkisi hali ham render bo'ladi —
`assignment-builder` va `teacher-grading-detail` ularni shartsiz import qiladi.
Flag qo'yilsa **61 ta eski token o'z-o'zidan yo'qoladi** va migratsiya hajmi
kamayadi.

### O'lik — o'chirilsin (2)

| Komponent | Eski token | Nega o'lik |
|---|---:|---|
| `marketing/live-showcase.tsx` | 37 | Landing `landing/live-showcase.tsx` dan foydalanadi |
| `auth/auth-layout.tsx` | 9 | Auth sahifalari `aurora-auth-layout.tsx` dan foydalanadi |

---

## Tavsiya etilgan tartib

**Bosqich A — bepul yutuq (kod yozmasdan 46 token yo'qoladi)**
1. `marketing/live-showcase.tsx` va `auth/auth-layout.tsx` — o'chirish
2. `ai-test-generator` + `ai-grading-panel` — `AI_ENABLED` flagi ortiga
   (yana 61 token MVP'dan chiqadi)

**Bosqich B — eng katta ta'sir (7 fayl → 5 sahifa)**
3. `module-runtimes/*` (7 ta) — 109 token. Talaba har kuni ko'radi.

**Bosqich C — sahifa qobiqlari**
4. `homework-assignment-view` (64)
5. `teacher-grading-detail` (47) — **siz yuborgan rasmdagi sahifa**
6. `homework-submission-form` (45)
7. `submission-editor` (42)
8. `notification-inbox` + `notification-filters` + `notification-item` (51)

**Bosqich D — kichik qoldiqlar**
9. `submission-status-badge`, 3 ta `*-delete-button`, `assignment-builder` (21)

---

## Token xaritasi (migratsiya uchun)

| Eski | Yangi | Izoh |
|---|---|---|
| `text-cream` | `text-ink-strong` | Asosiy matn |
| `text-cream-dim` | `text-ink-soft` | Ikkilamchi matn |
| `bg-ink-surface` | `bg-canvas` yoki `bg-tint` | Karta foni |
| `bg-ink-base` | `bg-base` | Sahifa foni |
| `border-white/[0.06]` | `border-rim` | Chegara |
| `divide-white/[0.06]` | `divide-rim` | Ro'yxat ajratgichi |
| `bg-white/[0.04]` | `bg-tint` | Hover / yumshoq fon |
| `accent2-500` | `text-blue` / `bg-blue` | Urg'u rangi |

`font-mono text-[11px] uppercase tracking-[0.18em]` yorliq uslubi ham eski
avlodniki — joriy dizaynda yorliqlar oddiy `text-xs font-medium text-ink-faint`.

---

[← 05 Bajarilgan ishlar](05-mvp-bajarilgan-ishlar.md) · [README](README.md)
