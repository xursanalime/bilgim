# @edubridge/mobile

EduBridge React Native (Expo SDK 51) mobil ilovasi. Phase 8 (`task 22`)
da fan-out qilinadi: live darslar, push notifications, offline lesson
cache. Hozirgi skeleton funksional auth flow (login + register +
verify-email), bottom-tab navigation va 4 ta placeholder ekrandan
iborat.

## Stack

- **Expo SDK 51** + **expo-router** (file-based routing built on
  `@react-navigation/native` + `@react-navigation/native-stack`)
- **TypeScript** strict (root `tsconfig.base.json` ga qaraydi)
- **`@edubridge/api-client`** — workspace ichidagi shared HTTP client
  (web va mobile uchun bitta transport, refresh dedup, error envelope)
- **`@edubridge/i18n`** — uz / ru / en lokalizatsiya bundle (web bilan
  bir xil)
- **@tanstack/react-query** — server state
- **react-hook-form** + **zod** — forms va validation
- **expo-secure-store** + **@react-native-async-storage/async-storage** —
  token persistence (Keychain / Keystore on native, AsyncStorage on web)
- **expo-constants** — bundle paytida `EXPO_PUBLIC_API_URL` ni o'qish
  (release fallback)
- **expo-notifications** — push permission, token registration,
  foreground / tap handlers (Task 22.2)
- **expo-device** — `modelName` / `osVersion` metadata for the push
  device registry
- **expo-sqlite** — offline lesson cache with TTL + LRU eviction
  (Task 22.2)
- **expo-task-manager** + **expo-background-fetch** — periodic 15-min
  background sync of notifications + recent lessons (Task 22.2)
- **@react-native-community/netinfo** — connectivity state for
  retry / offline UX
- **expo-splash-screen** — splash screen lifecycle
- **react-native-safe-area-context** — safe area insets
- **react-native-mmkv** — high-perf KV store (held for hot-path caches)

## Skriptlar

```bash
pnpm --filter @edubridge/mobile dev         # = expo start
pnpm --filter @edubridge/mobile start       # = expo start
pnpm --filter @edubridge/mobile ios         # iOS simulator
pnpm --filter @edubridge/mobile android     # Android emulator
pnpm --filter @edubridge/mobile web         # Browserda preview
pnpm --filter @edubridge/mobile typecheck   # tsc --noEmit
```

## Birinchi sozlash

Bu paket monorepo da yashaydi va `pnpm install` orqali boshqa workspace
paketlari bilan birga o'rnatiladi.

```bash
# Loyiha root dan:
pnpm install

# Mobil app ni ishga tushirish:
pnpm --filter @edubridge/mobile dev
```

