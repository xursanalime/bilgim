import { existsSync } from 'fs';

import {
  resolvePrismaCli,
  resolveSchemaPath,
  runPendingMigrations,
  shouldRunMigrations,
} from './run-migrations';

/**
 * Boot-time migrations exist because the deploy pipeline had no migration
 * step at all — `Dockerfile.api` starts `main.js` directly, and neither CI
 * nor the k8s manifests ran `prisma migrate deploy`. Adding a column
 * therefore shipped a Prisma client that selected a column the live
 * database did not have, and every query against that model 500'd.
 */

describe('shouldRunMigrations', () => {
  it('is on in production by default', () => {
    expect(shouldRunMigrations({ NODE_ENV: 'production' })).toBe(true);
  });

  it.each(['development', 'test', undefined])(
    'is off by default when NODE_ENV=%s',
    (NODE_ENV) => {
      // Unit tests and `nest start --watch` must never shell out to the
      // Prisma CLI.
      expect(shouldRunMigrations({ NODE_ENV } as NodeJS.ProcessEnv)).toBe(false);
    },
  );

  it.each([
    ['true', true],
    ['TRUE', true],
    ['1', true],
    ['false', false],
    ['0', false],
  ])('honours MIGRATE_ON_BOOT=%s', (value, expected) => {
    // Both directions matter: `true` lets a staging box self-migrate,
    // `false` lets a separate release job own migrations in production.
    expect(
      shouldRunMigrations({ NODE_ENV: 'development', MIGRATE_ON_BOOT: value }),
    ).toBe(expected);
    expect(
      shouldRunMigrations({ NODE_ENV: 'production', MIGRATE_ON_BOOT: value }),
    ).toBe(expected);
  });

  it('ignores an empty MIGRATE_ON_BOOT and falls back to NODE_ENV', () => {
    expect(
      shouldRunMigrations({ NODE_ENV: 'production', MIGRATE_ON_BOOT: '' }),
    ).toBe(true);
  });
});

describe('resolveSchemaPath', () => {
  it('finds the real schema from this file’s location', () => {
    // Guards the relative walk that has to work from BOTH
    // `apps/api/src/infra/prisma` (ts-node) and `apps/api/dist/infra/prisma`
    // (build + Docker image), which sit at the same depth.
    const found = resolveSchemaPath({} as NodeJS.ProcessEnv);
    expect(found).not.toBeNull();
    expect(found).toMatch(/packages\/db\/prisma\/schema\.prisma$/);
    expect(existsSync(found!)).toBe(true);
  });

  it('prefers an explicit PRISMA_SCHEMA_PATH that exists', () => {
    const real = resolveSchemaPath({} as NodeJS.ProcessEnv)!;
    expect(
      resolveSchemaPath({ PRISMA_SCHEMA_PATH: real } as NodeJS.ProcessEnv),
    ).toBe(real);
  });

  it('ignores a PRISMA_SCHEMA_PATH that does not exist', () => {
    const found = resolveSchemaPath({
      PRISMA_SCHEMA_PATH: '/nope/schema.prisma',
    } as NodeJS.ProcessEnv);
    expect(found).toMatch(/packages\/db\/prisma\/schema\.prisma$/);
  });
});

describe('resolvePrismaCli', () => {
  it('locates the Prisma CLI entrypoint', () => {
    // `prisma` is a RUNTIME dependency of @edubridge/db precisely so this
    // resolves inside the distroless image, which has no shell to run the
    // `prisma` bin script with.
    const schema = resolveSchemaPath({} as NodeJS.ProcessEnv)!;
    const cli = resolvePrismaCli(schema);
    expect(cli).not.toBeNull();
    expect(existsSync(cli!)).toBe(true);
  });
});

describe('runPendingMigrations', () => {
  it('is a no-op when disabled', async () => {
    await expect(
      runPendingMigrations({
        NODE_ENV: 'test',
        MIGRATE_ON_BOOT: 'false',
      } as NodeJS.ProcessEnv),
    ).resolves.toBeUndefined();
  });

  it('rejects when the schema cannot be found', async () => {
    // Fail closed — never boot against a schema we cannot verify.
    const spy = jest
      .spyOn(process, 'cwd')
      .mockReturnValue('/definitely/not/a/repo');
    try {
      await expect(
        runPendingMigrations({
          MIGRATE_ON_BOOT: 'true',
          PRISMA_SCHEMA_PATH: '/nope/schema.prisma',
        } as NodeJS.ProcessEnv),
      ).rejects.toThrow(/schema\.prisma/);
    } finally {
      spy.mockRestore();
    }
  });
});
