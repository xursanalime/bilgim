# Telegram uslubidagi xabarlar tizimi — Texnik dizayn

> [research.md](./research.md) — gap-tahlil va Telegram funksiyalari ro'yxati

---

## 1. Asosiy arxitektura qarori

Hozirgi `ChatRoom(scope, scopeRef)` modeli **saqlanadi**, lekin kengaytiriladi.
Bu big-bang migratsiyadan qochish imkonini beradi: mavjud DM/LIVE_SESSION
xonalari ishlashda davom etadi, guruh chati esa kurs `Group`idan **ajratiladi**.

**Eng muhim o'zgarish:** guruh chati endi `Group` (kurs kogortasi) bilan
majburiy 1:1 emas. `ChatRoom` o'zi guruhga aylanadi — nom, avatar, tavsif,
a'zolar, huquqlar hammasi `ChatRoom`da. Kurs guruhi esa shunchaki
`ChatRoom.linkedGroupId` orqali bog'langan, a'zolari enrollment'dan
avtomatik sinxronlanadigan maxsus holat.

```
                       ┌─────────────┐
                       │  ChatRoom   │  type: DM | GROUP | CHANNEL | LIVE_SESSION
                       └──────┬──────┘
                ┌─────────────┼──────────────┬──────────────┐
                │             │              │              │
         ┌──────▼─────┐ ┌─────▼──────┐ ┌────▼─────┐ ┌──────▼──────┐
         │ ChatMember │ │ChatMessage │ │ ChatPin  │ │ ChatInvite  │
         └────────────┘ └─────┬──────┘ └──────────┘ └─────────────┘
                        ┌─────┼───────────┬─────────────┐
                        │     │           │             │
              ┌─────────▼┐ ┌──▼────────┐ ┌▼──────────┐ ┌▼──────────────┐
              │Attachment│ │ Reaction  │ │ Deletion  │ │ ReadReceipt   │
              └──────────┘ └───────────┘ └───────────┘ └───────────────┘
```

---

## 2. Ma'lumotlar modeli

### 2.1 ChatRoom — kengaytirish

```prisma
enum ChatRoomType {
  DM
  GROUP
  CHANNEL         // kelajak: faqat admin yozadigan e'lonlar kanali
  LIVE_SESSION
  SAVED           // "Saqlangan xabarlar" — o'z-o'ziga chat
}

model ChatRoom {
  id        String       @id @default(uuid()) @db.Uuid
  type      ChatRoomType @default(DM)
  scope     String       // legacy — type bilan sinxron, migratsiyadan keyin o'chiriladi
  scopeRef  String

  // --- GROUP / CHANNEL uchun ---
  title          String?
  about          String?      @db.VarChar(500)
  avatarAssetId  String?      @db.Uuid
  ownerId        String?      @db.Uuid
  /// Kurs kogortasiga bog'langan avto-guruh (a'zolar enrollment'dan sinxronlanadi)
  linkedGroupId  String?      @unique @db.Uuid
  isPublic       Boolean      @default(false)
  publicSlug     String?      @unique

  // --- Boshqaruv ---
  slowModeSeconds    Int  @default(0)
  /// { canSendMessages, canSendMedia, canSendLinks, canAddMembers,
  ///   canPinMessages, canChangeInfo, canCreatePolls }
  defaultPermissions Json @default("{}")

  // --- Denormalizatsiya (inbox N+1 muammosini yechadi) ---
  lastMessageId  String?   @db.Uuid
  lastMessageAt  DateTime?
  lastSeq        BigInt    @default(0)   // monoton o'suvchi xabar raqami
  memberCount    Int       @default(0)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  members      ChatMember[]
  messages     ChatMessage[]
  invites      ChatInvite[]
  readReceipts DmReadReceipt[]          // legacy, ChatMember.lastReadSeq bilan almashtiriladi

  @@unique([scope, scopeRef])
  @@index([type, lastMessageAt])
}
```

