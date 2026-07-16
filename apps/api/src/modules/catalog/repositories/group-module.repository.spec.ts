import { HomeworkModuleType } from '@prisma/client';

import { GLOBAL_ENGLISH_MODULE_CATALOG } from '../english-module-catalog';
import { GroupModuleRepository } from './group-module.repository';

/**
 * GroupModuleRepository.seedForGroup — global English catalog seeding +
 * idempotency (English-Only Platform Refocus, Req 6.4).
 *
 * The seed must be idempotent: re-seeding a group that already has its
 * modules must not duplicate rows. The repository delegates dedup to a
 * `createMany({ skipDuplicates: true })` against the
 * `(groupId, moduleType)` primary key — these tests pin that contract.
 */
const GROUP_ID = '33333333-3333-3333-3333-333333333333';

describe('GroupModuleRepository.seedForGroup', () => {
  function buildRepo() {
    const persisted = new Map<string, any>();

    const createMany = jest.fn(async (args: any) => {
      let count = 0;
      for (const row of args.data) {
        const key = `${row.groupId}:${row.moduleType}`;
        // skipDuplicates semantics: existing (groupId, moduleType) is kept.
        if (args.skipDuplicates && persisted.has(key)) continue;
        persisted.set(key, row);
        count += 1;
      }
      return { count };
    });

    const findMany = jest.fn(async (args: any) =>
      [...persisted.values()]
        .filter((r) => r.groupId === args.where.groupId)
        .sort((a, b) => a.moduleType.localeCompare(b.moduleType)),
    );

    const tx: any = { groupModule: { createMany, findMany } };
    const prisma: any = { groupModule: { findMany } };
    const repo = new GroupModuleRepository(prisma);
    return { repo, tx, createMany, persisted };
  }

  const catalogModules = GLOBAL_ENGLISH_MODULE_CATALOG.map((c) => ({
    moduleType: c.moduleType as HomeworkModuleType,
    defaultEnabled: c.defaultEnabled,
  }));

  it('seeds the eight global English skills with skipDuplicates enabled', async () => {
    const { repo, tx, createMany } = buildRepo();

    const rows = await repo.seedForGroup(
      { groupId: GROUP_ID, modules: catalogModules },
      tx,
    );

    expect(rows).toHaveLength(8);
    expect(createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
  });

  it('is idempotent: re-seeding an already-seeded group does not duplicate rows', async () => {
    const { repo, tx, persisted } = buildRepo();

    await repo.seedForGroup(
      { groupId: GROUP_ID, modules: catalogModules },
      tx,
    );
    const afterFirst = persisted.size;

    const rows = await repo.seedForGroup(
      { groupId: GROUP_ID, modules: catalogModules },
      tx,
    );

    // No new rows added on the second seed; the set stays at eight.
    expect(persisted.size).toBe(afterFirst);
    expect(persisted.size).toBe(8);
    expect(rows).toHaveLength(8);
  });
});
