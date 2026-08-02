# @edubridge/api-client

Shared HTTP client for the EduBridge web and mobile apps.

This package wraps `fetch` with the conventions every EduBridge frontend
needs:

- `Bearer` access-token injection with auto-refresh on 401
- `{ error: { code, message, details, traceId } }` envelope unwrapping
- Concurrent-refresh deduplication (one in-flight `/auth/refresh` at a time)
- Per-request `AbortController` timeouts
- Pluggable `TokenStorageAdapter` so each platform can wire up its own
  persistence (cookies + localStorage on web, `expo-secure-store` on
  mobile, in-memory in tests)
- Typed endpoint groups (`auth`, `lessons`, `groups`, `homework`)

The package is **runtime-agnostic**: pure TypeScript, standard
`fetch`, no React Native, browser, or Node-only imports.

## Usage

```ts
import {
  createApiSdk,
  createLocalStorageAdapter,
} from '@edubridge/api-client';

const sdk = createApiSdk({
  baseUrl: process.env.NEXT_PUBLIC_API_URL!,
  storage: createLocalStorageAdapter(),
  onUnauthenticated: () => router.push('/login'),
});

// Typed endpoints
const tokens = await sdk.auth.login({ email, password });
const lessons = await sdk.lessons.listForGroup(groupId);

// Or use the bare client for endpoints not yet wrapped
const onboarding = await sdk.client.get<OnboardingState>('/onboarding/state');
```

### Storage adapters

The package ships three adapters out of the box:

| Adapter | Use case |
| --- | --- |
| `createMemoryStorage()` | Tests, SSR fallbacks, ephemeral sessions |
| `createLocalStorageAdapter()` | Browser (falls back to memory in SSR) |
| Custom `TokenStorageAdapter` | Anything else — implement `get/set/remove` |

For React Native, implement an adapter against `expo-secure-store`
(see `apps/mobile/lib/secure-storage.ts` for the canonical example).

### Storage keys

Tokens are persisted under stable, app-wide keys exported from
`StorageKeys`:

- `StorageKeys.ACCESS_TOKEN` (`edubridge_access_token`)
- `StorageKeys.REFRESH_TOKEN` (`edubridge_refresh_token`)
- `StorageKeys.USER` (`edubridge_user`)

### Error handling

Every non-2xx response is surfaced as `ApiClientError`:

```ts
import { ApiClientError } from '@edubridge/api-client';

try {
  await sdk.auth.login({ email, password });
} catch (err) {
  if (err instanceof ApiClientError && err.code === 'INVALID_CREDENTIALS') {
    // …
  }
}
```

Network failures are mapped to `code === 'NETWORK_ERROR'` and
`statusCode === 0` so callers can render a "check your connection" hint
without sniffing the underlying `TypeError`.

## Module layout

```
src/
├── client.ts        # Core ApiClient class + transport
├── endpoints/
│   ├── auth.ts      # /auth/* wrappers
│   ├── lessons.ts   # /catalog/* wrappers
│   ├── homework.ts  # /lessons/:id/assignments + /submissions/me
│   └── index.ts
├── errors.ts        # ApiClientError + envelope parser
├── jwt.ts           # decodeJwt + isJwtExpired (no signature verification)
├── sdk.ts           # createApiSdk convenience factory
├── storage.ts       # TokenStorageAdapter + default adapters
├── types.ts         # AuthTokens, AuthUser, RequestOptions, …
└── index.ts         # public entry — re-exports everything
```
