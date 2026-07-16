import { PrismaClient } from '@prisma/client';

import { OutboxService } from '../../../infra/outbox/outbox.service';
import { AdminNotificationAdapter } from './admin-notification.adapter';

/**
 * Unit tests for `AdminNotificationAdapter` — the concrete fan-out
 * adapter that turns a brute-force PERM_LOCKED / IP_BLOCKED event
 * into a single `security.admin_alert` outbox event consumed by the
 * existing notifications fan-out worker.
 */

interface FakePrisma {
  user: {
    findMany: jest.Mock;
  };
  $transaction: jest.Mock;
}

function buildPrisma(adminIds: string[] = ['admin-1', 'admin-2']): FakePrisma {
  const txClient = { __tx: true } as unknown;
  return {
    user: {
      findMany: jest
        .fn()
        .mockResolvedValue(adminIds.map((id) => ({ id }))),
    },
    $transaction: jest
      .fn()
      .mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb(txClient),
      ),
  };
}

function buildOutbox(): jest.Mocked<OutboxService> {
  return {
    create: jest.fn().mockResolvedValue('event-id'),
    createMany: jest.fn().mockResolvedValue(['event-id']),
  } as unknown as jest.Mocked<OutboxService>;
}

describe('AdminNotificationAdapter', () => {
  it('appends a single security.admin_alert outbox event with admin recipients', async () => {
    const prisma = buildPrisma(['admin-1', 'admin-2']);
    const outbox = buildOutbox();
    const adapter = new AdminNotificationAdapter(
      prisma as unknown as PrismaClient,
      outbox,
    );
    const emittedAt = new Date('2024-01-01T00:00:00.000Z');

    await adapter.notifyAdmins({
      email: 'victim@example.com',
      reason: 'Account permanently locked',
      emittedAt,
    });

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { role: 'ADMIN', status: 'ACTIVE' },
      select: { id: true },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(outbox.create).toHaveBeenCalledTimes(1);
    expect(outbox.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        topic: AdminNotificationAdapter.TOPIC,
        idempotencyKey: `${AdminNotificationAdapter.TOPIC}:victim@example.com:${emittedAt.toISOString()}`,
        payload: expect.objectContaining({
          email: 'victim@example.com',
          reason: 'Account permanently locked',
          adminIds: ['admin-1', 'admin-2'],
        }),
      }),
    );
  });

  it('skips the outbox emit when no active admin users exist', async () => {
    const prisma = buildPrisma([]);
    const outbox = buildOutbox();
    const adapter = new AdminNotificationAdapter(
      prisma as unknown as PrismaClient,
      outbox,
    );
    await adapter.notifyAdmins({
      email: 'a@example.com',
      reason: 'r',
      emittedAt: new Date(),
    });
    expect(outbox.create).not.toHaveBeenCalled();
  });

  it('is a no-op when prisma / outbox are not wired', async () => {
    const adapter = new AdminNotificationAdapter();
    await expect(
      adapter.notifyAdmins({
        email: 'a@example.com',
        reason: 'r',
        emittedAt: new Date(),
      }),
    ).resolves.toBeUndefined();
  });

  it('swallows transaction failures so brute-force flow never breaks', async () => {
    const prisma = buildPrisma(['admin-1']);
    prisma.$transaction.mockRejectedValueOnce(new Error('db is down'));
    const outbox = buildOutbox();
    const adapter = new AdminNotificationAdapter(
      prisma as unknown as PrismaClient,
      outbox,
    );
    await expect(
      adapter.notifyAdmins({
        email: 'a@example.com',
        reason: 'r',
        emittedAt: new Date(),
      }),
    ).resolves.toBeUndefined();
  });
});
