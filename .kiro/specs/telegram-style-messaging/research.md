# Telegram uslubidagi xabarlar tizimi — Tadqiqot va Gap-tahlil

> Maqsad: Bilgim platformasidagi `Xabarlar` bo'limini Telegram darajasidagi
> to'liq messenger'ga aylantirish — shaxsiy chatlar (DM) + guruhlar, har xil
> turdagi fayl/rasm/video almashinuvi bilan.

---

## 1. Telegram anatomiyasi — nima qanday ishlaydi

### 1.1 Chat turlari

| Tur | Telegram'da | A'zolar | Xususiyat |
|---|---|---|---|
| **Private (DM)** | 1:1 shaxsiy chat | 2 | Ikki tomonlama, o'chirish ikkalasi uchun, bloklash |
| **Saved Messages** | O'z-o'ziga chat | 1 | Shaxsiy "bulut bloknot" |
| **Basic group** | Oddiy guruh | ≤200 | Barcha a'zolar teng huquqli |
| **Supergroup** | Kengaytirilgan guruh | ≤200 000 | Rollar, slow mode, topics, tarix saqlanadi |
| **Channel** | Kanal | ∞ | Faqat admin yozadi, obunachi o'qiydi |
| **Forum / Topics** | Supergroup ichida threadlar | — | Mavzuli bo'limlar, topic-level slow mode |

**Bizga kerak:** Private + Group (supergroup modeli). Channel — kelajakda
(masalan "Kurs e'lonlari" uchun). Topics — Phase 4 (ixtiyoriy).

### 1.2 Xabar kontent turlari

Telegram Bot API qo'llab-quvvatlaydigan to'liq ro'yxat:

```
text · photo · video · document · audio · voice · video_note (dumaloq video)
sticker · animation (GIF) · poll · location · venue · contact · dice
game · story · live_photo · checklist · paid_media
```

