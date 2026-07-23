import { Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

import { maybeAttachSlowQueryMiddleware } from './slow-query.middleware';
import {
  createPrismaEncryptionExtension,
  DEFAULT_ENCRYPTED_FIELDS,
  EncryptedFieldMap,
  EncryptionService,
} from '../../common/crypto';

/**
 * Default `connection_limit` applied to the Prisma engine when the
 * caller has not encoded one in `DATABASE_URL`. Prisma's own default
 * is `num_physical_cpus * 2 + 1`, which is fine on a beefy box but
 * tends to over-provision in containerised dev / staging where each
 * service is colocated with PgBouncer or a small Postgres instance.
 *
 * Operators can override at runtime via the `PRISMA_CONNECTION_LIMIT`
 * env var (preferred) or by encoding `?connection_limit=N` directly
 * into `DATABASE_URL`.
 */
const DEFAULT_CONNECTION_LIMIT = 10;

/**
 * Threshold above which a query is logged as "slow" by the global
 * `query` listener. 500ms matches the design.md API budget
 * (p95 < 250ms with comfortable headroom for outliers).
 */
const SLOW_QUERY_THRESHOLD_MS = 500;

const logger = new Logger('Prisma');

/**
 * Build the Prisma datasource URL, ensuring a `connection_limit` is
 * always present. We never *override* an operator-supplied value — if
 * the URL already encodes `connection_limit`, we leave it alone so a
 * production tuning can pick a value other than the default.
 *
 * Returns the original URL when parsing fails (e.g. the caller passed
 * a sentinel string in tests). Connection-pool tuning is best-effort.
 */
function applyConnectionLimit(
  rawUrl: string,
  connectionLimit: number,
): string {
  try {
    const url = new URL(rawUrl);
    if (!url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', String(connectionLimit));
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

/**
 * Resolve the desired connection limit for this process.
 *
 * Order of precedence:
 *   1. Explicit `connectionLimit` argument from a module factory.
 *   2. `PRISMA_CONNECTION_LIMIT` env var (so ops can tune without a
 *      code change).
 *   3. {@link DEFAULT_CONNECTION_LIMIT}.
 */
function resolveConnectionLimit(explicit?: number): number {
  if (explicit && Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit);
  }
  const fromEnv = Number(process.env.PRISMA_CONNECTION_LIMIT);
  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    return Math.floor(fromEnv);
  }
  return DEFAULT_CONNECTION_LIMIT;
}

/**
 * Strip every literal value from a SQL fragment so the slow-query log
 * doesn't accidentally leak PII (email addresses, tokens, names…).
 *
 * The redactor is intentionally conservative: any quoted string or
 * numeric token becomes `?`. We can't run the SQL through a parser at
 * runtime — the logger has to be cheap — so we lean on a few regexes
 * tuned for Postgres syntax.
 */
function redactSqlLiterals(raw: string): string {
  if (!raw) return raw;
  return (
    raw
      // single-quoted strings — handles escaped quotes via the lazy match
      .replace(/'(?:[^']|'')*'/g, "'?'")
      // dollar-quoted strings ($$...$$ or $tag$...$tag$)
      .replace(/\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1\$/g, '$?$')
      // numeric literals (avoid touching column names / aliases by
      // requiring a non-word character on either side)
      .replace(/(^|[^\w])(-?\d+(?:\.\d+)?)(?=$|[^\w])/g, '$1?')
  );
}

export interface CreatePrismaClientOptions {
  /**
   * Override `DATABASE_URL` with a different connection string. Used
   * by the discovery module to point at a read-replica.
   */
  datasourceUrl?: string;
  /** Explicit connection-pool size (see {@link resolveConnectionLimit}). */
  connectionLimit?: number;
  /**
   * Disable the slow-query logger (e.g. in unit tests where ts-jest
   * boots `PrismaClient` against a stub). Defaults to `true`.
   */
  enableSlowQueryLog?: boolean;
  /**
   * When supplied, the returned client is wrapped with the
   * {@link createPrismaEncryptionExtension} integration so writes to
   * `User.phone` / `PaymeTransaction.account` (and any other field in
   * `encryptedFields`) are auto-encrypted, and reads are
   * auto-decrypted. Pass `null` to explicitly disable even when the
   * caller has an `EncryptionService` available (e.g. raw migration
   * scripts).
   *
   * Task 28.1, Req 21.8, 28.1, 28.3.
   */
  encryption?:
    | {
        service: EncryptionService;
        fields?: EncryptedFieldMap;
      }
    | null;
}

/**
 * Build a `PrismaClient` with the Bilgim defaults applied:
 *   * `connection_limit` injected into the datasource URL.
 *   * `query` event channel forwarded to a slow-query listener that
 *     prints redacted SQL for anything taking >500ms.
 *
 * Every NestJS module that owns a Prisma client routes through this
 * helper so a single tweak (pool size, logging threshold, …) propagates
 * across the API surface without touching every `*.module.ts`.
 *
 * Requirements: 20.1, 20.7, 26 (observability)
 */
export function createPrismaClient(
  options: CreatePrismaClientOptions = {},
): PrismaClient {
  const enableSlowQueryLog = options.enableSlowQueryLog ?? true;
  const connectionLimit = resolveConnectionLimit(options.connectionLimit);

  const sourceUrl =
    options.datasourceUrl ??
    process.env.DATABASE_URL ??
    'postgresql://localhost:5432/edubridge';
  const tunedUrl = applyConnectionLimit(sourceUrl, connectionLimit);

  // Casting is required because the typed event union depends on the
  // log array literal. We emit `query` as an event so the listener
  // below receives the structured payload (duration, params, …).
  const client = new PrismaClient({
    datasources: { db: { url: tunedUrl } },
    log: enableSlowQueryLog
      ? [{ level: 'query', emit: 'event' }]
      : undefined,
  } as any);

  if (enableSlowQueryLog) {
    // Cast keeps us decoupled from the generated typed `$on` overload —
    // some Prisma versions require explicit `'query'` literal narrowing.
    (client as any).$on('query', (event: Prisma.QueryEvent) => {
      if (event.duration < SLOW_QUERY_THRESHOLD_MS) return;
      logger.warn({
        message: 'Slow query detected',
        durationMs: event.duration,
        query: redactSqlLiterals(event.query),
      });
    });
  }

  // Wire field-level encryption when a service is supplied. We return
  // the *extended* client so all reads/writes are filtered through the
  // encryption hook — including via `$transaction` (Prisma propagates
  // the extension into the transactional client by design).
  if (options.encryption && options.encryption.service) {
    const fields =
      options.encryption.fields ?? DEFAULT_ENCRYPTED_FIELDS;
    const extended = client.$extends(
      createPrismaEncryptionExtension(options.encryption.service, fields),
    );
    // Cast back to `PrismaClient` for the consuming modules that type
    // their providers as `PrismaClient`. The extended client is API
    // compatible — only the runtime behaviour changes.
    return extended as unknown as PrismaClient;
  }

  return client;
}

// Re-exported for unit tests so we don't have to copy the regex.
export const __test__ = { redactSqlLiterals, applyConnectionLimit };
