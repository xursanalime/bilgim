# Bilgim — loyihani yakunlash rejasi

Ushbu papka loyihaning **joriy holati** va **yakunlash rejasi**ni saqlaydi.
Tuzilgan sana: 2026-07-29.

## ⚠️ Muhim: `.kiro/specs/` ga ishonmang

`.kiro/specs/edubridge-platform/` — loyihaning 2026-yil boshidagi original Kiro
rejasi. Loyiha undan **ancha o'zib ketgan**:

- `tasks.md` da 31 ta task ham `[x]` — lekin bu tugallanganlikni bildirmaydi
- `design.md` mediasoup haqida gapiradi — kod LiveKit'ga o'tgan
- `gamification`, `group-chat`, `reports`, `ai-conversations`, multi-tenant
  subdomain — hech biri spec'da yo'q, lekin kodda bor

**Joriy haqiqat uchun quyidagi hujjatlarni o'qing.** Ular faqat kodga asoslangan.

## Hujjatlar

| # | Hujjat | Mazmuni |
|---|---|---|
| 00 | [Holat auditi](00-holat-auditi.md) | Kodga asoslangan haqiqiy holat: nima tayyor, nima yo'q, qayerda teshik bor |
| 01 | [Tadqiqot hisoboti](01-tadqiqot-hisoboti.md) | Raqobatchilar, AI unit economics, O'zbekiston bozori va qonuni, B2B |
| 02 | [Arxitektura va kod rejasi](02-arxitektura-va-kod-rejasi.md) | Maqsadli arxitektura, yoziladigan kod, bosqichlar |
| 03 | [Xavfsizlik va kontent rejasi](03-xavfsizlik-va-kontent-rejasi.md) | Platforma xavfsizligi, materiallar himoyasi, kontent xavfsizligi |
| **04** | **[MVP rejasi](04-mvp-rejasi.md)** | **Real sinovga asoslangan: 7 ta bloker bug, orphan/dublikat sahifalar, eski dizayn, bajarish tartibi** |
| **05** | **[MVP: bajarilgan ishlar](05-mvp-bajarilgan-ishlar.md)** | **Nima tuzatildi, qanday tasdiqlandi, nima qoldi**|

> **04 — hozirgi ish rejasi.** U ishlab turgan tizimda real teacher va student
> akkaunt bilan sinab ko'rilgan natijalarga asoslanadi. AI MVP'dan chiqarilgan.

## Eng muhim uchta xulosa

**1. Loyiha o'ylanganidan ancha tayyor.**
~200k satr, ikkala app ham `tsc --noEmit` dan 0 xato bilan o'tadi, 205 backend
test fayli, 60 Prisma modeli. Bu prototip emas.

**2. Mahsulot aslida boshqa narsa.**
Kod `slug.bilgim.uz` multi-tenant routingni ko'rsatadi — ya'ni **har o'qituvchiga
o'z onlayn maktabi**. Bu Preply/italki (marketplace, 21–33% komissiya) emas, balki
Teachable + Google Classroom gibridi, ingliz tili uchun ixtisoslashgan. Bu
pozitsiyalash va marketing xabarining o'zagi.

**3. Asosiy xavf — yozilmagan kod emas, ulanmagan chegara.**
Eng jiddiy uchta bo'shliq:
- Homework: frontend'da 7 runtime, backendda 2 → **baho mijozda hisoblanadi va
  soxtalashtirilishi mumkin**
- E2E testlar **0 ta** → to'lov va enrollment zanjiri hech qachon tekshirilmagan
- **Git repository yo'q** → 200k satr versiya nazoratisiz

## Birinchi qadamlar (tartib muhim)

1. `.gitignore` ni tekshirish → `git init` → sirlarni rotatsiya qilish
   ([02 §3.1](02-arxitektura-va-kod-rejasi.md#31-git-va-sirlar))
2. Homework runtime qatlamini yakunlash
   ([02 §4](02-arxitektura-va-kod-rejasi.md#4-ish-oqimi-1--homework-runtime-qatlamini-yakunlash))
3. E2E: pul yo'li (register → pay → enroll → lesson)
   ([02 §10.1](02-arxitektura-va-kod-rejasi.md#101-e2e--0-dan-boshlanadi))

## Javob kutilayotgan savollar

| # | Savol | Kimga | Nimani bloklaydi |
|---|---|---|---|
| Q1 | Ovoz yozuvi O'zbekiston qonunida biometrik ma'lumotmi? | Yurist | Talaffuz moduli arxitekturasi |
| Q2 | Talabalarning yosh taqsimoti? Voyaga yetmaganlar ulushi? | Mahsulot | Butun kontent xavfsizligi rejasi |
| Q3 | `live-stream` moduli `live` bilan dublikatmi? | Kod egasi | Live modulini yakunlash |
| Q4 | O'qituvchi obunasining narxi? | Biznes | AI budjet shifti |
| Q5 | Click/Uzum qo'shish rejada bormi? | Biznes | Billing abstraksiyasi |
