import { Injectable } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationKind,
  NotificationPreference,
  PrismaClient,
} from '@prisma/client';

/**
 * Default-on map for `(kind, channel)` combinations (Req 16.1, 16.2).
 *
 * If a user has no `NotificationPreference` row for a `(kind, channel)`
 * pair, the resolver below returns the value from this map. The
 * principle is: in-app and the kind's "primary" channel default ON, and
 * everything else defaults to OFF — except channels with no provider
 * configured (PUSH today) which default OFF.
 */
const ALL_KINDS: NotificationKind[] = [
  'ENROLLMENT_REQUESTED',
  'ENROLLMENT_APPROVED',
  'ENROLLMENT_REJECTED',
  'PAYMENT_SUCCEEDED',
  'PAYMENT_FAILED',
  'LESSON_PUBLISHED',
  'SCHEDULE_CHANGED',
  'LIVE_STARTED',
  'LIVE_REMINDER',
  'HOMEWORK_ASSIGNED',
  'HOMEWORK_GRADED',
  'AI_REVIEW_READY',
  'TRIAL_ENDING',
  'SUBSCRIPTION_PAST_DUE',
];

const ALL_CHANNELS: NotificationChannel[] = [
  'IN_APP',
  'EMAIL',
  'TELEGRAM',
  'PUSH',
  'SMS',
];

/**
 * Default-enabled lookup. `IN_APP` is always default-on. EMAIL is default-on
 * for "important" kinds (payment, enrollment, schedule). TELEGRAM is default
 * off (opt-in). PUSH is default off until Phase 8 sends mobile pushes.
 */
const DEFAULT_ENABLED: Record<
  NotificationKind,
  Record<NotificationChannel, boolean>
> = ALL_KINDS.reduce(
  (acc, kind) => {
    acc[kind] = {
      IN_APP: true,
      EMAIL:
        kind === 'PAYMENT_SUCCEEDED' ||
        kind === 'PAYMENT_FAILED' ||
        kind === 'ENROLLMENT_APPROVED' ||
        kind === 'ENROLLMENT_REJECTED' ||
        kind === 'SCHEDULE_CHANGED' ||
        kind === 'TRIAL_ENDING' ||
        kind === 'SUBSCRIPTION_PAST_DUE',
      TELEGRAM: false,
      PUSH: false,
      SMS: false,
    };
    return acc;
  },
  {} as Record<NotificationKind, Record<NotificationChannel, boolean>>,
);

/**
 * NotificationPreferenceRepository — owns the `NotificationPreference` table
 * (Req 16.1, 16.3).
 *
 * Read paths use the `defaultEnabled(kind, channel)` map when a user has no
 * row for a given combination; this avoids backfilling defaults at sign-up.
 * Writes use `upsert` so the unique constraint
 * `@@unique([userId, kind, channel])` is honoured.
 */
