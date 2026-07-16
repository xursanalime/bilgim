/**
 * One-time, idempotent data migration for the English-Only Platform Refocus
 * (Req 16). Safe to run against production and safe to re-run after a partial
 * failure — see {@link MigrationService} for the per-requirement guarantees.
 *
 * Usage (from `apps/api`):
 *
 *   ts-node scripts/run-refocus-migration.ts            # default level A1
 *   ts-node scripts/run-refocus-migration.ts --level B1 # override default
 *   MIGRATION_DEFAULT_CEFR_LEVEL=A2 ts-node scripts/run-refocus-migration.ts
 *
 * This script only performs the DATA migration (backfill + non-destructive
 * toggles). It does NOT run `prisma migrate` — the schema is already in place.
 */
import { CefrLevel } from '@prisma/client';

import { createPrismaClient } from '../src/infra/prisma';
import {
  MigrationService,
  PrismaMigrationRepository,
} from '../src/modules/migration';

const CEFR_LEVELS: readonly CefrLevel[] = [
  'A1',
  'A2',
  'B1',
  'B2',
  'C1',
  'C2',
];

/** Resolve the default CEFR level from `--level <X>` or `MIGRATION_DEFAULT_CEFR_LEVEL`. */
function resolveDefaultLevel(argv: string[]): CefrLevel | undefined {
  const flagIndex = argv.indexOf('--level');
  const raw =
    flagIndex !== -1 ? argv[flagIndex + 1] : process.env.MIGRATION_DEFAULT_CEFR_LEVEL;
  if (raw === undefined || raw === '') {
    return undefined;
  }
  if (!CEFR_LEVELS.includes(raw as CefrLevel)) {
    throw new Error(
      `Invalid CEFR level "${raw}". Expected one of: ${CEFR_LEVELS.join(', ')}`,
    );
  }
  return raw as CefrLevel;
}

async function main(): Promise<void> {
  const defaultCefrLevel = resolveDefaultLevel(process.argv.slice(2));
  const prisma = createPrismaClient();
  try {
    const service = new MigrationService(
      new PrismaMigrationRepository(prisma),
      defaultCefrLevel ? { defaultCefrLevel } : undefined,
    );
    const report = await service.run();
    // Emit the structured report for operator visibility / CI logs.
    console.log(JSON.stringify({ migration: 'english-only-refocus', report }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
