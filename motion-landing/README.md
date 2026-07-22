# Bilgim — Motion Video Landing Page

Bu papka asosiy loyihadan **butunlay mustaqil**: hech qanday build, dependency yoki mavjud kodga o'zgartirish talab qilmaydi. `index.html` faylini brauzerda ochish kifoya.

## Video fonlar (Higgsfield)

Barcha fon videolari Higgsfield'da quyidagi sozlamalar bilan generatsiya qilingan
(**Unlimited mode**, 8s, 720p, audio on):

| Bo'lim | Model | Format | Video |
|---|---|---|---|
| Hero | Seedance 2.0 | 16:9 | Binafsha nur ustuni (razor-sharp pillar) |
| Jonli darslar (telefon) | Kling 3.0 | 9:16 | Vertikal nur ustuni |
| AI bo'limi | Seedance 2.0 | 16:9 | Abstrakt nur (v1) |
| Yakuniy CTA | Seedance 2.0 | 16:9 | Abstrakt nur (v2) |

Videolar Higgsfield CDN (CloudFront) orqali to'g'ridan-to'g'ri yuklanadi.
Agar ularni lokal saqlamoqchi bo'lsangiz, `index.html` ichidagi `<video src="...">`
manzillarini yuklab olib, lokal yo'lga almashtiring.

## Dizayn

- Palitra: `#0A0A0F` (deep void) + `#6C63FF` (violet) — videolardagi rangga mos
- Sarlavha: "Ta'limning yangi yorug'ligi" — nur ustuni kontseptsiyasi bilan bog'langan
- Motion: scroll-reveal, parallax hero, cursor spotlight, marquee, animatsion hisoblagichlar,
  FAQ akkordeon, hero'da ovoz yoqish tugmasi
- `prefers-reduced-motion` hurmat qilinadi; ekrandan tashqaridagi videolar pauza qilinadi
