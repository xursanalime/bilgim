import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { Logger } from '@nestjs/common';

/**
 * Apply pending Prisma migrations before the API starts serving.
 *
 * Why this lives in the app rather than the deploy pipeline: there was no
 * migration step *anywhere* — not in `Dockerfile.api`, not in CI, not in
 * the k8s manifests. Only `scripts/bilgim.sh` (local dev) ever ran
 * `migrate deploy`. So a schema change would build fine, deploy fine, and
 * then 500 on every request that touched the changed model, because the
 * regenerated Prisma client selects columns the live database does not
 * have yet. That is exactly how adding `User.sessionsRevokedAt` took
 * production login down on 2026-07-25.
 *
 * Concurrency: `prisma migrate deploy` takes a Postgres advisory lock for
 * the duration of the run, so parallel replicas booting at once serialise
 * rather than racing — the losers wait, observe there is nothing left to
 * apply, and exit cleanly.
 *
 * Failure policy: **fail closed.** If migrations cannot be applied the
 * process exits instead of serving traffic against a schema it does not
 * match — a hard crash on deploy is far easier to diagnose (and safer)
 * than a partially-broken API.
 */

const logger = new Logger('Migrations');

/** How long to allow migrations before giving up. */
const MIGRATION_TIMEOUT_MS = 120_000;

/**
 * `true` when migrations should run on boot.
 *
 * Defaults to on in production and off everywhere else — unit tests and
 * `nest start --watch` must never shell out to the Prisma CLI. Set
 * `MIGRATE_ON_BOOT=true|false` to override either way (e.g. `false` when
 * a separate release job owns migrations).
 */
export function shouldRunMigrations(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const explicit = env.MIGRATE_ON_BOOT;
  if (explicit !== undefined && explicit !== '') {
    return explicit.toLowerCase() === 'true' || explicit === '1';
  }
  return env.NODE_ENV === 'production';
}

/**
 * Locate `packages/db/prisma/schema.prisma`.
 *
 * `__dirname` is `apps/api/dist/infra/prisma` in a build and
 * `apps/api/src/infra/prisma` under ts-node, so the same relative walk
 * reaches the repo root in both. `process.cwd()` is tried as well because
 * the Docker image runs from `/app`. `PRISMA_SCHEMA_PATH` overrides
 * everything for layouts we have not anticipated.
 */
export function resolveSchemaPath(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (env.PRISMA_SCHEMA_PATH && existsSync(env.PRISMA_SCHEMA_PATH)) {
    return env.PRISMA_SCHEMA_PATH;
  }

  const candidates = [
    resolve(__dirname, '../../../../../packages/db/prisma/schema.prisma'),
    resolve(__dirname, '../../../../packages/db/prisma/schema.prisma'),
    resolve(process.cwd(), 'packages/db/prisma/schema.prisma'),
    resolve(process.cwd(), '../../packages/db/prisma/schema.prisma'),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

/**
 * Locate the Prisma CLI entrypoint.
 *
 * The production image is distroless — there is no shell, so we cannot
 * `sh -c "prisma migrate deploy && …"`. We invoke the CLI's JS entrypoint
 * with the same Node binary that is already running. `prisma` therefore
 * has to be a runtime dependency of `@edubridge/db`, not a devDependency
 * (`pnpm prune --prod` in the build would otherwise delete it).
 */
export function resolvePrismaCli(schemaPath: string): string | null {
  const dbPackageDir = resolve(schemaPath, '../..');
  const searchPaths = [dbPackageDir, process.cwd(), __dirname];

  try {
    return require.resolve('prisma/build/index.js', { paths: searchPaths });
  } catch {
    // pnpm's non-flat layout can hide the package from `require.resolve`.
    // Fall back to the conventional locations.
    const direct = [
      join(dbPackageDir, 'node_modules/prisma/build/index.js'),
      resolve(process.cwd(), 'node_modules/prisma/build/index.js'),
    ];
    return direct.find((p) => existsSync(p)) ?? null;
  }
}

/**
 * Run `prisma migrate deploy`. Resolves on success, rejects on any
 * failure (non-zero exit, timeout, or missing tooling).
 */
export async function runPendingMigrations(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!shouldRunMigrations(env)) {
    logger.log('Skipping migrations on boot (MIGRATE_ON_BOOT is off)');
    return;
  }

  const schemaPath = resolveSchemaPath(env);
  if (!schemaPath) {
    throw new Error(
      'Could not locate packages/db/prisma/schema.prisma — set PRISMA_SCHEMA_PATH',
    );
  }

  const cliPath = resolvePrismaCli(schemaPath);
  if (!cliPath) {
    throw new Error(
      'Could not locate the Prisma CLI. `prisma` must be a runtime ' +
        'dependency of @edubridge/db for boot-time migrations to work.',
    );
  }

  logger.log(`Applying pending migrations (schema: ${schemaPath})`);

  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [cliPath, 'migrate', 'deploy', '--schema', schemaPath],
      { env: { ...env }, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (c: Buffer) => (stdout += c.toString()));
    child.stderr?.on('data', (c: Buffer) => (stderr += c.toString()));

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(
        new Error(`prisma migrate deploy timed out after ${MIGRATION_TIMEOUT_MS}ms`),
      );
    }, MIGRATION_TIMEOUT_MS);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        // The CLI prints "No pending migrations to apply." on a no-op,
        // which is worth having in the deploy log either way.
        logger.log(stdout.trim() || 'Migrations up to date');
        resolvePromise();
        return;
      }
      reject(
        new Error(
          `prisma migrate deploy exited with code ${code}\n${stderr.trim() || stdout.trim()}`,
        ),
      );
    });
  });
}
