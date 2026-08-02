# EduBridge Web — To'liq Dizayn Rejasi

> Pomelo White (#F9FFE3) + Forest Green (#082613) + Gold (#F59E0B) brend palitrasi.
> Mighty Networks (bold marketing) + Podia (toza dashboard) hibrid stili.

---

## 1. Brend identitet

### 1.1 Rang sxemasi
| Rol | Hex | Foydalanish |
|-----|-----|-------------|
| Pomelo 100 | `#F9FFE3` | Asosiy fon |
| Pomelo 50 | `#FCFFF0` | Section variantlari |
| Forest 800 | `#082613` | Asosiy matn, primary tugmalar |
| Forest 700 | `#0E3A1E` | Hover holati |
| Forest 600 | `#155029` | Muted matn |
| Gold 400 | `#FBBF24` | Accent (highlight, badge) |
| Gold 500 | `#F59E0B` | CTA emphasis |
| White | `#FFFFFF` | Karta foni (kontrast) |

### 1.2 Tipografiya
- **Sarlavhalar:** Inter (700-800 weight), `tracking-tight`, `leading-[1.05]`
- **Body:** Inter (400-500 weight), `leading-relaxed`
- **Meta:** Inter (600 weight, uppercase, `tracking-[0.2em]`)
- **O'zbek/Rus uchun:** `cv02 cv03 cv04 cv11` font features

### 1.3 Spacing va shape sistemasi
- Border radius: `rounded-2xl` (16px) — kartalar, `rounded-3xl` (24px) — katta sectionlar, `rounded-full` — tugmalar
- Section padding: `py-24 sm:py-32`
- Container: `max-w-7xl px-4 sm:px-6 lg:px-8`
- Card border: `border border-forest-800/10`
- Shadow: `shadow-xl shadow-forest-800/10` (yashil tinkali)

### 1.4 Animatsiya tamoyillari
| Trigger | Animatsiya |
|---------|-----------|
| Element viewport ga kirsa | Fade-in + 30px slide-up, 0.7s, ease `[0.22, 1, 0.36, 1]` |
| Stagger children | 100ms cascade |
| Hover (kartalar) | `-translate-y-1`, soya kuchayadi, 500ms |
| Hover (icon) | `scale-110 rotate-3`, 500ms |
| Hover (tugma) | `scale-1.04`, spring (stiffness 400, damping 17) |
| Active | `scale-0.98` |
| Background blob | 12s sikl, `translate + scale` |
| Counter | 0→target 2s, easeOutCubic |
| Page transition | 300ms fade |

---

## 2. Sahifalar xaritasi (sitemap)

```
🏠 PUBLIC (marketing)
├── /                          → Teacher landing (asosiy)
├── /talabalar-uchun           → Student landing
├── /pricing                   → Narxlar
├── /about                     → Biz haqimizda
├── /search                    → O'qituvchilarni qidirish
├── /t/{slug}                  → O'qituvchi public profili
├── /i/{token}                 → Invite link landing
├── /legal/terms               → Foydalanish shartlari
├── /legal/privacy             → Maxfiylik siyosati
└── /faq                       → Savol-javoblar

🔐 AUTH
├── /login                     → Kirish
├── /register                  → Ro'yxatdan o'tish (role tanlash)
├── /verify-email              → Email tasdiqlash
├── /forgot-password           → Parolni tiklash so'rovi
└── /reset-password            → Yangi parol

👨‍🏫 TEACHER DASHBOARD (auth required, role=TEACHER)
├── /onboarding                → Specialty quiz (faqat birinchi marta)
├── /dashboard                 → Asosiy ko'rsatkichlar
├── /courses                   → Kurslar ro'yxati
├── /courses/new               → Yangi kurs yaratish
├── /courses/{id}              → Kurs tafsilotlari
├── /courses/{id}/groups       → Guruhlar
├── /courses/{id}/groups/new   → Yangi guruh
├── /groups/{id}               → Guruh dashboard
├── /groups/{id}/lessons       → Darslar
├── /groups/{id}/lessons/new   → Yangi dars
├── /groups/{id}/lessons/{lid} → Dars tahriri
├── /groups/{id}/students      → Talabalar
├── /groups/{id}/schedule      → Jadval (RRULE)
├── /groups/{id}/modules       → Module toggle
├── /groups/{id}/assignments   → Uy vazifalar
├── /groups/{id}/submissions   → Tekshirish kerak
├── /live                      → Hozirgi/kelgusi efirlar
├── /live/{sessionId}          → Live efir studio
├── /requests                  → Enrollment so'rovlari
├── /chat                      → Chatlar
├── /chat/{roomId}             → Chat oynasi
├── /messages                  → DM ro'yxati
├── /messages/{userId}         → DM oynasi
├── /notifications             → Xabarnomalar
├── /analytics                 → Analitika
├── /billing                   → Obuna va to'lovlar
├── /settings/profile          → Profil
├── /settings/account          → Akkaunt
├── /settings/notifications    → Xabarnoma sozlamalari
├── /settings/payouts          → Payout sozlamalari
└── /settings/integrations     → Integratsiyalar

🎓 STUDENT DASHBOARD (auth required, role=STUDENT)
├── /dashboard                 → Bugungi darslar, AI tutor
├── /my-courses                → Yozilgan kurslar
├── /lessons/{id}              → Lesson player
├── /lessons/{id}/homework     → Uy vazifasi
├── /assignments/{id}          → Topshiriq tafsilotlari
├── /submissions/{id}          → O'z submission
├── /live/{sessionId}          → Live efir tomosha
├── /tutor                     → AI Tutor chat
├── /messages/{userId}         → O'qituvchi bilan DM
├── /search                    → Yangi kurs qidirish
├── /payments                  → To'lov tarixi
├── /notifications             → Xabarnomalar
├── /settings/profile          → Profil
└── /settings/notifications    → Xabarnoma sozlamalari

⚙️ ADMIN DASHBOARD (auth required, role=ADMIN)
├── /admin                     → Platforma ko'rsatkichlari
├── /admin/users               → Foydalanuvchilar
├── /admin/users/{id}          → User tafsilotlari
├── /admin/specialties         → Specialty katalogi
├── /admin/specialties/{id}    → Modul cap (≤10)
├── /admin/onboarding          → Onboarding savollari
├── /admin/payments            → Barcha to'lovlar
├── /admin/audit-log           → Audit log
└── /admin/system-health       → Sistemani holat
```

---

## 3. Sahifalar dizayn batafsilligi

### 3.1 Public (Marketing)

#### `/` — Teacher Landing
**Bo'limlar:**
1. **Header** — sticky, blur, logo + role switcher (segmented control) + nav + Boshlash CTA
2. **Hero** — Pomelo fon, blob animatsiya, "Bilim'ga ko'prik qurish" katta sarlavha, gold underline, ikkita CTA, Hero Visual (3D dashboard mockup chap, AI chat o'ng, gold "+24%" badge yuqori-o'ng, notification toast pastda)
3. **Stats** — 100K+/5K+/99.9%/24/7 counter animatsiya
4. **Trust Marquee** — fan nomlari cheksiz scroll
5. **Bento Features** — 7 ta karta (turli o'lcham: 2x1, 1x1)
6. **How it Works** — to'q yashil fon, 3 qadam (01/02/03 katta raqamlar)
7. **Testimonial** — katta tirnoqcha + Sefer Aliyev
8. **CTA card** — Final to'q yashil gradient kart

#### `/talabalar-uchun` — Student Landing
**Bo'limlar:**
1. Header (avval bilan bir xil)
2. **Hero** — "🎓 Talabalar uchun" badge, "O'qimoq endi qiziqarli" sarlavha
3. **Search bar** — qidiruv input + popular tags
4. **Stats** — 5K+ o'qituvchilar, 100+ fanlar, 50K+ kurslar, 4.8★ baho
5. **Benefits** — 6 ta emoji kart (24/7 AI, Live, AI grading, Mobile, DM, Notifications)
6. **How students start** — 3 qadam (toping → to'lang → boshlang)
7. **Student testimonial** — Madina K. (IELTS 7.5)
8. **CTA card**

#### `/pricing` — Narxlar
**Layout:**
- Hero: "Faqat ikkinchi oydan to'laysiz" + 14-kunlik trial badge
- 3 ta plan kart (yon-yonda, o'rtadagi "Mashhur" highlight):
  - **Launch** — 99,000 UZS/oy → 50 talaba, asosiy imkoniyatlar
  - **Scale** — 299,000 UZS/oy → 200 talaba, AI grading, branded
  - **Pro** — Custom → unlimited, dedicated support
- Comparison table (40+ feature)
- FAQ accordion
- Bottom CTA

**Animatsiya:** plan kartlar hover'da `-translate-y-2`, "Mashhur" plan'da subtle gold glow pulse.

#### `/about` — Biz haqimizda
**Layout:**
- Hero: "Bilim adolatli bo'lishi kerak"
- Mission statement (left text + right illustration)
- Stats (qachon boshlandi, jamoamiz, mijozlar)
- Team grid (foto + ism + lavozim, hover animatsiya)
- Values cards (3-4)
- Bottom CTA

#### `/search` — Discovery (O'qituvchilarni qidirish)
**Layout:**
- Sticky search bar (filter chip'lar bilan)
- Sidebar (chap): Specialty filter, narx oralig'i, baho, til, joylashuv
- Asosiy: O'qituvchilar grid (avatar + ism + specialty + baho + narx)
- Pagination (cursor-based)
- Bo'sh holat illustration

**Animatsiya:** kart hover'da gradient border, filter o'zgarganda smooth re-arrangement (Framer Motion `layout`).

#### `/t/{slug}` — Teacher public profil
**Layout:**
- Cover banner (gradient default + custom option)
- Avatar (overlap), ism, headline, baho
- Tablar: Kurslar / Sharhlar / Tarjima / About
- Kurslar grid (kart formatda)
- "Xabar yuborish" tugmasi (DM)
- "Ro'yxatdan o'tish" CTA

#### `/i/{token}` — Invite link
**Layout:**
- Centered card: O'qituvchi avatar + ism, kurs nomi, narx, "Qo'shilish" tugma
- Agar logged out: register form ham ko'rsatiladi
- To'lov flow: Payme redirect

---

### 3.2 Auth

**Umumiy stil:** ikki ustunli layout — chap tomon brend illustration (yashil fonda Pomelo dog'lar), o'ng tomon form.

#### `/login`
- Email + parol
- "Eslab qolish" checkbox
- "Parolni unutdingizmi?" link
- Submit tugma (yashil)
- "Akkauntingiz yo'qmi? Ro'yxatdan o'tish" link
- Telegram OAuth (Phase 2+)

#### `/register`
- **Role selector** (segmented: Talaba / O'qituvchi) — animatsiyali pill
- Email + Parol + To'liq ism
- Terms agree checkbox
- Submit
- "Akkauntim bor" link

#### `/verify-email`
- Centered illustration (envelope animatsiyasi)
- "Email ko'ring va tasdiqlang" matn
- "Qayta yuborish" tugma (60s cooldown)
- Token URL'da bo'lsa avtomatik tekshiradi

#### `/forgot-password` va `/reset-password`
- Oddiy 1-input form
- Yuborilganida success state

---

### 3.3 Teacher Dashboard

**Umumiy layout:**
- **Top nav:** logo + global search + notifications bell + avatar dropdown
- **Sidebar (chap, kollabsabl):** Dashboard / Courses / Live / Requests / Chat / Messages / Analytics / Billing / Settings
- **Main:** breadcrumb + page heading + actions + content
- **Bottom (mobile):** tab bar (5 ta asosiy)

#### `/onboarding` — Quiz
- Stepper (1/4, 2/4, ...)
- Har bir savol katta (h2 size)
- 3 ta variant kart (radio group, ulkan)
- Animatsiya: keyingi savolga slide-left transition
- Submit'da loader, keyin specialty natija ko'rsatiladi → "Boshlash" CTA

#### `/dashboard` — Teacher home
**Bento grid:**
- Welcome card (chap-yuqori, katta) — "Xayrli kun, Sefer!" + bugungi statistika
- Trial countdown card (agar TRIAL bo'lsa)
- Quick stats (talabalar, kurslar, daromad bu oyda)
- Yaqin live efirlar (timeline)
- Tekshirish kerak (submission count)
- Yangi enrollment so'rovlari
- Recent activity feed

#### `/courses` — Kurslar ro'yxati
- Grid yoki list view toggle
- Har bir kurs kartida: cover, title, talabalar soni, oxirgi yangilangan, status badge
- "+ Yangi kurs" floating button (yashil)
- Filter: status, specialty, mashhurlik bo'yicha
- Empty state: "Hali kurs yo'q" + CTA

#### `/courses/{id}` — Kurs tafsilotlari
- Cover area (edit hover)
- Tablar: Guruhlar / Sozlamalar / Statistika
- Guruhlar grid kartlar bilan (talabalar soni, status)

#### `/groups/{id}` — Guruh dashboard
- 4 ta katta stat kart yuqorida (talabalar, jadvalda kunlar, oxirgi dars, AI baholash)
- Tablar: Darslar / Talabalar / Jadval / Modullar / Topshiriqlar / Submissionlar / Sozlamalar
- Kontent tabga qarab

#### `/groups/{id}/lessons/new` — Lesson editor
- Asosiy:
  - Title input (katta)
  - Type selector (RECORDED / LIVE / HYBRID / TEXT_ONLY) — visual cards
  - Description (rich text editor)
  - Material upload (drag-drop zona, multipart progress bar)
  - Schedule picker (LIVE bo'lsa)
- Sidebar (o'ng): preview, status, publish tugma

#### `/live/{sessionId}` — Live studio (TEACHER)
- To'liq ekran rejimi
- Asosiy: video preview (kamera/screen)
- O'ng panel: chat + ishtirokchilar ro'yxati
- Pastgi panel: mute / camera / share screen / end
- Recording indikator (qizil dot pulse)

#### `/groups/{id}/modules` — Module toggle
- Specialty katalog ro'yxati (10 tagacha)
- Har biri toggle switch (animatsiya: yoshil → kulrang)
- Tushuntiruv: "O'chirilgan modul mavjud assignmentlarni buzmaydi"
- Save tugmasi pastda

#### `/billing` — Obuna boshqaruvi
- Hozirgi plan kart (TRIAL/ACTIVE/PAST_DUE — turli rang)
- Trial countdown progress bar
- Invoice tarixi (jadval)
- Plan o'zgartirish CTA
- Bekor qilish (modal bilan tasdiqlash)

---

### 3.4 Student Dashboard

**Umumiy layout:**
- **Top nav:** logo + global search + AI Tutor floating button + notifications + avatar
- **Sidebar yo'q** (top nav + bottom tab bar mobile uchun)
- **Asosiy:** breadcrumb + content

#### `/dashboard` — Student home
**Bento grid:**
- "Xush kelibsiz, Madina!" + progress overview
- Bugungi darslar (timeline kart)
- Davom etilayotgan kurs (resume tugma)
- Yaqin live efirlar
- Yangi xabarlar (notification feed)
- AI Tutor "savol bering" floating prompt

#### `/my-courses` — Mening kurslarim
- Card grid: cover + title + progress bar + o'qituvchi
- Filter: faol / tugatilgan / barcha
- Hover: "Davom etish" tugma chiqadi

#### `/lessons/{id}` — Lesson player
**Layout:**
- Yuqori: video player (HLS.js) yoki text content
- Pastda: next/prev navigation
- O'ng panel (toggle): lesson list (qo'shni), notes, AI tutor
- Pastda: "Uy vazifasi" tugma agar mavjud bo'lsa

**Animatsiya:** video oxirida confetti yoki "Tugatdingiz!" overlay.

#### `/tutor` — AI Tutor chat
**Layout:**
- ChatGPT-stil interfeys
- Chap sidebar: oxirgi suhbatlar
- Asosiy: chat oynasi (yashil bubble — student, oq bubble — AI)
- Pastda: input + intent selector (Tushuntir / Tarjima / Misol)
- Rate limit indikatori (60/10min)

#### `/lessons/{id}/homework` — Uy vazifasi
- Modul'ga qarab UI:
  - **Writing:** rich text editor + autosave indikator
  - **Reading:** passage chap, savol/popup o'ng (so'z hover → tarjima)
  - **Listening:** audio player + transcript blanks
  - **Grammar:** drag-drop yoki multiple choice
- Submit tugma + "Saqlash va keyin davom" tugma

---

### 3.5 Admin Dashboard

**Umumiy layout:**
- Sidebar (chap): Users / Specialties / Onboarding / Payments / Audit / Health
- Top nav: search + admin badge + logout

#### `/admin` — Platforma ko'rsatkichlari
- KPI cards: jami foydalanuvchilar, faol obunalar, oylik daromad, error rate
- Real-time graph (oxirgi 24 soat)
- Top o'qituvchilar leaderboard
- Recent admin actions (audit log preview)

#### `/admin/specialties/{id}` — Modul cap
- 10 ta slot vizualizatsiyasi (band/bo'sh)
- Modul qo'shish dialog (HomeworkModuleType select)
- 11-chi qo'shishda xato modal (qizil)
- Reorder drag-handle

---

## 4. Reusable komponentlar

### 4.1 Buttons
- **Primary:** `bg-forest-800 text-pomelo-100 rounded-full px-5 py-2`
- **Secondary:** `border border-forest-800/20 bg-white/40`
- **Ghost:** `text-forest-700 hover:bg-forest-100`
- **Danger:** `bg-red-600 text-white`
- **Sizes:** sm / md / lg / xl

### 4.2 Cards
- **Default:** `rounded-3xl border border-forest-800/10 bg-white p-6/8`
- **Bento:** turli o'lcham (col-span-1, col-span-2, row-span-2)
- **Outlined:** transparent fon + border
- **Stat:** katta raqam + label + trend indicator

### 4.3 Forms
- Input: `rounded-2xl border border-forest-800/15 px-4 py-3 focus:border-forest-800 focus:ring-2 focus:ring-forest-800/10`
- Label: `text-sm font-semibold text-forest-700`
- Error: `text-red-600 text-xs mt-1`
- Helper: `text-forest-700/60 text-xs`

### 4.4 Navigation
- **Top nav:** sticky, blur, h-16
- **Sidebar:** width 280px, collapsible to 64px (icon only)
- **Tab bar (mobile):** fixed bottom, 5 ta icon
- **Breadcrumb:** > separator, hover underline
- **Tabs:** segmented control yoki underline style

### 4.5 Overlays
- **Modal:** `rounded-3xl bg-white p-8 max-w-lg`, backdrop blur
- **Drawer:** chap/o'ng dan slide-in, mobile uchun fullscreen
- **Toast:** o'ng-yuqori, auto-dismiss 4s, success/error/info variantlar
- **Tooltip:** small dark fon, fade-in 200ms

### 4.6 Data display
- **Table:** `rounded-2xl border` ichida, sticky header, hover row
- **List:** divider line ostida
- **Empty state:** illustration + matn + CTA
- **Loading skeleton:** Pomelo shimmer animatsiya
- **Pagination:** cursor-based (Load more) yoki page numbers

### 4.7 Feedback
- **Progress bar:** yashil fill, 1.5s ease
- **Spinner:** yashil dot pulse
- **Confetti:** lesson tugatganda (canvas-confetti)
- **Empty illustration:** custom SVG (forest tree silhouette)

---

## 5. Animatsiya kutubxonasi (Framer Motion)

| Komponent | Maqsad |
|-----------|--------|
| `<FadeIn>` | Viewport'ga kirganda fade + slide-up |
| `<Stagger>` + `<StaggerItem>` | Children kaskad bilan kirish |
| `<Parallax>` | Scroll bo'yicha element harakat |
| `<MagneticButton>` | Hover'da scale + spring |
| `<AnimatedCounter>` | 0→target counter |
| `<AnimatedRoute>` | Page transition |
| `<Pulse>` | Live indikator |
| `<Marquee>` | Cheksiz scroll strip |
| `<Float>` | 6s ease floating element |
| `<Blob>` | 12s background blob |
| `<Shimmer>` | Loading skeleton |
| `<Confetti>` | Achievement burst |

---

## 6. Mobile responsive plan

- **Breakpoint'lar:** sm (640) / md (768) / lg (1024) / xl (1280) / 2xl (1400)
- **Mobile-first:** har bir komponent kichik ekranda ham ishlaydi
- **Mobile spec:**
  - Sidebar → bottom tab bar
  - Bento grid → 1 ustun stack
  - Hero: 2 ustun → 1 ustun (image yuqorida)
  - Marquee: tezroq scroll
  - Modal → bottom sheet
- **Touch targets:** minimum 44x44px
- **Mobile nav:** hamburger drawer

---

## 7. Accessibility (a11y)

- Semantic HTML (header, nav, main, section, article, aside, footer)
- ARIA labels barcha interaktiv elementlarda
- Focus rings (forest-800 ring)
- Keyboard navigation (Tab, Esc, Enter, Arrow keys)
- Color contrast: WCAG AA minimal (4.5:1 normal text, 3:1 large)
- Reduced motion: `@media (prefers-reduced-motion)` — animatsiya o'chiriladi
- Screen reader only matn: `.sr-only` utility

---

## 8. Dark mode rejasi

- Pomelo fon → Forest 900 (#04140A)
- Forest matn → Pomelo 100
- Karta fon → Forest 800/50% transparent
- Border → Pomelo/15 transparent
- Toggle: header'dagi sun/moon icon

---

## 9. Performance

- Next.js App Router + RSC (Server Components default)
- Image optimization (`next/image`, AVIF + WebP)
- Font preload (Inter latin + cyrillic)
- Code splitting (dynamic imports modal, drawer uchun)
- Skeleton loaders (so'rovlardan tezroq UI)
- Optimistic UI (form submission, like)
- Service Worker (offline lesson viewing)

---

## 10. Implementation roadmap

| Faza | Sahifalar | Vaqt |
|------|-----------|------|
| **A** ✅ | Marketing layout, `/`, `/talabalar-uchun` | Bajarilgan |
| **B** | `/login`, `/register`, `/verify-email`, `/forgot-password`, `/reset-password` | 1 kun |
| **C** | `/pricing`, `/about`, `/faq`, `/legal/*` | 1 kun |
| **D** | `/search`, `/t/{slug}` (Discovery) | 1 kun |
| **E** | Teacher: `/onboarding`, `/dashboard`, `/courses` | 2 kun |
| **F** | Teacher: Group/Lesson editor, modules toggle | 2 kun |
| **G** | Teacher: `/live/*`, `/billing`, `/analytics` | 2 kun |
| **H** | Student: `/dashboard`, `/my-courses`, `/lessons/{id}` | 2 kun |
| **I** | Student: `/tutor`, `/lessons/{id}/homework` (Reading/Writing/Listening) | 2 kun |
| **J** | Chat & DM (`/chat`, `/messages`) | 1 kun |
| **K** | Admin panel | 1 kun |
| **L** | Settings sahifalar (barcha rollar) | 1 kun |
| **M** | Empty states, loading, error pages, polish | 1 kun |
| **N** | Dark mode, mobile responsive audit, a11y | 1 kun |
