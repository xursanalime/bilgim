// ═════════════════════════════════════════════════════════════════
// Sentry — browser/client runtime init.
//
// Infra-readiness only: there is no real Sentry account/org wired up yet.
// `NEXT_PUBLIC_SENTRY_DSN` is unset by default (see /.env.example), and
// passing `dsn: undefined` to `Sentry.init` is documented, safe no-op
// behavior — the SDK disables all reporting/network activity without
// throwing. Do NOT assume monitoring is "live" just because this file
// exists; check that the DSN env var is actually set in the target
// environment first.
// ═════════════════════════════════════════════════════════════════

import * as Sentry from '@sentry/nextjs';

// `exactOptionalPropertyTypes` (tsconfig.base.json) forbids explicitly
// assigning `undefined` to an optional property — omit the `dsn` key
// entirely when unset rather than passing `dsn: undefined`.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  ...(dsn ? { dsn } : {}),
  // Fraction of transactions to capture for performance tracing. Kept low
  // to bound overhead/cost once a real DSN is configured.
  tracesSampleRate: 0.1,
  // Keep noise down in local dev even if a DSN is ever set accidentally.
  enabled: process.env.NODE_ENV === 'production',
});
