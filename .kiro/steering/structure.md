# Project Structure

pnpm + Turborepo monorepo. Workspaces are defined in `pnpm-workspace.yaml`: `apps/*`, `packages/*`, `infra/*`.

```
bilgim/
├── apps/
│   ├── api/        NestJS backend
│   ├── web/        Next.js (App Router) web app
│   └── mobile/     Expo / React Native app
├── packages/       Shared, versioned workspace packages
├── infra/          Docker, k8s, Cloudflare, security configs
├── docs/           Architecture docs
├── scripts/        Repo-level scripts (load tests, dev helpers)
├── .kiro/          Specs, steering, hooks, settings
├── turbo.json      Task pipeline
├── tsconfig.base.json  Shared TS config + workspace path aliases
└── pnpm-workspace.yaml
```

## API (`apps/api/src`)

NestJS modular layout. Each feature is a self-contained module.

```
src/
├── main.ts              Bootstrap (helmet, CORS, body limits, timeouts)
├── app.module.ts        Root module wiring
├── config/              Env schema (Zod) + config module
├── common/              Cross-cutting concerns:
│   ├── auth/ guards/ decorators/ pipes/ filters/ interceptors/
│   ├── crypto/ security/ sanitization/ observability/
├── infra/               Infrastructure adapters:
│   └── prisma/ redis/ cache/ bullmq/ outbox/ r2/ metrics/ sentry/
├── health/              Health/readiness endpoints
└── modules/             Domain features (auth, users, catalog, enrollment,
                         homework, live, live-stream, media, billing, ai,
                         dm, notifications, gamification, schedule, teacher,
                         discovery, mfa, reports, admin, security,
                         threat-protection)
```

### Module conventions

A typical module contains:
- `*.module.ts` — NestJS module definition (providers, imports, exports).
- `*.controller.ts` — HTTP routes (thin; delegate to services).
- `*.service.ts` — business logic.
- `dto/` — request/response DTOs (validated with Zod).
- `repositories/` — data access wrappers over Prisma.
- `strategies/` — passport strategies (auth).
- Tests colocated: `*.spec.ts` (unit), `*.property.spec.ts` (fast-check), e2e under `test/`.

## Web (`apps/web`)

```
app/
├── [locale]/        Localized routes (next-intl)
├── api/             Route handlers
├── layout.tsx  page.tsx  globals.css
components/          Feature-grouped UI (auth, dashboard, lesson, live, ...)
  └── ui/            Reusable primitives (shadcn/Radix style)
hooks/               Reusable React hooks (use-*.ts)
lib/                 API clients, auth, sockets, utils, validation
middleware.ts        i18n / auth middleware
```

Conventions: server-side helpers live in `lib/server-*.ts`; client API wrappers in `lib/*-api.ts`. Hooks are named `use-*.ts`.

## Shared packages (`packages/`)

- `db/` — Prisma schema, client, migrations, seed (`@bilgim/db`).
- `shared-types/` — types shared across apps.
- `api-client/` — generated typed client from the OpenAPI spec.
- `ui/` — shared React component library.
- `config/` — shared config/constants.
- `i18n/` — translations and locale config.

Import via aliases (`@bilgim/db`, `@bilgim/ui`, etc.), not relative paths across packages.

## Conventions

- Keep features modular and mirror the same feature name across API modules, web components, and specs where applicable.
- Place new backend functionality inside `apps/api/src/modules/<feature>/`; reuse `common/` and `infra/` rather than duplicating cross-cutting code.
- Specs for in-progress work live under `.kiro/specs/<feature>/` (requirements, design, tasks).
