# Telegram uslubidagi xabarlar tizimi — Amalga oshirish rejasi

> [research.md](./research.md) · [design.md](./design.md)

## Umumiy ko'rinish

7 bosqich. Har bosqich mustaqil deploy qilinadi va foydalanuvchiga ko'rinadigan
qiymat beradi. Phase 0–3 — "Telegram minimum" (MVP), Phase 4–6 — to'liq paritet.

| Phase | Nomi | Natija | Taxminiy hajm |
|---|---|---|---|
| 0 | Poydevor va tuzatishlar | Mavjud chat barqaror va tez ishlaydi | S |
| 1 | Ma'lumot modeli + realtime | Yangi sxema, `/chat` gateway, seq | L |
| 2 | Media to'liq qo'llab-quvvatlash | Har xil fayl, albom, thumbnail, ovoz | M |
| 3 | Xabar amallari | Reply, forward, edit, delete, reaksiya, pin | L |
| 4 | Telegram UX qatlami | Typing, presence, ✓✓, guruhlash, qidiruv | L |
| 5 | Mustaqil guruhlar | Guruh yaratish, huquqlar, invite link | M |
| 6 | Sayqal | Stiker, poll, arxiv, papka, oflayn | M |

---

## Phase 0 — Poydevor va mavjud xatolarni tuzatish

Yangi funksiya qo'shishdan oldin hozirgi tizimni barqarorlashtirish.

- [ ] **0.1 Socket.io Redis adapter**
  - `@socket.io/redis-adapter` + `apps/api/src/infra/socket/redis-io.adapter.ts`
  - `main.ts` da `app.useWebSocketAdapter(...)`
  - Test: ikki pod ko'tarilganda cross-pod broadcast ishlaydi
  - _Muammo: [research.md §4](./research.md) #5_

- [ ] **0.2 Inbox N+1 so'rovlarini yo'qotish**
  - `dm.service.ts:231` va `group-chat.service.ts:141` dagi `count()` siklini
    bitta `groupBy` so'roviga aylantirish (vaqtinchalik yechim, Phase 1 da
    denormalizatsiya bilan almashtiriladi)
  - _Muammo: #1_

- [ ] **0.3 Media metadata batch endpoint**
  - `POST /media/assets/batch-urls` `{ assetIds[] }` → metadata + signed URL
  - Frontend: `useAssetBatch(assetIds)` hooki, per-bubble `useEffect` o'rniga
  - _Muammo: #4 — 20 media = 40 so'rov → 1 so'rov_

- [ ] **0.4 `markRead` va polling tuzatish**
  - `group-chat-thread.tsx:133` — `messages.length` dependency olib tashlanadi,
    faqat oxirgi xabar `id` o'zgarganda va debounce bilan
  - `refetchInterval: 30_000` → socket'ga ishonish (Phase 1 gacha 60s ga uzaytirish)
  - _Muammo: #3, #6_