**Bizga kerak (prioritet bo'yicha):**
- **P0**: text, photo, video, document (har qanday fayl), audio
- **P1**: voice (ovozli xabar + to'lqin), album (bir nechta fayl = bitta xabar)
- **P2**: sticker/GIF, poll (so'rovnoma — platformada allaqachon `So'rovlar` bor), location
- **P3**: video_note, dice, live_photo

### 1.3 Xabar ustidagi amallar (message capabilities)

| Imkoniyat | Tavsif |
|---|---|
| **Reply** | Xabarga javob + `quote` (tanlangan qismini iqtibos qilish) |
| **Forward** | Boshqa chatga uzatish, manba ko'rsatiladi (`MessageOrigin`) |
| **Edit** | Matn/media/caption tahrirlash, `edited` belgisi |
| **Delete** | "Menda o'chirish" vs "Hamma uchun o'chirish" |
| **Pin** | Bir nechta xabarni chat tepasiga qadash |
| **Reactions** | Emoji reaksiyalar, kim bosgani ko'rinadi |
| **Media group** | 2–10 fayl bitta "albom" xabar sifatida |
| **Entities** | bold, italic, underline, strikethrough, spoiler, code, pre, link, mention |
| **Link preview** | URL uchun sarlavha+rasm+tavsif karta |
| **Selection** | Ko'p xabarni belgilab ommaviy forward/delete |
| **Scheduled** | Keyinroq yuborish |
| **Self-destruct** | Vaqtincha xabar (TTL) |
| **Protected content** | Forward/screenshot taqiqi |

### 1.4 Chat-daraja imkoniyatlari

- **Typing indicator** — "yozmoqda…", "rasm yubormoqda…" (chat action)
- **Presence** — online / "oxirgi marta 5 daqiqa oldin" / "yaqinda"
- **Read receipts** — DM'da ✓ (yuborildi) / ✓✓ (o'qildi); guruhda "N kishi o'qidi"
- **Unread divider** — "Yangi xabarlar" ajratuvchi chizig'i
- **Draft** — yozib tugatilmagan matn saqlanadi va chat ro'yxatida ko'rinadi
- **Mute** — chat/guruhni ovozsiz qilish (1 soat / 8 soat / 2 kun / abadiy)
- **Pin chat** — chatni ro'yxat tepasiga qadash
- **Archive** — arxivga yashirish
- **Folders** — Barchasi / Guruhlar / Shaxsiy / O'qilmagan
- **Search** — global qidiruv (chat nomi + xabar matni) va chat ichida qidiruv
- **Jump to message** — reply'ga bosganda o'sha xabarga sakrash + yorug'lik effekti
- **Shared media** — chat ichidagi barcha rasm/video/fayl/link'lar tab'lari
- **Block** — foydalanuvchini bloklash
- **Clear history / Delete chat**

### 1.5 Guruh boshqaruvi

- **Rollar**: Owner → Admin → Member
- **Granular admin huquqlari**: xabar o'chirish, a'zo bloklash, a'zo qo'shish,
  xabar qadash, guruh ma'lumotini o'zgartirish, admin tayinlash
- **Default a'zo huquqlari**: xabar yuborish, media yuborish, link yuborish,
  so'rovnoma yaratish, a'zo qo'shish, guruh ma'lumotini o'zgartirish
- **Slow mode** — har bir a'zo N soniyada 1 xabar (10s/30s/1m/5m/15m/1h)
- **Invite link** — token bilan taklif havolasi, muddat/limit bilan, QR kod
- **Restricted / banned users** — vaqtinchalik yoki doimiy cheklov
- **System messages** — "X guruhga qo'shildi", "Y guruh rasmini o'zgartirdi"
- **Member count + online count** — "1 234 a'zo, 56 onlayn"
- **Recent actions log** — admin harakatlari jurnali

---

## 2. Hozirgi holat (Bilgim) — nima bor

### 2.1 Ma'lumotlar modeli

```prisma
ChatRoom       { id, scope: String, scopeRef: String, createdAt }   // @@unique([scope, scopeRef])
ChatMessage    { id, roomId, authorId, body, assetId?, deletedAt?, createdAt }
DmReadReceipt  { roomId, userId, lastReadAt }                        // @@id([roomId, userId])
GroupChatMember{ id, groupId, userId, role: OWNER|ADMIN|MEMBER, joinedAt, removedAt? }
```

- `scope` qiymatlari: `DM` (scopeRef = `minUserId:maxUserId`), `GROUP`
  (scopeRef = `Group.id`), `LIVE_SESSION` (scopeRef = `lessonId`)
- Guruh chati **kurs guruhiga (`Group`) 1:1 bog'langan** — mustaqil guruh
  yaratib bo'lmaydi

### 2.2 Backend

| Modul | Fayl | Nima qiladi |
|---|---|---|
| DM | [dm.service.ts](apps/api/src/modules/dm/dm.service.ts) | thread ochish, ro'yxat, xabar yuborish/olish, markRead, pre-reciprocation rate limit |
| Group chat | [group-chat.service.ts](apps/api/src/modules/group-chat/group-chat.service.ts) | guruh ro'yxati, xabarlar, a'zolar CRUD, rol, avatar |
| Realtime | [live-chat.gateway.ts](apps/api/src/modules/live/chat/live-chat.gateway.ts) | `/live` namespace, `chat:join` / `chat:message` / `chat:leave` |
| Media | [media.service.ts](apps/api/src/modules/media/media.service.ts) | R2 multipart upload, HLS transcode, signed playback URL |

### 2.3 Frontend

| Fayl | Vazifa |
|---|---|
| [conversation-list.tsx](apps/web/components/messages/conversation-list.tsx) | DM + guruhlarni birlashtirib ro'yxat, qidiruv (faqat lokal filter) |
| [message-thread.tsx](apps/web/components/messages/message-thread.tsx) | DM oynasi (930 qator) |
| [group-chat-thread.tsx](apps/web/components/messages/group-chat-thread.tsx) | Guruh oynasi (815 qator) |
| [group-members-panel.tsx](apps/web/components/messages/group-members-panel.tsx) | A'zolar paneli |
| [new-message-dialog.tsx](apps/web/components/messages/new-message-dialog.tsx) | Yangi DM boshlash |

### 2.4 Media cheklovlari (hozir)

```ts
// apps/api/src/modules/media/media.types.ts
VIDEO: mp4, quicktime, webm, x-matroska
AUDIO: mpeg, mp4, wav, ogg, webm
IMAGE: png, jpeg, webp, gif
PDF:   application/pdf
DOC:   msword, docx
SHEET: xls, xlsx
OTHER: []            // ← BO'SH! Har qanday boshqa fayl RAD ETILADI
```

Chat attachment limiti: **1 GB**. Umumiy asset limiti: 5 GiB.

---

## 3. GAP-tahlil — Telegram vs Bilgim

### 3.1 Xabar imkoniyatlari

| Imkoniyat | Telegram | Bilgim | Status |
|---|:---:|:---:|---|
| Matn xabar | ✅ | ✅ | — |
| Bitta fayl biriktirish | ✅ | ✅ | — |
| **Albom (ko'p fayl = 1 xabar)** | ✅ | ❌ | `ChatMessage.assetId` — bitta |
| **Reply (javob)** | ✅ | ❌ | model yo'q |
| **Forward (uzatish)** | ✅ | ❌ | model yo'q |
| **Edit (tahrirlash)** | ✅ | ❌ | model yo'q |
| **Delete (o'chirish)** | ✅ | ⚠️ | `deletedAt` ustuni bor, lekin API/UI yo'q |
| **Reactions** | ✅ | ❌ | model yo'q |
| **Pin xabar** | ✅ | ❌ | model yo'q |
| **Matn formatlash (entities)** | ✅ | ❌ | `stripHtml()` bilan tozalanadi |
| **Link preview** | ✅ | ❌ | — |
| **Ko'p xabarni belgilash** | ✅ | ❌ | — |
| **Ovozli xabar** | ✅ | ❌ | AUDIO kind bor, UI yo'q |
| **Sticker / GIF** | ✅ | ❌ | GIF `image/gif` sifatida o'tadi |
| **Xabar qidiruvi** | ✅ | ❌ | faqat chat nomi bo'yicha lokal filter |
| **Jump to message** | ✅ | ❌ | — |
| **Scheduled / self-destruct** | ✅ | ❌ | past prioritet |

### 3.2 Chat imkoniyatlari

| Imkoniyat | Telegram | Bilgim | Status |
|---|:---:|:---:|---|
| Chat ro'yxati + o'qilmagan badge | ✅ | ✅ | — |
| **Typing indicator** | ✅ | ❌ | — |
| **Online / oxirgi ko'rilgan** | ✅ | ❌ | presence infra yo'q |
| **✓ / ✓✓ o'qildi belgisi** | ✅ | ❌ | `lastReadAt` bor, per-message yo'q |
| **Unread divider** | ✅ | ❌ | — |
| **Sana ajratuvchi** | ✅ | ❌ | — |
| **Ketma-ket xabarlarni guruhlash** | ✅ | ❌ | har bir xabar alohida avatar bilan |
| **Draft saqlash** | ✅ | ❌ | — |
| **Mute** | ✅ | ❌ | — |
| **Pin chat** | ✅ | ❌ | — |
| **Arxiv / papkalar** | ✅ | ❌ | — |
| **Shared media tab** | ✅ | ❌ | — |
| **Bloklash** | ✅ | ❌ | — |
| **Tarixni tozalash** | ✅ | ❌ | — |
| **Yuqoriga cheksiz scroll** | ✅ | ❌ | `pageSize: 100` qattiq, cursor ishlatilmaydi |

### 3.3 Guruh imkoniyatlari

| Imkoniyat | Telegram | Bilgim | Status |
|---|:---:|:---:|---|
| Rollar (Owner/Admin/Member) | ✅ | ✅ | — |
| A'zo qo'shish / chiqarish | ✅ | ✅ | — |
| Guruh rasmi | ✅ | ✅ | — |
| **Mustaqil guruh yaratish** | ✅ | ❌ | faqat kurs `Group`iga bog'langan |
| **Guruh nomi/tavsifini o'zgartirish** | ✅ | ❌ | nom `Group.name`dan keladi |
| **Taklif havolasi (invite link)** | ✅ | ❌ | `InviteLink` kursga bog'langan |
| **Granular admin huquqlari** | ✅ | ❌ | faqat 3 ta rol |
| **Default a'zo huquqlari** | ✅ | ❌ | — |
| **Slow mode** | ✅ | ❌ | — |
| **A'zoni cheklash/ban** | ✅ | ❌ | faqat `removedAt` |
| **@mention + autocomplete** | ✅ | ❌ | — |
| **Tizim xabarlari** ("X qo'shildi") | ✅ | ❌ | — |
| **Onlayn a'zolar soni** | ✅ | ❌ | — |
| **Egalikni topshirish** | ✅ | ❌ | `GROUP_CHAT_CANNOT_CHANGE_OWNER` |

### 3.4 Fayl turlari

| Tur | Telegram | Bilgim | Izoh |
|---|:---:|:---:|---|
| Rasm (jpg/png/webp/gif) | ✅ | ✅ | — |
| **HEIC / AVIF** | ✅ | ❌ | iPhone rasmlari rad etiladi |
| Video (mp4/mov/webm/mkv) | ✅ | ✅ | — |
| **avi / flv / wmv** | ✅ | ❌ | — |
| Audio | ✅ | ✅ | — |
| PDF / Word / Excel | ✅ | ✅ | — |
| **PowerPoint (ppt/pptx)** | ✅ | ❌ | o'quv platformasi uchun kritik! |
| **Arxiv (zip/rar/7z)** | ✅ | ❌ | — |
| **Matn (txt/csv/md/json)** | ✅ | ❌ | — |
| **Kod fayllari** | ✅ | ❌ | — |
| **Ixtiyoriy fayl (octet-stream)** | ✅ | ❌ | `OTHER: []` — hammasi rad etiladi |

---

## 4. Aniqlangan texnik muammolar (mavjud kodda)

| # | Muammo | Joy | Ta'sir |
|---|---|---|---|
| 1 | **N+1 so'rov** — har bir chat uchun alohida `count()` | `dm.service.ts:231`, `group-chat.service.ts:141` | 50 chatda 50+ query |
| 2 | **Cursor `createdAt` bo'yicha** — bir xil millisekundli xabarlar yo'qoladi/takrorlanadi | `dm.repository.ts:212` | ma'lumot yo'qolishi |
| 3 | **`markRead` har `messages.length` o'zgarganda** ishlaydi | `group-chat-thread.tsx:133` | ortiqcha PATCH so'rovlar |
| 4 | **Har bubble alohida 2 ta so'rov** yuboradi (`getAssetMetadata` + `getPlaybackUrl`) | `group-chat-thread.tsx:594` | 20 media = 40 so'rov |
| 5 | **Socket.io Redis adapter yo'q** | `live-chat.gateway.ts` | multi-pod'da broadcast ishlamaydi |
| 6 | **`refetchInterval: 30_000` polling** | ikkala thread komponentida | keraksiz yuk, kechikish |
| 7 | **Realtime `lessonId` hack orqali** — `dm:${id}` / `group:${id}` string | `live-chat.gateway.ts:289` | typing/read/reaction uchun kengaytirib bo'lmaydi |
| 8 | **Optimistic send yo'q** (faqat fayl uchun bor) | `group-chat-thread.tsx:313` | matn yuborilganda kechikish seziladi |
| 9 | **`clientMsgId` yo'q** → duplicate/lost xabar | ikkala service | tarmoq uzilganda takror yuborish |
| 10 | **Rasm to'liq hajmda yuklanadi** (thumbnail yo'q) | `group-chat-thread.tsx:686` | 5 MB rasm bubble uchun |
| 11 | **Xabar bildirishnomasi yo'q** | `NotificationKind` enum | offline foydalanuvchi bilmaydi |
| 12 | **Ikkita deyarli bir xil komponent** (930 + 815 qator) | `message-thread.tsx` / `group-chat-thread.tsx` | har o'zgarish 2 joyda |
| 13 | **Admin DM'da qatnasha olmaydi** | `dm.service.ts:557` | support chat imkonsiz |
| 14 | **O'qituvchi ↔ o'qituvchi DM taqiq** | `dm.service.ts:565` | hamkasblar yozisha olmaydi |

---

## 5. Manbalar

- [Telegram Bot API](https://core.telegram.org/bots/api) — xabar turlari va metodlar
- [Telegram Bot API changelog](https://core.telegram.org/bots/api-changelog)
- [Telegram APIs (core)](https://core.telegram.org/)
- [Telegram Supergroups Explained: Features, Limits](https://metricgram.com/blog/telegram-supergroups-explained)
- [How to Use Telegram Topics: Forum Mode Admin Guide](https://www.chainfuel.com/blog/how-to-use-telegram-topics-forum-mode-admin-guide)
- [Telegram Group Setup, Admins, Permissions, Privacy](https://iturrit.com/blog/how-to-make-telegram-group-chat-admins-permissions-privacy)
- [Telegram Group Limits and FAQ (2026)](https://metricgram.com/blog/telegram-group-limits-faq)
- [Reactions | grammY](https://grammy.dev/guide/reactions)
