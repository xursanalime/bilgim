import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import {
  CreatePrismaClientOptions,
  createPrismaClient,
} from './prisma.factory';

/**
 * Names of `PrismaClient` model methods that are read-only and therefore
 * safe to route to a follower replica (Task 24.2 — read replica
 * routing).
 *
 * Anything not listed here — `create`, `update`, `delete`, raw write
 * SQL, transactions — must hit the primary so we don't read from a
 * replica that has not yet caught up to the writer.
 *
 * Kept as a `Set` (rather than a regex / array) so the
 * `selectClient` helper is `O(1)` per call and the membership test is
 * impossible to typo.
 */
export const READ_ONLY_PRISMA_ACTIONS = new Set<string>([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

export interface PrismaRouterOptions extends CreatePrismaClientOptions {
  /**
   * Read replica connection string. When omitted (or equal to the
   * writer URL) the router collapses to a single client — `read()` and
   * `write()` return the same instance and the slow-query middleware
   * is only registered once.
   */
  readReplicaUrl?: string | undefined;
}

/**
 * Public surface returned by {@link createPrismaRouter}. The
 * `selectClient` helper exists so unit tests can verify the routing
 * decision without going through Prisma's `$extends` machinery.
 */
export interface PrismaRouter {
  /** The primary (writer) `PrismaClient`. */
  write(): PrismaClient;
  /**
   * The replica (reader) `PrismaClient`. Returns the writer when no
   * replica is configured.
   */
  read(): PrismaClient;
  /**
   * Decide which client should serve a given Prisma model action.
   * Pure function — exposed so the routing rule is testable in
   * isolation.
   */
  selectClient(action: string): PrismaClient;
  /** Close both clients (no-op when they share the same instance). */
  $disconnect(): Promise<void>;
}

/**
 * Build a router that exposes a `read()` client (followers) and a
 * `write()` client (primary). When `DATABASE_READ_REPLICA_URL` is not
 * set the two methods return the same instance — modules can opt in
 * to the router today and start benefiting from replicas the moment
 * an operator wires one up, without a code change.
 *
 * Modules that want to take advantage of read-routing should:
 *
 *   ```ts
 *   const router = createPrismaRouter({
 *     readReplicaUrl: config.get('DATABASE_READ_REPLICA_URL'),
 *   });
 *   const rows = await router.read().course.findMany({ ... });
 *   await router.write().course.update({ ... });
 *   ```
 *
 * Requirements: 20.1, 20.7 (read replica + Redis cache for read-heavy
 * endpoints).
 */
export function createPrismaRouter(
  options: PrismaRouterOptions = {},
): PrismaRouter {
  const logger = new Logger('PrismaRouter');
  const { readReplicaUrl, ...factoryOptions } = options;

  const writer = createPrismaClient(factoryOptions);

  // No replica configured → collapse to the writer. We deliberately
  // do NOT throw or warn — most envs (dev, test, single-node prod)
  // run with a single Postgres and that is a perfectly valid setup.
  const replicaConfigured =
    typeof readReplicaUrl === 'string' &&
    readReplicaUrl.trim().length > 0 &&
    readReplicaUrl !== factoryOptions.datasourceUrl &&
    readReplicaUrl !== process.env.DATABASE_URL;

  const reader = replicaConfigured
    ? createPrismaClient({ ...factoryOptions, datasourceUrl: readReplicaUrl })
    : writer;

  if (replicaConfigured) {
    logger.log('Read replica configured — read-only queries will route to the follower');
  }

  const selectClient = (action: string): PrismaClient =>
    READ_ONLY_PRISMA_ACTIONS.has(action) ? reader : writer;

  return {
    write: () => writer,
    read: () => reader,
    selectClient,
    async $disconnect() {
      await writer.$disconnect();
      if (reader !== writer) {
        await reader.$disconnect();
      }
    },
  };
}
