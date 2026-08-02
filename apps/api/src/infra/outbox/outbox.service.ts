import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

export interface CreateOutboxEventInput {
  topic: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}

/**
 * OutboxService creates OutboxEvent records within an existing Prisma transaction.
 * This ensures atomicity: the business operation and the event are committed together.
 *
 * Usage:
 *   await prisma.$transaction(async (tx) => {
 *     // ... business logic ...
 *     await outboxService.create(tx, { topic, payload, idempotencyKey });
 *   });
 */
@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  /**
   * Create an OutboxEvent within a Prisma transaction.
   * Uses ON CONFLICT DO NOTHING to ensure idempotency.
   */
  async create(
    tx: Prisma.TransactionClient,
    input: CreateOutboxEventInput,
  ): Promise<string | null> {
    const id = randomUUID();

    try {
      // Use raw SQL for ON CONFLICT DO NOTHING (Prisma doesn't support skipDuplicates on create)
      const result = await tx.$executeRaw`
        INSERT INTO "OutboxEvent" (id, topic, payload, "idempotencyKey", status, attempt, "nextAttemptAt", "createdAt")
        VALUES (
          ${id}::uuid,
          ${input.topic},
          ${JSON.stringify(input.payload)}::jsonb,
          ${input.idempotencyKey},
          'PENDING',
          0,
          NOW(),
          NOW()
        )
        ON CONFLICT ("idempotencyKey") DO NOTHING
      `;

      if (result === 0) {
        this.logger.debug(
          `OutboxEvent with idempotencyKey="${input.idempotencyKey}" already exists, skipped`,
        );
        return null;
      }

      return id;
    } catch (error) {
      this.logger.error(
        `Failed to create OutboxEvent: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  /**
   * Create multiple OutboxEvents within a Prisma transaction.
   */
  async createMany(
    tx: Prisma.TransactionClient,
    inputs: CreateOutboxEventInput[],
  ): Promise<(string | null)[]> {
    const results: (string | null)[] = [];
    for (const input of inputs) {
      const id = await this.create(tx, input);
      results.push(id);
    }
    return results;
  }
}