- [ ] **0.5 MIME allowlist kengaytirish (tezkor g'alaba)**
  - `media.types.ts` — HEIC/AVIF, pptx, zip/rar/7z, txt/csv/md, avi
  - `OTHER: ['application/octet-stream', ...]`
  - Xavfsizlik: `Content-Disposition: attachment` + `nosniff` +
    executable kengaytma blok-ro'yxati
  - _Muammo: [research.md §3.4](./research.md) — hozir `OTHER: []`_

---

## Phase 1 — Ma'lumotlar modeli va realtime poydevori

- [ ] **1.1 Prisma sxema — additive migration**
  - `ChatRoomType`, `ChatMemberRole`, `MessageType`, `SystemEventType` enumlar
  - `ChatRoom`: `type, title, about, avatarAssetId, ownerId, linkedGroupId,
    slowModeSeconds, defaultPermissions, lastMessageId, lastMessageAt, lastSeq,
    memberCount`
  - `ChatMessage`: `seq, type, entities, replyToId, quoteText, forward*,
    mediaGroupId, editedAt, pinnedAt, systemEvent, clientMsgId`
  - `ChatMember`, `ChatAttachment`, `MessageReaction`, `MessageDeletion`,
    `ChatInvite`, `BlockedUser` jadvallari
  - Indekslar: `@@unique([roomId, seq])`, `@@unique([roomId, clientMsgId])`,
    `@@index([roomId, seq desc])`

- [ ] **1.2 Backfill migratsiya skripti**
  - `packages/db/prisma/migrations/scripts/backfill-chat-v2.ts`
  - `seq` ← `ROW_NUMBER() OVER (PARTITION BY roomId ORDER BY createdAt, id)`
  - `assetId` → `ChatAttachment`; `GroupChatMember` → `ChatMember`;
    `DmReadReceipt.lastReadAt` → `ChatMember.lastReadSeq`
  - Idempotent — qayta ishga tushirsa ham xavfsiz

- [ ] **1.3 `ChatModule` yaratish**
  - `apps/api/src/modules/chat/` — `chat.service.ts`, `chat-message.service.ts`,
    `chat-member.service.ts`, `repositories/chat.repository.ts`
  - `seq` generatsiyasi: `ChatRoom.lastSeq` ni tranzaksiyada `UPDATE ... RETURNING`
    bilan atomik oshirish (race-free)
  - `clientMsgId` idempotentligi: unique constraint xatosida mavjud xabarni qaytarish

- [ ] **1.4 `/chats` REST controller**
  - [design.md §4](./design.md) dagi endpointlar
  - Seq-based ikki tomonlama pagination: `?beforeSeq`, `?afterSeq`, `?aroundSeq`
  - Eski `/dm` va `/group-chat` — `@Deprecated`, ichkarida yangi servisga proksi

- [ ] **1.5 `/chat` Socket.io gateway**
  - `chat.gateway.ts` — `chat:subscribe/send/typing/read/react`
  - Ack pattern: `chat:send` → `{ ok, messageId, seq, createdAt }`
  - JWT auth (mavjud `ws-jwt.guard.ts` qayta ishlatiladi)
  - Rate limit: 5 msg/sek socket + 30/daq user (mavjud)
  - `user:{userId}` xonasi — inbox yangilanishlari uchun

- [ ] **1.6 Frontend: yagona `chat-thread.tsx`**
  - `message-thread.tsx` + `group-chat-thread.tsx` → bitta komponent
  - `useInfiniteQuery` seq cursor bilan, yuqoriga cheksiz scroll
  - `@tanstack/react-virtual` virtualizatsiya
  - Optimistic send `clientMsgId` bilan
  - Barcha `refetchInterval` olib tashlanadi

---

## Phase 2 — Media to'liq qo'llab-quvvatlash

- [ ] **2.1 Ko'p fayl / albom**
  - `ChatAttachment` orqali bitta xabarda 10 tagacha fayl
  - Composer: bir nechta fayl tanlash → bitta xabar, umumiy caption
  - `album-grid.tsx` — 1/2/3/4+ fayl uchun Telegram mozaikasi

- [ ] **2.2 Thumbnail + blurhash pipeline**
  - `TranscodingService` kengaytirish: `thumb_320.webp`, `thumb_1280.webp`,
    video `poster.jpg`, PDF 1-sahifa preview
  - `blurhash` generatsiyasi va `ChatAttachment.blurhash` ga saqlash
  - Frontend: blurhash → thumb → to'liq progressiv yuklash
  - _Muammo: [research.md §4](./research.md) #10 — hozir 5 MB rasm bubble uchun to'liq yuklanadi_

- [ ] **2.3 Klient tomonda rasm siqish**
  - `apps/web/lib/image-compress.ts` — canvas orqali max 2560px, WebP
  - "Original sifatida yuborish" belgisi (Telegram'dagidek)

- [ ] **2.4 Ovozli xabar**
  - `MediaRecorder` → `audio/webm;codecs=opus`
  - `voice-recorder.tsx` — bosib turib yozish, slide-to-cancel, davomiylik
  - Backend: ffmpeg orqali waveform (50 nuqta) → `ChatAttachment.waveform`
  - `voice-message.tsx` — to'lqin, progress, 1.5×/2× tezlik

- [ ] **2.5 Fayl xabarlari UI**
  - Tur bo'yicha ikonka va rang (PDF qizil, Word ko'k, Excel yashil, ZIP kulrang)
  - Yuklab olish progressi, "yuklab olindi" holati
  - Rasm/video uchun to'liq ekran lightbox + galereya navigatsiyasi (mavjud
    `Lightbox` kengaytiriladi)

- [ ] **2.6 Media xavfsizligi**
  - AV-skanerlash hooki: `AssetStatus.SCANNING`, skanerdan o'tmagan fayl bloklanadi
  - Executable kengaytma blok-ro'yxati serverda ham (klient tekshiruvi yetarli emas)
  - `svg+xml` rad etiladi

---

## Phase 3 — Xabar amallari

- [ ] **3.1 Reply (javob)**
  - `replyToId` + `quoteText`; composer'da reply-bar
  - Bubble ichida reply preview, bosilsa `aroundSeq` bilan sakrash + yorug'lik
  - Mobil: chapga swipe

- [ ] **3.2 Forward (uzatish)**
  - `POST /chats/:id/messages/forward` — bir nechta xabar birdaniga
  - `forward-dialog.tsx` — chat tanlash + izoh qo'shish
  - Bubble tepasida "X dan uzatildi"