@Injectable()
export class NotificationPreferenceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Public helper exposing the default lookup so the fanout worker can
   * decide whether to enqueue a delivery without a DB read for every
   * channel when no preference rows exist.
   *
   * IN_APP is always-on regardless of `(kind, channel)` (Req 16.1, Task
   * 14.3) — users can mute EMAIL / TELEGRAM / PUSH but the in-app inbox
   * row is the canonical record of every notification.
   */
  defaultEnabled(kind: NotificationKind, channel: NotificationChannel): boolean {
    if (channel === 'IN_APP') return true;
    return DEFAULT_ENABLED[kind]?.[channel] ?? false;
  }

  /**
   * Resolve a user's effective preference for `(kind, channel)`.
   *
   * - IN_APP is always `true` (always-on inbox channel).
   * - If a row exists, return its `enabled` value.
   * - Otherwise, return the default for the combination.
   */
  async isEnabledForUser(
    userId: string,
    kind: NotificationKind,
    channel: NotificationChannel,
  ): Promise<boolean> {
    if (channel === 'IN_APP') return true;
    const row = await this.prisma.notificationPreference.findUnique({
      where: {
        userId_kind_channel: { userId, kind, channel },
      },
    });
    if (row) return row.enabled;
    return this.defaultEnabled(kind, channel);
  }

  /**
   * Resolve all `(kind, channel)` enabled flags for a user across the four
   * channels in `ALL_CHANNELS`. Used by the fanout worker.
   *
   * IN_APP is hard-coded to `true` regardless of any stored row — the
   * in-app inbox is always-on per Task 14.3 / Req 16.1.
   */
  async resolveChannelsForUser(
    userId: string,
    kind: NotificationKind,
  ): Promise<Record<NotificationChannel, boolean>> {
    const rows = await this.prisma.notificationPreference.findMany({
      where: { userId, kind },
    });
    const overridden = new Map<NotificationChannel, boolean>();
    for (const row of rows) {
      overridden.set(row.channel, row.enabled);
    }
    const result = {} as Record<NotificationChannel, boolean>;
    for (const channel of ALL_CHANNELS) {
      if (channel === 'IN_APP') {
        result[channel] = true;
        continue;
      }
      result[channel] = overridden.has(channel)
        ? (overridden.get(channel) as boolean)
        : this.defaultEnabled(kind, channel);
    }
    return result;
  }

  /**
   * List all `(kind, channel)` preferences for a user, materialising the
   * defaults when the row is missing. The result has exactly
   * `ALL_KINDS.length * ALL_CHANNELS.length` entries.
   *
   * IN_APP rows are always reported as `enabled: true` (always-on
   * channel) — the controller / UI can render them as a read-only
   * indicator.
   */
  async listForUser(userId: string): Promise<
    Array<{
      kind: NotificationKind;
      channel: NotificationChannel;
      enabled: boolean;
    }>
  > {
    const stored = await this.prisma.notificationPreference.findMany({
      where: { userId },
    });
    const map = new Map<string, boolean>();
    for (const row of stored) {
      map.set(`${row.kind}|${row.channel}`, row.enabled);
    }
    const result: Array<{
      kind: NotificationKind;
      channel: NotificationChannel;
      enabled: boolean;
    }> = [];
    for (const kind of ALL_KINDS) {
      for (const channel of ALL_CHANNELS) {
        if (channel === 'IN_APP') {
          result.push({ kind, channel, enabled: true });
          continue;
        }
        const key = `${kind}|${channel}`;
        result.push({
          kind,
          channel,
          enabled: map.has(key)
            ? (map.get(key) as boolean)
            : this.defaultEnabled(kind, channel),
        });
      }
    }
    return result;
  }

  /**
   * Upsert a single preference.
   *
   * IN_APP is the always-on inbox channel — attempts to disable it are
   * rejected at this layer (the controller's Zod schema rejects it
   * before we reach here, but the guard is preserved as defence in
   * depth). The unique constraint `@@unique([userId, kind, channel])`
   * keeps the matrix sparse-but-consistent.
   */
  async upsert(input: {
    userId: string;
    kind: NotificationKind;
    channel: NotificationChannel;
    enabled: boolean;
  }): Promise<NotificationPreference> {
    if (input.channel === 'IN_APP' && input.enabled === false) {
      throw new Error(
        'IN_APP channel is always-on and cannot be disabled (Task 14.3 / Req 16.1)',
      );
    }
    return this.prisma.notificationPreference.upsert({
      where: {
        userId_kind_channel: {
          userId: input.userId,
          kind: input.kind,
          channel: input.channel,
        },
      },
      create: {
        userId: input.userId,
        kind: input.kind,
        channel: input.channel,
        enabled: input.enabled,
      },
      update: { enabled: input.enabled },
    });
  }

  /**
   * Bulk upsert preferences for the same `userId`. Used by
   * `PATCH /notifications/preferences` so the client can send the whole
   * settings page in one round-trip.
   *
   * Runs each upsert inside a single Prisma `$transaction` so a partial
   * write never leaves the matrix half-applied — either all rows commit
   * or none do.
   *
   * IN_APP entries with `enabled=false` are rejected as a batch (see
   * `upsert` above). IN_APP with `enabled=true` is silently dropped —
   * it is the default and storing it would just bloat the table.
   */
  async bulkUpsert(
    userId: string,
    items: Array<{
      kind: NotificationKind;
      channel: NotificationChannel;
      enabled: boolean;
    }>,
  ): Promise<NotificationPreference[]> {
    const filtered = items.filter((item) => {
      if (item.channel !== 'IN_APP') return true;
      if (item.enabled === false) {
        throw new Error(
          'IN_APP channel is always-on and cannot be disabled (Task 14.3 / Req 16.1)',
        );
      }
      // IN_APP enabled=true → no-op, drop from the upsert batch.
      return false;
    });
    if (filtered.length === 0) return [];
    return this.prisma.$transaction(
      filtered.map((item) =>
        this.prisma.notificationPreference.upsert({
          where: {
            userId_kind_channel: {
              userId,
              kind: item.kind,
              channel: item.channel,
            },
          },
          create: {
            userId,
            kind: item.kind,
            channel: item.channel,
            enabled: item.enabled,
          },
          update: { enabled: item.enabled },
        }),
      ),
    );
  }
}

export { ALL_KINDS as NOTIFICATION_KINDS, ALL_CHANNELS as NOTIFICATION_CHANNELS };
