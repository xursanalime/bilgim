import { Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient, PushDevice } from '@prisma/client';

export interface RegisterDeviceInput {
  userId: string;
  token: string;
  platform: 'ios' | 'android' | 'web';
  deviceInfo?: Record<string, unknown> | null;
}

/**
 * PushDeviceRepository — Prisma access for the `PushDevice` table
 * (Task 22.2, Req 16.1).
 *
 * The mobile app calls `POST /notifications/devices` after each cold
 * boot to make sure its Expo push token is on file. The repository
 * upserts on `(userId, token)` so the steady-state operation is a
 * `lastSeenAt` bump — there is no risk of accumulating duplicate rows.
 *
 * The companion `revoke()` helper is invoked by the push delivery
 * worker when Expo returns `DeviceNotRegistered` for a token; it sets
 * `revokedAt = NOW()` so subsequent fan-outs skip the dead token but
 * the row is preserved for audit purposes.
 */
@Injectable()
export class PushDeviceRepository {
  private readonly logger = new Logger(PushDeviceRepository.name);

  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Register or refresh a push token for a user. Returns the upserted
   * row. If the token was previously revoked we re-activate it (the
   * mobile app handed us a fresh token in the same envelope, which
   * means Expo has re-issued it for this device).
   */
  async register(
    input: RegisterDeviceInput,
    tx?: Prisma.TransactionClient,
  ): Promise<PushDevice> {
    const client = tx ?? this.prisma;
    // Prisma's JSON typing requires a sentinel for an explicit `null`,
    // so we map our nullable input to either a JSON value or
    // `Prisma.JsonNull` (which writes a SQL `NULL`).
    const deviceInfo: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput =
      input.deviceInfo == null
        ? Prisma.JsonNull
        : (input.deviceInfo as Prisma.InputJsonValue);
    const row = await client.pushDevice.upsert({
      where: {
        userId_token: { userId: input.userId, token: input.token },
      },
      create: {
        userId: input.userId,
        token: input.token,
        platform: input.platform,
        deviceInfo,
        lastSeenAt: new Date(),
      },
      update: {
        platform: input.platform,
        deviceInfo,
        lastSeenAt: new Date(),
        // Re-activate if the row was revoked previously.
        revokedAt: null,
      },
    });
    this.logger.debug(
      `Push device registered user=${input.userId} platform=${input.platform}`,
    );
    return row;
  }

  /** Mark a token as revoked (Expo `DeviceNotRegistered` response). */
  async revoke(token: string): Promise<{ count: number }> {
    const result = await this.prisma.pushDevice.updateMany({
      where: { token, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { count: result.count };
  }

  /** All active push tokens for a user. Excludes revoked rows. */
  async listActiveForUser(userId: string): Promise<PushDevice[]> {
    return this.prisma.pushDevice.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  /** Remove a single token at the user's request (logout / settings). */
  async unregister(userId: string, token: string): Promise<{ deleted: boolean }> {
    const result = await this.prisma.pushDevice.deleteMany({
      where: { userId, token },
    });
    return { deleted: result.count > 0 };
  }

  /**
   * Hard-delete every push device row for a user. Used when the user
   * logs out from settings — we don't want stale tokens to keep
   * receiving notifications addressed to a session that no longer
   * exists. Returns the number of rows removed.
   */
  async clearForUser(userId: string): Promise<{ deleted: number }> {
    const result = await this.prisma.pushDevice.deleteMany({
      where: { userId },
    });
    return { deleted: result.count };
  }
}