- [ ] **3.3 Edit (tahrirlash)**
  - 48 soatlik oyna, faqat o'z xabari
  - `editedAt` → bubble'da "tahrirlangan" belgisi
  - `↑` klavishi — oxirgi xabarni tahrirlash

- [ ] **3.4 Delete (o'chirish)**
  - "Menda o'chirish" (`MessageDeletion`) vs "Hamma uchun" (`deletedAt`)
  - Admin guruhda istalgan xabarni o'chira oladi
  - Tanlash rejimi → ommaviy o'chirish

- [ ] **3.5 Reaksiyalar**
  - `PUT /chats/:id/messages/:mid/reactions` toggle
  - Hover'da tez reaksiya paneli (👍❤️🔥😁😮😢🙏)
  - Bubble ostida hisoblagichlar, bosilganda kim bosgani

- [ ] **3.6 Pin (qadash)**
  - Bir nechta qadalgan xabar, header ostida `pinned-bar.tsx`
  - "Barcha qadalganlarni ko'rish" ro'yxati
  - Tizim xabari: "X xabarni qadadi"

- [ ] **3.7 Matn formatlash (entities)**
  - `entities` JSON: bold, italic, underline, strike, spoiler, code, pre, link, mention
  - Composer'da markdown shortcut (`**qalin**`, `` `kod` ``) va `Ctrl+B/I/U`
  - Render — `stripHtml` o'rniga entity-based xavfsiz renderer
  - Spoiler — bosilguncha blur

- [ ] **3.8 Link preview**
  - Backend: URL metadata olish (OpenGraph), Redis'da 24 soat cache
  - SSRF himoyasi: ichki IP diapazonlari bloklanadi
  - `link-preview.tsx` karta

- [ ] **3.9 Kontekst menyu + tanlash rejimi**
  - O'ng tugma / uzoq bosish → Javob, Uzatish, Nusxa, Tahrir, Qadash, O'chirish, Tanlash
  - Tanlash rejimi → header o'zgaradi, ommaviy amallar

---

## Phase 4 — Telegram UX qatlami

- [ ] **4.1 Typing indicator**
  - Redis `typing:{roomId}:{userId}` EX 6, klient 4s da yangilaydi
  - Header: "yozmoqda…", "rasm yubormoqda…"; guruhda "Ali va yana 2 kishi yozmoqda"
  - Chat ro'yxatida ham ko'rinadi

- [ ] **4.2 Presence (onlayn / oxirgi ko'rilgan)**
  - Redis heartbeat 30s, `User.lastSeenAt` throttled write
  - Avatar'da yashil nuqta, header'da "oxirgi marta 5 daqiqa oldin"
  - `UserSettings.showLastSeen` maxfiylik sozlamasi

- [ ] **4.3 O'qildi belgilari (✓ / ✓✓)**
  - `ChatMember.lastReadSeq` asosida
  - DM: ✓ yuborildi, ✓✓ o'qildi
  - Guruh: "N kishi o'qidi" (bosilganda ro'yxat)

- [ ] **4.4 Xabarlar oynasini sayqallash**
  - Sana ajratuvchilari ("Bugun", "Kecha", "12-avgust")
  - Ketma-ket xabarlarni guruhlash (avatar faqat oxirgisida, zich joylashuv)
  - "Yangi xabarlar" ajratuvchi chizig'i
  - Pastga sakrash FAB + o'qilmagan soni
  - Bo'sh chat holati, skeleton yuklanish

- [ ] **4.5 Qidiruv**
  - Chat ichida: `GET /chats/:id/search` + ↑/↓ navigatsiya, natija yoritiladi
  - Global: chat nomlari + xabar matni + foydalanuvchilar (`pg_trgm` GIN indeks)
  - Media filtri: faqat rasm / video / fayl / havola

- [ ] **4.6 Chat ro'yxati imkoniyatlari**
  - Chatni qadash (pin), mute (1s/8s/2kun/abadiy), arxiv
  - Papkalar: Barchasi / Shaxsiy / Guruhlar / O'qilmagan
  - Qoralama ko'rsatish ("Qoralama: salom…")
  - Guruhda oxirgi xabar oldida yuboruvchi ismi
  - Virtualizatsiya

- [ ] **4.7 Bildirishnomalar**
  - `NotificationKind`: `MESSAGE_RECEIVED`, `MESSAGE_MENTION`, `CHAT_INVITED`
  - Faqat oflayn foydalanuvchiga; mute hisobga olinadi; guruh push'lari debounce
  - Tab sarlavhasi `(3) Bilgim`, favicon badge, ovoz (o'chirilishi mumkin)
  - Web Push (mavjud `push-device` infratuzilmasi ustida)

- [ ] **4.8 @mention**
  - Composer'da `@` → a'zolar autocomplete
  - `entities` da `mention` turi, bubble'da yoritilgan va bosiladigan
  - `ChatMember.mentionCount` + chat ro'yxatida `@` badge
  - Mute qilingan chatda ham bildirishnoma yuboriladi

---

## Phase 5 — Mustaqil guruhlar va boshqaruv

- [ ] **5.1 Guruh yaratish**
  - `POST /chats/group` — kursdan mustaqil
  - `create-group-dialog.tsx` — nom, avatar, tavsif, a'zo tanlash
  - Kurs guruhlari `linkedGroupId` bilan avvalgidek avto-provizyon qilinadi

- [ ] **5.2 Guruh sozlamalari**
  - Nom/tavsif/avatar o'zgartirish (huquqga qarab)
  - Tizim xabarlari: "X guruh nomini o'zgartirdi"
  - Guruhni o'chirish (faqat egasi)

- [ ] **5.3 Granular huquqlar**
  - `ChatRoom.defaultPermissions` — a'zolar nima qila oladi
  - `ChatMember.permissions` — admin huquqlari
  - `permissions-editor.tsx` UI
  - Backend'da har amalda tekshiruv

- [ ] **5.4 A'zolarni boshqarish**
  - Ro'yxat + qidiruv + rol belgilari + onlayn holat
  - Ko'tarish/tushirish, cheklash (muddat bilan), chiqarish, bloklash
  - Egalikni topshirish (hozir `GROUP_CHAT_CANNOT_CHANGE_OWNER` bilan bloklangan)

- [ ] **5.5 Taklif havolalari**
  - `ChatInvite` — muddat, foydalanish limiti, tasdiqlash talabi
  - QR kod generatsiyasi
  - `POST /chats/join/:token`

- [ ] **5.6 Slow mode**
  - `ChatRoom.slowModeSeconds`, Redis'da per-user timer
  - Composer'da qolgan vaqt taymeri

- [ ] **5.7 Shared media paneli**
  - `GET /chats/:id/media?kind=` — Media / Fayllar / Havolalar / Ovoz tab'lari
  - Grid ko'rinishi, sanaga qarab guruhlangan

- [ ] **5.8 Bloklash va shikoyat**
  - `BlockedUser` — bloklangan foydalanuvchi DM yubora olmaydi
  - Xabar/foydalanuvchi ustidan shikoyat → admin moderatsiya navbati

---

## Phase 6 — Sayqal (ixtiyoriy)

- [ ] **6.1 Stiker va GIF** — stiker to'plamlari, GIF qidiruvi
- [ ] **6.2 So'rovnoma chatda** — mavjud `So'rovlar` moduli bilan integratsiya
- [ ] **6.3 Rejalashtirilgan xabarlar** — keyinroq yuborish (BullMQ)
- [ ] **6.4 "Saqlangan xabarlar"** — o'z-o'ziga chat (`ChatRoomType.SAVED`)
- [ ] **6.5 Oflayn rejim** — IndexedDB cache, yuborilmagan xabarlar navbati
- [ ] **6.6 Topics (forum rejimi)** — katta guruhlar uchun mavzuli threadlar
- [ ] **6.7 E'lonlar kanali** — `ChatRoomType.CHANNEL`, faqat admin yozadi
- [ ] **6.8 Tarixni eksport qilish** — GDPR/ma'lumot ko'chirish

---

## Bog'liqliklar grafi

```
Phase 0  ──►  Phase 1  ──┬──►  Phase 2  ──┐
                         │                ├──►  Phase 4  ──►  Phase 6
                         └──►  Phase 3  ──┘
                                          └──►  Phase 5
```

- **Phase 1** — hamma narsaning poydevori (`seq`, `ChatMember`, `/chat` gateway)
- **Phase 2 va 3** parallel bajarilishi mumkin
- **Phase 4** — 1, 2, 3 tugagach
- **Phase 5** — faqat Phase 1 ga bog'liq

---

## Tavsiya etilgan boshlanish nuqtasi

**Phase 0 + Phase 1.1–1.2** birinchi sprint uchun ideal:
- Foydalanuvchi darhol sezadi: har xil fayl yuborish ishlaydi (0.5), chat
  tezroq ochiladi (0.2, 0.3), ortiqcha so'rovlar yo'qoladi (0.4)
- Ma'lumot modeli tayyor bo'ladi va keyingi hamma narsa uning ustiga quriladi
- Buzilish xavfi past — hammasi additive