Fizik qurilmada sinash uchun [Expo Go](https://expo.dev/client) ni o'rnating
va `dev` server ko'rsatadigan QR kodni skanerlang.

## Environment variables

Faqat `EXPO_PUBLIC_*` prefiksli o'zgaruvchilar mobil bundle ga kiritiladi.
Sirlar (DB URL, JWT secret, va h.k.) bu yerga qo'yilmaydi.

| Key | Default | Tavsifi |
| --- | --- | --- |
| `EXPO_PUBLIC_API_URL` | `http://localhost:4000` | NestJS API root (the client appends `/api/v1`). |
| `EXPO_PUBLIC_LOCALE` | `uz` | Active locale override for dev / E2E (one of `uz`, `ru`, `en`). |

`.env.example` dan nusxa olib `.env.local` yarating:

```bash
cp apps/mobile/.env.example apps/mobile/.env.local
```

> **Diqqat**: emulyatordan localhost ga ulanish uchun:
>
> - **Android emulator**: `http://10.0.2.2:4000`
> - **iOS simulator**: `http://localhost:4000`
> - **Fizik qurilma**: kompyuteringizning LAN IP si, masalan
>   `http://192.168.1.10:4000`

## Loyiha tuzilishi

```
apps/mobile/
├── App.tsx                    # Reference root (NavigationContainer + Stack); production
│                              #   entry is `expo-router/entry` via package.json#main
├── app/                       # expo-router (file-based)
│   ├── _layout.tsx            # Root: QueryClient + AuthProvider + auth guard + splash
│   ├── (auth)/
│   │   ├── _layout.tsx        # Stack
│   │   ├── login.tsx          # POST /auth/login (RHF + zod)
│   │   ├── register.tsx       # POST /auth/register (RHF + zod)
│   │   └── verify-email.tsx   # POST /auth/verify-email (deep-link)
│   └── (tabs)/
│       ├── _layout.tsx        # Bottom tab nav (Dashboard / Lessons / Homework / Profile)
│       ├── index.tsx          # Dashboard (Bosh sahifa)
│       ├── lessons.tsx        # Darslar (lessons placeholder)
│       ├── homework.tsx       # Vazifalar (homework placeholder)
│       └── profile.tsx        # Profil + Logout
├── components/
│   └── ui/
│       ├── Button.tsx         # primary/secondary/ghost/danger variantlar
│       └── Input.tsx          # labelled text input + error state
├── lib/
│   ├── api.ts                 # Public API surface (re-exports apiClient + sdk + auth helpers)
│   ├── api-client.ts          # @edubridge/api-client SDK instance + storage adapter wiring
│   ├── api/
│   │   └── auth.ts            # Typed login / register / me wrappers (Result envelope)
│   ├── auth.ts                # Token + JWT helpers (delegate to SDK)
│   ├── auth-context.tsx       # React context: user / login / register / logout
│   ├── auth-errors.ts         # Backend error code → friendly Uzbek matn
│   ├── cache/                 # Offline lesson cache (Task 22.2)
│   │   ├── db.ts              # SQLite schema + connection (cached_lessons table)
│   │   ├── lessons-cache.ts   # Write-through cache, TTL + LRU eviction (200MB cap)
│   │   └── index.ts
│   ├── i18n.ts                # uz/ru/en messages + t() helper
│   ├── notifications/         # Push notifications (Task 22.2)
│   │   ├── permissions.ts     # ensureNotificationPermissions + Android channel
│   │   ├── token.ts           # getExpoPushToken + register/unregister with backend
│   │   ├── handler.ts         # Foreground handler + tap-to-deep-link router
│   │   ├── bootstrap.ts       # One-shot startup orchestration
│   │   └── index.ts
│   ├── secure-storage.ts      # TokenStorageAdapter: SecureStore (native) / AsyncStorage (web)
│   └── sync/                  # Background sync (Task 22.2)
│       ├── run-sync.ts        # Refresh notifications + recent lessons
│       ├── background-task.ts # expo-task-manager + expo-background-fetch (15-min)
│       └── index.ts
├── services/                  # Domain services (Task 22.2)
│   ├── lessons.ts             # Network-first lesson detail with SQLite fallback
│   └── notifications.ts       # /notifications inbox helpers
├── theme/
│   └── colors.ts              # Dark/cream palette + spacing + typography
├── app.json                   # Expo config (name, slug, scheme, splash)
├── app.config.ts              # Dynamic config — exposes EXPO_PUBLIC_API_URL
├── babel.config.js
├── metro.config.js            # Monorepo Metro config (watchFolders + nodeModulesPaths)
├── .env                       # Local env (gitignored — `EXPO_PUBLIC_API_URL`)
├── .env.example               # Committed template for new contributors
├── tsconfig.json
└── package.json
```

## Auth flow

1. `app/(auth)/login.tsx` ni RHF + zod orqali email + parol yig'adi.
2. `useAuth().login(email, password)` `sdk.auth.login()` ni chaqiradi
   (shared `@edubridge/api-client`). U `POST /api/v1/auth/login` ga
   so'rov yuboradi va token + user blob ni `expo-secure-store`'ga
   yozadi.
3. `lib/auth-context.tsx` foydalanuvchini context state'iga qo'yadi va
   root layoutdagi auth guard `/(tabs)` ga redirect qiladi.
4. Backend xato qaytarsa (`ACCOUNT_NOT_VERIFIED`, `UNAUTHENTICATED`,
   `RATE_LIMITED`, va h.k.), `lib/auth-errors.ts` kod ni o'zbekcha
   matnga aylantiradi va `Alert` orqali ko'rsatiladi.

`@edubridge/api-client` 401 javobida bitta `POST /auth/refresh`
urinishi bilan retry qiladi va concurrent refreshlarni bitta promise
ga deduplicate qiladi — login screen va `useAuth` bir-biriga aralashib,
refresh token'ni ortiqcha sarflamaydi.

### Verify-email deep link

`app.json#scheme = edubridge` orqali backend mailida yuborilgan
`https://edubridge.uz/uz/verify-email?token=…` URL ga `edubridge://verify-email?token=…`
mos keladi. expo-router `app/(auth)/verify-email.tsx` ekraniga
yo'naltiradi va token bilan `POST /auth/verify-email` ni chaqiradi.

## Theme

`theme/colors.ts` faylidagi palette web ilova bilan bir xil:

| Token | Hex | Foydalanish |
| --- | --- | --- |
| `colors.ink` | `#080C10` | Page background |
| `colors.inkSurface` | `#0D1F36` | Card / tab bar background |
| `colors.inkLine` | `rgba(255,255,255,0.07)` | Hairline border |
| `colors.accent` | `#00E87A` | Primary action / focus ring |
| `colors.cream` | `#F5F2EC` | Foreground text |
| `colors.creamDim` | `#8892A4` | Muted secondary text |

## Cheklovlar (Phase 8 davomida bajariladi)

- Birlik testlari — Jest + React Native Testing Library (task 22.3)

## Certificate pinning (Task 28.4, Req 28.9)

Production builds **must** pin the SHA-256 hashes of the
`edubridge.uz` leaf certificate's SubjectPublicKeyInfo (SPKI) so a
rogue or coerced CA cannot serve traffic to the app.

Configs live under `apps/mobile/security/`:

- `network-security-config.xml` — Android (referenced from
  `AndroidManifest.xml` via `android:networkSecurityConfig`).
- `ats-info.plist.snippet` — iOS (App Transport Security + TrustKit).

### Generating the pins

```bash
openssl s_client -servername edubridge.uz -connect edubridge.uz:443 \
  </dev/null 2>/dev/null \
  | openssl x509 -pubkey -noout \
  | openssl pkey -pubin -outform DER \
  | openssl dgst -sha256 -binary \
  | openssl enc -base64
```

Always pin TWO hashes — the active leaf cert AND a backup. When the
active cert is renewed, ship a release with `[new-active,
new-backup]` BEFORE the old cert expires.

### Applying the configs to the native projects

Expo regenerates the native projects on every `expo prebuild`, so the
pins must be applied via a config plugin (recommended) or by patching
the generated files post-prebuild.

**Option 1 — config plugin (recommended).** Create
`apps/mobile/plugins/with-cert-pinning.ts` that:

1. Copies `apps/mobile/security/network-security-config.xml` into
   `android/app/src/main/res/xml/network_security_config.xml`.
2. Sets
   `android:networkSecurityConfig="@xml/network_security_config"` on
   `<application>` in `AndroidManifest.xml`.
3. Merges the `apps/mobile/security/ats-info.plist.snippet` keys
   into `ios/<AppName>/Info.plist` via `IOSConfig.Plist.modifyInfoPlist`.

Reference the plugin in `app.config.ts`:

```ts
plugins: [
  // ...existing plugins
  './plugins/with-cert-pinning',
],
```

Then `pnpm --filter @edubridge/mobile expo prebuild --clean` rolls
the configs into the native projects.

**Option 2 — manual post-prebuild patch.** After every prebuild:

```bash
cp apps/mobile/security/network-security-config.xml \
   apps/mobile/android/app/src/main/res/xml/network_security_config.xml
# then add to AndroidManifest.xml <application>:
#   android:networkSecurityConfig="@xml/network_security_config"
```

For iOS, paste the `ats-info.plist.snippet` keys into
`apps/mobile/ios/<AppName>/Info.plist` and install the TrustKit pod
in `apps/mobile/ios/Podfile`:

```ruby
pod 'TrustKit', '~> 3.0'
```

### Dev / debug builds

- The Android `network-security-config.xml` includes a
  `<debug-overrides>` block that accepts user-installed CAs in debug
  builds — release builds ignore the block entirely so charles-style
  debugging proxies don't bypass production pinning.
- The iOS snippet leaves debug builds at the default ATS posture so
  the dev workflow keeps working.

## Push notifications + offline cache (Task 22.2)

Implementatsiya `app/_layout.tsx` ichidagi `RootNavigator` effekti
orqali ishga tushadi: foydalanuvchi tizimga kirgach, biz ketma-ket:

1. **SQLite cache**ni ochamiz (`lib/cache/db.ts`) — `cached_lessons`
   jadvali splash screen ichida tayyorlanadi (har qanday darsni tekkanda
   migratsiya kutmaslik uchun).
2. **Push permission** so'raymiz va Android default kanalini sozlaymiz
   (`lib/notifications/permissions.ts`).
3. **Expo push token**ni olamiz (`lib/notifications/token.ts`) va
   `POST /notifications/devices` ga jo'natamiz. Token
   `expo-secure-store` ichida `edubridge_push_token` kalitida saqlanadi.
4. **Foreground handler + tap router**ni o'rnatamiz
   (`lib/notifications/handler.ts`). Bildirishnomaning
   `data.kind` ga qarab `expo-router` orqali tegishli ekranga deep-link
   qilamiz.
5. **Background sync**ni ro'yxatga olamiz
   (`lib/sync/background-task.ts`) — har 15 daqiqada
   `runSyncOnce()` chaqirilib, notifications inbox + so'nggi 10 ta
   lesson detail yangilanadi.

Chiqishda (`logout`) `unregisterExpoPushToken()` chaqirilib backendga
`DELETE /notifications/devices/:token` yuboriladi va
`unregisterBackgroundSync()` periodic taskni o'chiradi.

### Offline lesson viewing

`services/lessons.ts` — network-first wrapper around
`sdk.lessons.get(id)`:

- **Online**: API javobini olib `cached_lessons` jadvaliga yozadi
  (write-through). TTL = 7 kun.
- **Offline / 5xx**: SQLite ni o'qib, mavjud bo'lsa cached versiyani
  qaytaradi (`fromCache: true`, `isStale` agar TTL o'tgan bo'lsa).
- **Cache miss + network down**: orginal xato qayta otiladi.

Eviction:

- TTL: har `putCachedLesson` chaqirig'ida muddati o'tgan rowlar
  o'chiriladi.
- LRU: agar umumiy hajm 200 MB dan oshsa, eng eski `accessedAt` bo'yicha
  rowlar drop qilinadi.

### Backend integration

- Yangi route: `POST /notifications/devices` va `DELETE
  /notifications/devices/:token`
  (`apps/api/src/modules/notifications/notifications.controller.ts`).
- Yangi Prisma model: `PushDevice`
  (`packages/db/prisma/schema.prisma`, migratsiya
  `20260529000000_task_22_2_push_devices`).
- Yangilangan worker: `PushProcessor` endi `expo-server-sdk`siz Expo
  Push API ga POST qiladi va `DeviceNotRegistered` hodisalarida
  `PushDevice.revokedAt`ni o'rnatadi.