> **`seq` nima uchun kerak?** Hozirgi cursor `createdAt` bo'yicha ishlaydi
> ([research.md §4](./research.md) #2). Bir xil millisekundda kelgan ikki
> xabar cursor'da yo'qoladi. `seq` — har bir xona ichida monoton o'suvchi
> `BigInt`. Pagination, "jump to message", "unread divider" va client-side
> sinxronizatsiya hammasi shunga tayanadi. Telegram ham xuddi shunday
> ishlaydi (per-chat `message_id`).

### 2.2 ChatMember — `GroupChatMember` o'rniga umumlashtirilgan

```prisma
enum ChatMemberRole { OWNER  ADMIN  MEMBER  RESTRICTED  BANNED }

model ChatMember {
  id     String @id @default(uuid()) @db.Uuid
  roomId String @db.Uuid
  room   ChatRoom @relation(fields: [roomId], references: [id], onDelete: Cascade)
  userId String @db.Uuid
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  role       ChatMemberRole @default(MEMBER)
  /// ADMIN uchun granular huquqlar; null = rolning standart to'plami
  permissions Json?

  joinedAt   DateTime  @default(now())
  invitedById String?  @db.Uuid
  removedAt  DateTime?
  /// RESTRICTED / BANNED uchun muddat
  restrictedUntil DateTime?

  // --- Har-foydalanuvchi chat holati ---
  lastReadSeq   BigInt    @default(0)
  unreadCount   Int       @default(0)
  mentionCount  Int       @default(0)
  mutedUntil    DateTime?          // null = ovozli; 9999-yil = abadiy
  pinnedAt      DateTime?          // chat ro'yxati tepasiga qadash
  archivedAt    DateTime?
  /// Yozib tugatilmagan matn — chat ro'yxatida "Qoralama: ..." bo'lib ko'rinadi
  draftText     String?
  draftReplyToId String?  @db.Uuid
  draftUpdatedAt DateTime?

  @@unique([roomId, userId])
  @@index([userId, pinnedAt, archivedAt])
  @@index([roomId, role])
}
```

### 2.3 ChatMessage — kengaytirish

```prisma
enum MessageType {
  TEXT  PHOTO  VIDEO  AUDIO  VOICE  DOCUMENT  ALBUM
  STICKER  POLL  LOCATION  CONTACT  SYSTEM
}

enum SystemEventType {
  MEMBER_JOINED  MEMBER_LEFT  MEMBER_ADDED  MEMBER_REMOVED
  ROLE_CHANGED   TITLE_CHANGED  PHOTO_CHANGED  MESSAGE_PINNED
  GROUP_CREATED  SLOW_MODE_CHANGED
}

model ChatMessage {
  id     String   @id @default(uuid()) @db.Uuid
  roomId String   @db.Uuid
  room   ChatRoom @relation(fields: [roomId], references: [id], onDelete: Cascade)
  /// Xona ichidagi monoton tartib raqami — pagination va sinxronizatsiya kaliti
  seq    BigInt

  authorId String @db.Uuid
  type     MessageType @default(TEXT)
  body     String
  /// Formatlash: [{ type:'bold', offset:0, length:5 }, { type:'mention', userId }]
  entities Json?

  // --- Reply ---
  replyToId String?      @db.Uuid
  replyTo   ChatMessage? @relation("MessageReply", fields: [replyToId], references: [id], onDelete: SetNull)
  replies   ChatMessage[] @relation("MessageReply")
  /// Telegram "quote" — javob berilayotgan xabarning tanlangan qismi
  quoteText String?

  // --- Forward ---
  forwardFromMessageId String? @db.Uuid
  forwardFromRoomId    String? @db.Uuid
  forwardFromUserId    String? @db.Uuid
  forwardSenderName    String?   // manba o'chirilgan/maxfiy bo'lsa

  // --- Albom (2–10 fayl bitta xabar sifatida) ---
  /// Bir xil `mediaGroupId`ga ega xabarlar UIda bitta grid sifatida ko'rsatiladi
  mediaGroupId String? @db.Uuid

  // --- Holat ---
  editedAt  DateTime?
  deletedAt DateTime?
  pinnedAt   DateTime?
  pinnedById String?  @db.Uuid

  // --- Tizim xabari ---
  systemEvent   SystemEventType?
  systemPayload Json?

  /// Klient tomonidan generatsiya qilingan UUID — idempotent yuborish,
  /// optimistic UI'ni real xabar bilan moslashtirish uchun
  clientMsgId String?

  createdAt DateTime @default(now())

  attachments  ChatAttachment[]
  reactions    MessageReaction[]
  deletions    MessageDeletion[]

  @@unique([roomId, seq])
  @@unique([roomId, clientMsgId])
  @@index([roomId, seq(sort: Desc)])
  @@index([roomId, type])           // "shared media" tab uchun
  @@index([replyToId])
}
```

**Legacy `assetId` ustuni** saqlanadi (nullable) va migratsiya paytida
`ChatAttachment` qatoriga ko'chiriladi, keyin o'chiriladi.

### 2.4 Yangi jadvallar

```prisma
/// Bitta xabarga N ta fayl — albom, ko'p fayl yuborish
model ChatAttachment {
  id        String      @id @default(uuid()) @db.Uuid
  messageId String      @db.Uuid
  message   ChatMessage @relation(fields: [messageId], references: [id], onDelete: Cascade)
  assetId   String      @db.Uuid
  asset     MediaAsset  @relation(fields: [assetId], references: [id])
  kind      MediaKind
  position  Int         @default(0)
  caption   String?
  /// Media metadata — UI'da placeholder o'lchamini oldindan bilish uchun
  width      Int?
  height     Int?
  durationMs Int?
  /// Kichraytirilgan preview R2 kaliti — to'liq faylni yuklamaslik uchun
  thumbKey   String?
  /// Blurhash / LQIP — yuklanguncha ko'rsatiladigan rangli plashka
  blurhash   String?
  /// Ovozli xabar to'lqin diagrammasi (0–100 oralig'idagi ~50 ta qiymat)
  waveform   Int[]

  @@index([messageId, position])
  @@index([assetId])
}

model MessageReaction {
  messageId String      @db.Uuid
  message   ChatMessage @relation(fields: [messageId], references: [id], onDelete: Cascade)
  userId    String      @db.Uuid
  emoji     String      @db.VarChar(16)
  createdAt DateTime    @default(now())

  @@id([messageId, userId, emoji])
  @@index([messageId])
}

/// "Menda o'chirish" — xabar boshqalarda qoladi
model MessageDeletion {
  messageId String      @db.Uuid
  message   ChatMessage @relation(fields: [messageId], references: [id], onDelete: Cascade)
  userId    String      @db.Uuid
  createdAt DateTime    @default(now())

  @@id([messageId, userId])
}

model ChatInvite {
  id          String    @id @default(uuid()) @db.Uuid
  roomId      String    @db.Uuid
  room        ChatRoom  @relation(fields: [roomId], references: [id], onDelete: Cascade)
  token       String    @unique
  createdById String    @db.Uuid
  title       String?
  expiresAt   DateTime?
  usesLimit   Int?
  usesCount   Int       @default(0)
  /// true = admin tasdiqlashi kerak
  requiresApproval Boolean @default(false)
  revokedAt   DateTime?
  createdAt   DateTime  @default(now())

  @@index([roomId, revokedAt])
}

model BlockedUser {
  blockerId String   @db.Uuid
  blockedId String   @db.Uuid
  createdAt DateTime @default(now())

  @@id([blockerId, blockedId])
  @@index([blockedId])
}
```

### 2.5 Migratsiya strategiyasi

1. **Additive migration** — barcha yangi ustun/jadvallar nullable/default bilan
2. **Backfill script**:
   - `ChatRoom.type` ← `scope` qiymatidan
   - `ChatRoom.lastMessageAt/lastSeq/memberCount` ← agregatdan
   - `ChatMessage.seq` ← `ROW_NUMBER() OVER (PARTITION BY roomId ORDER BY createdAt, id)`
   - `ChatMessage.assetId` → `ChatAttachment` qatori
   - `GroupChatMember` → `ChatMember` (roomId = `Group`ning ChatRoom'i)
   - `DmReadReceipt.lastReadAt` → `ChatMember.lastReadSeq` (eng yaqin seq)
3. **Dual-write davri** — eski API'lar ishlashda davom etadi
4. **Cleanup migration** — `scope`, `ChatMessage.assetId`, `GroupChatMember`,
   `DmReadReceipt` o'chiriladi

---

## 3. Realtime protokoli

### 3.1 Muammo

Hozir chat `/live` namespace'dan `lessonId: "dm:<id>"` / `"group:<id>"` string
hack orqali foydalanadi. Bu typing/read/reaction/edit hodisalari uchun
kengaytirilmaydi. Xabar HTTP orqali yuboriladi, socket faqat broadcast qiladi.

### 3.2 Yechim — mustaqil `/chat` namespace

**Fayl:** `apps/api/src/modules/chat/gateway/chat.gateway.ts`

```
Klient → Server                       Server → Klient
─────────────────────────────         ─────────────────────────────
chat:subscribe   { roomIds[] }        message:new       { roomId, message }
chat:unsubscribe { roomIds[] }        message:edited    { roomId, messageId, body, entities, editedAt }
chat:send        { roomId, clientMsgId,   message:deleted   { roomId, messageIds[], forEveryone }
                   text, entities,     message:reaction  { roomId, messageId, emoji, userId, added }
                   replyToId,          message:pinned    { roomId, messageId, pinned }
                   attachments[] }     chat:read         { roomId, userId, lastReadSeq }
chat:typing      { roomId, action }   chat:typing       { roomId, userId, action, expiresAt }
chat:read        { roomId, seq }      chat:updated      { roomId, patch }  // nom/avatar/a'zo
chat:react       { messageId, emoji } member:changed    { roomId, userId, role, removed }
                                      presence:update   { userId, online, lastSeenAt }
                                      chat:error        { code, message }
```

**Muhim qarorlar:**

- **Yuborish socket orqali**, HTTP fallback bilan. `clientMsgId` idempotentlikni
  ta'minlaydi — tarmoq uzilib qayta yuborilsa dublikat yaratmaydi
  (`@@unique([roomId, clientMsgId])`).
- **Ack pattern** — `chat:send` javob qaytaradi `{ ok, messageId, seq, createdAt }`,
  UI optimistic bubble'ni shu bilan almashtiradi.
- **`@socket.io/redis-adapter`** qo'shiladi — hozir adapter yo'q, ya'ni
  multi-pod'da `server.to(room).emit()` boshqa pod'dagi klientga yetmaydi.
- **Room nomlari**: `chat:{roomId}` (xona) va `user:{userId}` (shaxsiy —
  chat ro'yxati yangilanishi, presence uchun).

### 3.3 Presence va typing (Redis)

```
presence:user:{userId}   → SET "1" EX 60      // klient har 30s heartbeat yuboradi
presence:room:{roomId}   → SET a'zolar        // onlayn a'zolar soni uchun
typing:{roomId}:{userId} → SET action EX 6    // klient har 4s yangilaydi
```

- `lastSeenAt` — `User` jadvaliga ustun (throttled write, har 60s da bir marta)
- Maxfiylik: `UserSettings.showLastSeen` (hamma / kontaktlar / hech kim)

---

## 4. REST API

Yangi birlashgan `/chats` controller — `/dm` va `/group-chat` o'rniga
(eskilari deprecated bo'lib bir muddat qoladi).

| Metod | Yo'l | Vazifa |
|---|---|---|
| `GET` | `/chats` | Inbox: pinned → unread → oxirgi faollik; `?folder=all\|groups\|private\|unread` |
| `POST` | `/chats/private` | DM ochish `{ userId }` |
| `POST` | `/chats/group` | **Mustaqil guruh yaratish** `{ title, about?, memberIds[], avatarAssetId? }` |
| `GET` | `/chats/:id` | Chat ma'lumoti + mening a'zoligim |
| `PATCH` | `/chats/:id` | Nom/tavsif/avatar/slowMode/permissions |
| `DELETE` | `/chats/:id` | Chatni o'chirish / tarixni tozalash |
| `GET` | `/chats/:id/messages` | `?beforeSeq&afterSeq&aroundSeq&limit` — ikki tomonlama pagination |
| `POST` | `/chats/:id/messages` | Yuborish (socket fallback) |
| `PATCH` | `/chats/:id/messages/:mid` | Tahrirlash |
| `DELETE` | `/chats/:id/messages` | `{ ids[], forEveryone }` — ommaviy o'chirish |
| `POST` | `/chats/:id/messages/forward` | `{ fromRoomId, messageIds[] }` |
| `POST` | `/chats/:id/messages/:mid/pin` | Qadash / yechish |
| `PUT` | `/chats/:id/messages/:mid/reactions` | `{ emoji }` toggle |
| `GET` | `/chats/:id/media` | `?kind=PHOTO\|VIDEO\|DOCUMENT\|LINK` — shared media tab |
| `GET` | `/chats/:id/search` | Chat ichida qidiruv (`pg_trgm` — allaqachon yoqilgan) |
| `GET` | `/chats/search` | Global qidiruv: chat nomlari + xabar matnlari |
| `PATCH` | `/chats/:id/read` | `{ seq }` |
| `PATCH` | `/chats/:id/mute` | `{ untilAt \| null }` |
| `PATCH` | `/chats/:id/pin` | Chatni ro'yxatda qadash |
| `PUT` | `/chats/:id/draft` | Qoralama saqlash |
| `GET/POST/DELETE` | `/chats/:id/members[...]` | A'zolar CRUD + rol + cheklov |
| `POST` | `/chats/:id/invites` | Taklif havolasi yaratish |
| `POST` | `/chats/join/:token` | Havola orqali qo'shilish |
| `POST` | `/users/:id/block` | Bloklash |
| `POST` | `/media/assets/batch-urls` | **Ko'p asset uchun bitta so'rovda signed URL** |

> Oxirgi endpoint [research.md §4](./research.md) #4 muammosini yechadi —
> hozir har bubble alohida 2 ta so'rov yuboradi.

---

## 5. Media qatlami

### 5.1 MIME allowlist kengaytirish

```ts
// apps/api/src/modules/media/media.types.ts
IMAGE:  + image/heic, image/heif, image/avif, image/bmp, image/tiff
VIDEO:  + video/x-msvideo (avi), video/mpeg, video/3gpp, video/x-flv
AUDIO:  + audio/aac, audio/flac, audio/x-m4a, audio/opus
DOC:    + application/vnd.ms-powerpoint,
        + application/vnd.openxmlformats-officedocument.presentationml.presentation,
        + application/rtf, application/vnd.oasis.opendocument.*
OTHER:  + text/plain, text/csv, text/markdown, application/json,
        + application/zip, application/x-7z-compressed,
        + application/vnd.rar, application/x-tar, application/gzip,
        + application/octet-stream        ← "har xil turdagi fayl"
```

### 5.2 Xavfsizlik (ixtiyoriy fayl turi uchun)

`application/octet-stream` ruxsat berilishi bilan quyidagilar **majburiy**:

1. **`Content-Disposition: attachment`** — chatdagi hech qanday fayl brauzerda
   inline ochilmaydi (`.html`, `.svg` XSS vektorini yopadi)
2. **`X-Content-Type-Options: nosniff`** barcha media javoblarida
3. **Executable kengaytmalar bloklanadi**: `.exe .msi .bat .cmd .scr .com .pif
   .vbs .js .jar .apk .dmg .app .deb .rpm`
4. **AV-skanerlash hooki** — `AssetStatus.SCANNING` holati, ClamAV yoki
   Cloudflare tomonida; skanerdan o'tmagan fayl yuklab olinmaydi
5. **`svg+xml` — ruxsat berilmaydi** (yoki DOMPurify bilan tozalab, alohida
   sandbox domendan beriladi)
6. Chat attachment limiti: **2 GB** (hozir 1 GB)

### 5.3 Thumbnail pipeline

Mavjud `TranscodingService` (ffmpeg) kengaytiriladi:

| Manba | Natija |
|---|---|
| IMAGE | `thumb_320.webp`, `thumb_1280.webp` + blurhash |
| VIDEO | `poster.jpg` (1-soniya kadr) + `thumb_320.webp` + davomiylik + o'lcham |
| VOICE/AUDIO | waveform massivi (50 nuqta) + davomiylik |
| PDF | 1-sahifa preview `page1.webp` |

Klient tomoni: 2560px dan katta rasmlarni yuborishdan oldin canvas orqali
siqish (Telegram ham shunday qiladi) — `apps/web/lib/image-compress.ts`.

---

## 6. Frontend arxitekturasi

### 6.1 Komponent birlashtirish

Hozirgi `message-thread.tsx` (930) + `group-chat-thread.tsx` (815) —
deyarli bir xil kod, ikki nusxada. Yagona daraxtga birlashtiriladi:

```
apps/web/components/chat/
├── chat-layout.tsx            # 3 ustunli: ro'yxat | thread | info paneli
├── list/
│   ├── chat-list.tsx          # virtualizatsiyalangan, folder tab'lari bilan
│   ├── chat-list-item.tsx     # avatar, nom, oxirgi xabar, badge, ✓✓, mute, pin
│   ├── chat-folders.tsx       # Barchasi / Shaxsiy / Guruhlar / O'qilmagan
│   └── global-search.tsx      # chat + xabar + foydalanuvchi qidiruvi
├── thread/
│   ├── chat-thread.tsx        # DM va guruh uchun YAGONA komponent
│   ├── chat-header.tsx        # avatar, nom, "yozmoqda…", onlayn, menyu
│   ├── message-list.tsx       # virtual scroll + ikki tomonlama pagination
│   ├── date-divider.tsx       # "Bugun" / "Kecha" / "12-avgust"
│   ├── unread-divider.tsx     # "Yangi xabarlar"
│   ├── pinned-bar.tsx         # qadalgan xabar paneli
│   └── jump-to-bottom.tsx     # o'qilmagan soni bilan FAB
├── message/
│   ├── message-bubble.tsx     # guruhlash, ✓✓, edited, reply-preview
│   ├── message-context-menu.tsx  # Javob/Uzatish/Nusxa/Tahrir/Qadash/O'chirish
│   ├── reaction-bar.tsx       # hover'da tez reaksiya + hisoblagich
│   ├── reply-preview.tsx      # bubble ichidagi javob bloki, bosilsa sakraydi
│   ├── forward-header.tsx     # "X dan uzatildi"
│   └── media/
│       ├── album-grid.tsx     # 2–10 rasm/video mozaikasi
│       ├── image-message.tsx  # blurhash → thumb → to'liq
│       ├── video-message.tsx  # poster + inline player
│       ├── voice-message.tsx  # to'lqin + tezlik + progress
│       ├── file-message.tsx   # ikonka + nom + hajm + yuklab olish
│       └── link-preview.tsx
├── composer/
│   ├── message-composer.tsx   # autogrow, Enter/Shift+Enter, paste, drag&drop
│   ├── attach-menu.tsx        # Rasm / Video / Fayl / Ovozli / So'rovnoma
│   ├── emoji-picker.tsx
│   ├── mention-autocomplete.tsx  # @ bosilganda a'zolar ro'yxati
│   ├── reply-bar.tsx          # javob berilayotgan xabar
│   ├── edit-bar.tsx           # tahrirlanayotgan xabar
│   └── voice-recorder.tsx     # bosib turib yozish
├── panel/                     # o'ng info paneli
│   ├── chat-info-panel.tsx
│   ├── member-list.tsx        # qidiruv, rol belgisi, kontekst menyu
│   ├── shared-media-tabs.tsx  # Media / Fayllar / Havolalar / Ovoz
│   ├── permissions-editor.tsx
│   └── invite-link-panel.tsx  # QR kod bilan
└── dialogs/
    ├── new-chat-dialog.tsx
    ├── create-group-dialog.tsx    # nom + avatar + a'zo tanlash
    └── forward-dialog.tsx         # qaysi chatga uzatish
```

### 6.2 Holat boshqaruvi

- **TanStack Query** `useInfiniteQuery` bilan xabarlar (seq cursor)
- Socket hodisalari `queryClient.setQueryData` orqali cache'ga yoziladi
  (`refetchInterval` polling **butunlay olib tashlanadi**)
- **Virtual scroll**: `@tanstack/react-virtual` — 10 000+ xabarli chat uchun
- **Optimistic send**: `clientMsgId` bilan darhol bubble chiziladi,
  ack kelganda haqiqiy `id`/`seq` bilan almashtiriladi, xato bo'lsa
  "qayta yuborish" tugmasi
- **IndexedDB cache** (P2) — oflayn tarix va tez ochilish

### 6.3 Klaviatura va mobil

| Amal | Klaviatura | Mobil |
|---|---|---|
| Yuborish | `Enter` | Send tugmasi |
| Yangi qator | `Shift+Enter` | — |
| Javob | `R` (hover'da) | Chapga swipe |
| Tahrir (oxirgi) | `↑` | Uzoq bosish → menyu |
| Qidiruv | `Ctrl/⌘+F` | Header'dagi qidiruv |
| Chatlar orasida | `Ctrl+↑/↓` | — |
| Bekor qilish | `Esc` | Orqaga |

---

## 7. Bildirishnomalar

```prisma
enum NotificationKind {
  // ... mavjudlari
  MESSAGE_RECEIVED     // yangi DM/guruh xabari
  MESSAGE_MENTION      // @mention yoki reply
  CHAT_INVITED         // guruhga taklif
}
```

**Yuborish qoidalari:**
1. Foydalanuvchi socket orqali **onlayn** bo'lsa → push yuborilmaydi
2. `ChatMember.mutedUntil` faol bo'lsa → yuborilmaydi (mention bundan mustasno)
3. Guruh xabarlari **debounce** qilinadi (5 daqiqada 1 ta yig'ma push:
   "IELTS guruhida 12 ta yangi xabar")
4. In-app: brauzer tab sarlavhasida `(3) Bilgim`, favicon badge, ovoz

---

## 8. Xavfsizlik va cheklovlar

| Qoida | Qiymat | Sabab |
|---|---|---|
| Xabar uzunligi | 4096 belgi | Telegram bilan bir xil |
| Caption uzunligi | 1024 belgi | — |
| Guruh a'zolari | 500 (MVP) | Kurs kogortasi uchun yetarli |
| Albom hajmi | 10 fayl | Telegram limiti |
| Fayl hajmi | 2 GB | — |
| Yuborish tezligi | 30/daqiqa (user), 5/sek (socket) | mavjud limitlar saqlanadi |
| Slow mode | 0–3600 sek | guruh admini belgilaydi |
| Tahrirlash oynasi | 48 soat | Telegram: 48 soat |
| "Hamma uchun o'chirish" | cheksiz (o'z xabari) | admin — istalgan xabarni |
| Reaksiya | 1 foydalanuvchi × 3 emoji | — |

**DM ruxsat qoidalari — o'zgartirish taklifi:**

Hozir `dm.service.ts` da: ADMIN umuman DM yoza olmaydi, TEACHER↔TEACHER taqiq.
Bu Telegram modeliga ziddir va support/hamkasblik ssenariylarini bloklaydi.

| Juftlik | Hozir | Taklif |
|---|---|---|
| STUDENT ↔ STUDENT | ✅ | ✅ |
| STUDENT ↔ TEACHER | ✅ (ochiq profil yoki enrollment) | ✅ shu qoida saqlanadi |
| TEACHER ↔ TEACHER | ❌ | ✅ ruxsat |
| ADMIN ↔ har kim | ❌ | ✅ ruxsat (support chat) |
| Bloklangan foydalanuvchi | — | ❌ `BlockedUser` tekshiruvi |

> Bu qaror mahsulot darajasida tasdiqlanishi kerak — texnik to'siq yo'q.

---

## 9. Ishlash (performance) byudjeti

| Ko'rsatkich | Maqsad |
|---|---|
| Inbox yuklanishi (50 chat) | < 150 ms, **1 ta SQL so'rov** |
| Xabarlar sahifasi (50 ta) | < 100 ms |
| Xabar yuborish → ekranda | < 50 ms (optimistic) |
| Xabar → qabul qiluvchi ekranida | < 300 ms (socket) |
| 10 000 xabarli chat scroll | 60 fps (virtualizatsiya) |
| Chat ochilishi (media bilan) | 1 ta batch URL so'rovi |

**N+1 yechimi:** `ChatRoom.lastMessageAt/lastSeq` + `ChatMember.unreadCount`
denormalizatsiyasi tufayli inbox bitta `JOIN` bilan olinadi — hozirgi
har-chat-uchun-`count()` sikli butunlay yo'qoladi.
