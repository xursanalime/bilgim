# Agent ishlari — xavfsizlik va arxitektura tuzatish sessiyasi

Bu fayl Claude Code tomonidan `apps/web` (Bilgim Next.js frontend) ustida
bajarilgan chuqur audit va tuzatish sessiyasining yozuvi. Git tarixida
`ad11fac` (boshlang'ich checkpoint) dan keyingi har bir commit shu yerda
tasvirlangan.

## Boshlanish nuqtasi

Loyihada avval `.git` umuman yo'q edi — birinchi ish sifatida git
ishga tushirilib, `ad11fac` checkpoint commit qilindi (xavfsizlik
to'ri sifatida, har bir keyingi o'zgarishni orqaga qaytarish imkoni
bo'lishi uchun).

Senior-darajadagi audit (xavfsizlik + arxitektura + texnologiya + a11y)
o'tkazilib, bitta **kritik** zaiflik va bir qancha arxitektura/sifat
kamchiliklari topildi. Foydalanuvchi so'rovi bo'yicha **i18n (375 fayl
bo'ylab tarjima)** ataylab bu sessiyadan chiqarib qo'yildi — bu eng katta
va alohida e'tibor talab qiladigan ish, keyingi sessiyaga qoldirilgan.

## Bajarilgan bosqichlar (commit tartibida)

### `df989f2` — Phase 1: Auth token saqlash zaifligi (KRITIK)

Eng jiddiy topilma: access/refresh JWT tokenlar JS orqali o'qiladigan
joyda (`document.cookie` + `localStorage`) saqlanar edi — istalgan XSS
30 kunlik sessiyani to'liq o'g'irlashi mumkin edi.

Sabab tekshirilganda yanada chuqurroq muammo chiqdi: backend (`apps/api`)
allaqachon `httpOnly` cookie o'rnatar edi, lekin:
1. `cookie-parser` middleware hech qachon ulanmagan edi — `req.cookies`
   doim `undefined` bo'lgan.
2. Ikkita frontend fayli (`lib/server-auth.ts`, `lib/auth-server.ts`)
   backend HAQIQATDA o'rnatgan nomdan (`access_token`) BOSHQA nom
   (`bilgim_access_token`) qidirgan — bu nom faqat frontend'ning o'z
   (endi o'chirilgan) JS cookie yozuvida mavjud edi.

**Tuzatish**: `cookie-parser` ulandi, `bilgim_session_hint` (nozik
bo'lmagan, faqat `{sub,email,role,publicId,exp}`) cookie qo'shildi
routing qarorlari uchun, frontend butunlay token saqlashni to'xtatdi
(`credentials: 'include'` orqali cookie avtomatik yuriladi),
`middleware.ts` qayta yozildi, `POST /auth/logout` endpointi qo'shildi
(chunki JS endi httpOnly cookie'ni o'chira olmaydi), cookie nom
nomuvofiqligi tuzatildi.

**Tasdiqlandi**: real login → httpOnly cookie → Authorization
header'siz autentifikatsiyalangan so'rov → refresh (token aylanishi) →
eski tokenni qayta ishlatish → `TOKEN_FAMILY_COMPROMISED` → logout —
barchasi curl orqali jonli serverda sinaldi.

### `5c0ff17` — Phase 2: CSP `unsafe-eval` olib tashlandi

Yagona `eval`ga o'xshash kod — `protected-video-player.tsx`dagi
`new Function(...)` (o'rnatilmagan `shaka-player` paketini webpack'dan
yashirish uchun) — `webpackIgnore` magic comment bilan almashtirildi.
CSP'dan `unsafe-eval` butunlay olib tashlandi.

### `2f04b2b` — Phase 3: Real hCaptcha, soxta captcha o'chirildi

`MathCaptcha` — javobni serverga umuman yubormas edi (soxta himoya).
Backend'da allaqachon moslashuvchan bot-aniqlash tizimi (`BotDetectionGuard`
+ `HCaptchaService`, login VA register uchun) bor ekan — faqat frontend
real widget ko'rsatmagan edi. `@hcaptcha/react-hcaptcha` ulandi, faqat
backend `403 CAPTCHA_REQUIRED` qaytarganda ko'rsatiladi.

### `863ea5a` — Phase 4: Parol siyosati + tozalash

`WEAK_PASSWORD` xato kodi frontendda bor edi, lekin backend hech qachon
uni tashlamas edi — 8 ta raqamli parol ("12345678") ham qabul qilinar
edi. Backend'da haqiqiy tekshiruv qo'shildi (harf + raqam), frontend
mos ravishda kuchaytirildi, ishlatilmagan `PasswordStrength` komponenti
(mavjud bo'lmagan rang tokenlaridan foydalangan — buzuq edi) tuzatilib
ulandi.

Yo'lda: `apps/api/bilgim/` — 103MB hajmdagi, GitHub bilan to'liq
sinxron, tasodifan qolib ketgan begona clone topilib (foydalanuvchi
tasdig'i bilan) o'chirildi — u test natijalarini chalkashtirib
yotgan edi.

### `ecd8d88` — Phase 5: O'lik `mediasoup-client` bog'liqligi olib tashlandi

LiveKit real ishlatiladigan WebRTC stack; mediasoup-client hech qayerda
import qilinmagan edi.

### `a8f3921` — Phase 6: API-client / data-fetching konsolidatsiyasi

6 ta homework komponenti SWR'dan React Query'ga o'tkazildi,
`lib/homework-api.ts` o'chirildi, `swr` va `zustand` (ishlatilmagan)
bog'liqliklari olib tashlandi. 3 ta chinakam "shim" fayl (discovery/dm/
notifications) haqiqiy implementatsiyaga birlashtirildi. `auth-api.ts`
vs `api/auth.ts` — ataylab har xil konventsiya ekani tasdiqlanib,
tegilmadi.

### `47ca4c4` — Phase 7+9+10: Error boundary, SEO, cookie consent

`app/global-error.tsx` + `app/[locale]/error.tsx` (avval umuman yo'q
edi), `app/sitemap.ts` + `app/robots.ts`, yetishmayotgan sahifalarga
`generateMetadata`, cookie consent banner.

### `6c3419a` — Phase 8+11+12: Sentry, accessibility, e2e

Sentry (`@sentry/nextjs`, DSN yo'q — infratuzilma tayyor, lekin faol
emas), AA-xavfsiz rang tokenlari (`*-strong` variantlar), 11 ta
komponentda takrorlangan reduced-motion kodi umumiy hook'ga
konsolidatsiya qilindi, `jest-axe` ixtiyoriy ravishda ulandi, Playwright
e2e skeleti qo'shildi (brauzer o'rnatish bu sandbox'da tasdiqlanmadi).

### `91415f5` — Sentry instrumentation.ts muammosi hujjatlashtirildi

`instrumentation.ts` migratsiyasi (Sentry'ning o'zi tavsiya qiladi)
`next dev`ni buzdi (`supports-color` ESM paket ziddiyati, OpenTelemetry
zanjiri orqali). Orqaga qaytarildi, sabab kodda izoh sifatida qoldirildi.

## Tekshiruv (har bir bosqichdan keyin qayta ishga tushirilgan)

- `tsc --noEmit` — ikkala paket (`@bilgim/web`, `@bilgim/api`) toza
- `jest` — 432/433 (yagona xato: `lesson-recordings.spec.tsx`, oldindan
  mavjud, flaky, hech qanday tuzatishga bog'liq emas)
- `next build` — to'liq muvaffaqiyatli
- Jonli smoke-test: login/refresh/logout/robots.txt/sitemap.xml/CSP —
  barchasi curl orqali ishlayotgan dev serverda tasdiqlandi

## Ataylab tegilmagan / keyingi ishlar

1. **i18n** — foydalanuvchi tanlovi bo'yicha butunlay o'tkazib
   yuborildi (375 fayl, faqat 63 kalit/2 fayl haqiqiy tarjima
   ishlatadi). Alohida sessiya talab qiladi.
2. **Sentry** — real DSN/hisob yo'q, hozircha faqat "tayyor holat".
3. **Playwright** — konfiguratsiya tayyor, lekin brauzer o'rnatish bu
   muhitda sinovdan o'tkazilmadi (internet yo'qligi sabab).
4. `tsconfig.tsbuildinfo` git'da hali ham tracked (build artefakti,
   kichik gigiyena masalasi).

## Umumiy baho o'zgarishi

| | Avval | Hozir |
|---|:---:|:---:|
| Kiberxavfsizlik | 4/10 | 8/10 |
| Arxitektura | 7/10 | 8/10 |
| Test/sifat | 6/10 | 7/10 |
| Accessibility | 7/10 | 8/10 |
| i18n | 4/10 | 4/10 (tegilmadi) |
| **Umumiy** | 6/10 | 7.5/10 |

---

## Ikkinchi sessiya — mahsulot g'oyasi, jamoa arxitekturasi va landing page audit'i

Bu sessiya kod audit'i emas, **g'oya va arxitektura darajasidagi** ish edi —
foydalanuvchi bilan Bilgim'ning konsepsiyasi chuqur muhokama qilindi, keyin
shu qarorlar asosida amaliy kod o'zgarishlari kiritildi.

### G'oya darajasidagi qarorlar

- Bilgim — gibrid model: **bilgim.uz marketplace** (talaba o'qituvchi
  qidiradi) + har bir o'qituvchiga **shaxsiy onlayn maktab** (GetCourse/
  Teachable uslubida whitelabel), differensiator sifatida joylashtirildi.
- **MVP qarori**: custom domen hozircha qilinmaydi — faqat bepul subdomain
  (`ustozismi.bilgim.uz`). Custom domen (DNS/SSL, multi-tenancy) MVP'dan
  keyingi bosqichga qoldirildi.
- Custom domen kelajakda ham faqat "peshtaxta" (sotish sahifasi) bo'lishi,
  haqiqiy o'qish tajribasi markaziy platformada qolishi kelishildi — cross-
  domain auth murakkabligidan qochish uchun.
- Sahifalar arxitekturasi GetCourse/Teachable/Kajabi/Thinkific va Preply/
  iTalki'ni tahlil qilib chiqib (WebSearch orqali) uch qatlamli qilib
  belgilandi: ommaviy marketplace, o'qituvchi subdomani, autentifikatsiya-
  langan ilova (talaba/o'qituvchi/admin panel).

### Miro board

`Bilgim — Arxitektura` nomli board yaratildi (https://miro.com/app/board/uXjVH6sFvYY=/),
ikkita diagram bilan: yuqori darajadagi arxitektura (8 katta bo'lim) va
jamoa tarkibi (AI agentlar tuzilmasi, guruhlangan).

### `.claude/agents/` — 14 ta AI-agent persona

Foydalanuvchi jamoani inson xodimlar emas, balki har biri o'z kasbining
eng zo'r ustasi bo'lgan **AI agentlar** orqali shakllantirishni tanladi.
Har biri uchun `.claude/agents/*.md` faylida to'liq system-prompt yozildi
(kim ekani, Bilgim konteksti, vazifalari, standartlari, chegaralari):
`cto-arxitektor`, `backend-muhandis`, `frontend-muhandis`, `ai-ml-muhandis`,
`devops-infra`, `product-dizayner`, `product-menejer`, `growth-marketing`,
`sales-hamkorlik`, `customer-support`, `legal-maslahatchi`,
`moliya-tahlilchi`, `trust-safety`, `community-manager`.

*Eslatma*: bu fayllar shu sessiyada yozilgani uchun sessiya davomida
subagent turi sifatida hali tanilmadi (Agent tool eski ro'yxatni ko'rsatdi
— `product-dizayner`/`growth-marketing` topilmadi); shuning uchun ularni
`general-purpose` agent orqali, persona faylini o'qib shu sifatda ishlashni
buyurib chaqirdik. Keyingi (yangi) sessiyada to'g'ridan-to'g'ri subagent
nomi bilan ishlashi kutilmoqda.

### Landing page audit va tuzatish

`product-dizayner` va `growth-marketing` personalari orqali `apps/web/
components/landing/` (15 komponent) tahlil qilindi. Ikkalasi mustaqil
ravishda bir xil **kritik topilma**ni chiqardi:

- `logos-strip.tsx` va `testimonials.tsx`da haqiqiy, tanish O'zbek ta'lim
  brendlari ("Najot Ta'lim", "Cambridge Learning", "IT Park Academy") va
  ismli "sharh"lar, soxta statistika ("10 000+ o'qituvchi", "40% samarali")
  — hech qanday shartnomasiz, loyiha hali Beta/mijozsiz bosqichida bo'la
  turib — ko'rsatilgan edi. Obro'/huquqiy xavf sifatida baholanib, zudlik
  bilan tuzatildi.

**Amalga oshirilgan o'zgarishlar** (hali commit qilinmagan):
- `logos-strip.tsx` — real brend nomlari olib tashlandi, honest niche/
  segment marquee'ga almashtirildi.
- `testimonials.tsx` — o'ylab topilgan ismli sharhlar butunlay olib
  tashlandi, o'rniga real (mavjud) funksiyalarga asoslangan "Beta dasturi"
  va'da kartochkalari yozildi (avatar/reyting/ism yo'q).
- `feature-showcase.tsx` — Live/AI/Homework tab'lari olib tashlandi
  (`features-bento.tsx` bilan takrorlanardi), faqat noyob ikkita xususiyat
  (Geymifikatsiya, Xabarlar) qoldirildi.
- Yangi komponentlar: `how-it-works.tsx` ("3 qadamda boshlang") va
  `comparison.tsx` ("Telegram+Zoom vs Bilgim" ochiq solishtiruv).
- `page.tsx` — bo'lim tartibi qayta qurildi (ForRoles Hero'dan darhol
  keyinga ko'chirildi), `Specialties` asosiy oqimdan chiqarildi (fayl
  o'zi kelajakdagi `/courses` sahifasi uchun saqlab qolindi).

**Tekshiruv**: `tsc --noEmit` toza o'tdi (apps/web). Allaqachon ishlayotgan
dev server (`localhost:3001`)dan HTML tortib tekshirildi — yangi bo'limlar
render bo'lyapti, soxta brend/ism izi qolmagan. Brauzer skrinshoti olinmadi
— bu sandbox'da Playwright/chromium binary internetsiz o'rnatilmagan
(birinchi sessiyada ham xuddi shu cheklov qayd etilgan).

### Keyingi ishlar (ochiq qolgan)

1. Ushbu landing page o'zgarishlarini ko'rib chiqib commit qilish.
2. `Specialties` komponenti uchun alohida `/courses` sahifasi qurish.
3. Kirish nuqtalari (marketplace + subdomain), Asosiy platforma xizmatlari
   va qolgan Miro bo'limlarini maydalashtirish davom etadi.
