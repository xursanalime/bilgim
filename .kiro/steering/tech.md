# Tech Stack

## Monorepo & tooling

- **Package manager:** pnpm 9 (workspaces). Node 20.
- **Build orchestration:** Turborepo (`turbo.json`). Tasks: `build`, `dev`, `lint`, `test`, `test:e2e`, `typecheck`.
- **Language:** TypeScript 5.5, strict mode everywhere. Shared config in `tsconfig.base.json` (`target ES2022`, `module NodeNext`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- **Formatting:** Prettier. **Linting:** ESLint 9.
- **Validation:** Zod for runtime schemas (env, DTOs, forms).

## Backend (`apps/api`)

- **Framework:** NestJS 10 (modular DI architecture).
- **ORM/DB:** Prisma 5 + PostgreSQL (with read-replica support). DB lives in `@bilgim/db`.
- **Cache/queues:** Redis (ioredis) + BullMQ for background jobs.
- **Realtime:** Socket.IO, LiveKit, mediasoup SFU for live video.
- **Auth/security:** JWT (`@nestjs/jwt`/passport-jwt), Argon2 hashing, WebAuthn (`@simplewebauthn`), TOTP MFA (otplib), helmet, DOMPurify/sanitize-html, field-level AES-256-GCM encryption.
- **Integrations:** Anthropic Claude SDK, AWS S3 / Cloudflare R2, nodemailer (email), Telegram bot.
- **API docs:** Swagger / OpenAPI generated via `scripts/generate-openapi.ts`.
- **Testing:** Jest + Supertest (e2e). Property-based testing with `fast-check` (`*.property.spec.ts`).

## Web (`apps/web`)

- **Framework:** Next.js 14 (App Router), React 18.
- **Styling:** Tailwind CSS + Radix UI primitives, `class-variance-authority`, `clsx`, `tailwind-merge`. Shared components in `@bilgim/ui`.
- **Data:** TanStack Query + SWR; Zustand for client state; react-hook-form + Zod.
- **i18n:** next-intl with `[locale]` routing (`@bilgim/i18n`).
- **Realtime/media:** socket.io-client, livekit/mediasoup clients, hls.js, tldraw, TipTap.
- **Testing:** Jest + Testing Library (jsdom).

## Mobile (`apps/mobile`)

- **Framework:** Expo (SDK 54) + React Native 0.81, expo-router, React Navigation, React 19.
- **Data:** TanStack Query, axios, react-hook-form + Zod, MMKV / AsyncStorage / SecureStore.

## Shared packages (`packages/*`)

`@bilgim/db` (Prisma), `@bilgim/shared-types`, `@bilgim/api-client` (generated), `@bilgim/ui`, `@bilgim/config`, `@bilgim/i18n`. Reference via workspace aliases (see `paths` in `tsconfig.base.json`).

## Common commands

Run from the repo root unless noted.

```bash
# Install
pnpm install

# Dev (all apps in parallel)
pnpm dev

# Build / lint / typecheck / test across the monorepo
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e

# Format
pnpm format          # write
pnpm format:check    # verify

# Database (Prisma, via @bilgim/db)
pnpm db:generate     # prisma generate
pnpm db:migrate      # prisma migrate dev
pnpm db:seed
pnpm db:studio

# OpenAPI + typed client regeneration
pnpm openapi:gen

# Local infra (Postgres/Redis via docker compose)
pnpm docker:up
pnpm docker:down
```

Target a single workspace with `pnpm --filter <name> <script>`, e.g. `pnpm --filter @bilgim/api test`.

## Environment

- Copy `.env.example` to `.env` and fill values. The API validates env via Zod (`apps/api/src/config/env.schema.ts`) and refuses to start on invalid/weak secrets.
- `JWT_SECRET` and `MASTER_ENCRYPTION_KEY` must meet the documented length/format requirements (≥32 bytes / base64 32-byte). Production refuses to start without them.

## Conventions

- Never commit secrets; keep them in `.env` (gitignored).
- Prefer Zod-validated input at boundaries; sanitize untrusted HTML.
- Add property-based tests (`fast-check`) for security- and correctness-critical logic, following existing `*.property.spec.ts` patterns.
- Do not start long-running dev servers/watchers in automation; run them manually.
