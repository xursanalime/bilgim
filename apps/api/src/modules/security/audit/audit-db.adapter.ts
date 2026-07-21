import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import type { AuditEntry, AuditStoragePort } from './audit-storage.port';

/**
 * `AuditDbAdapter` — Prisma-based append-only audit storage.
 *
 * Task 30.3, Requirements 32.3 / 32.4.
 *
 * Stores audit entries in the `AuditTrailEntry` table. The adapter
 * enforces append-only semantics at the application layer — no
 * update or delete operations are exposed. The underlying table
 * should also have database-level protections (e.g., revoke UPDATE/
 * DELETE from the application role in production).
 *
 * For tamper-proof archival, a separate S3 WORM adapter can be
 * composed alongside this one (dual-write pattern).
 */
@Injectable()
export class AuditDbAdapter implements AuditStoragePort {
  private readonly logger = new Logger(AuditDbAdapter.name);

  constructor(private readonly prisma: PrismaClient) {}

  async append(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        INSERT INTO "AuditTrailEntry" ("id", "userId", "action", "timestamp", "ip", "device", "context", "prevHash", "currentHash")
        VALUES (${entry.id}, ${entry.userId}, ${entry.action}, ${entry.timestamp}::timestamptz, ${entry.ip}, ${entry.device}, ${JSON.stringify(entry.context)}::jsonb, ${entry.prevHash}, ${entry.currentHash})
      `;
    } catch (error) {
      this.logger.error(
        `Failed to append audit entry: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  async findRecent(limit: number): Promise<AuditEntry[]> {
    const rows = await this.prisma.$queryRaw<RawAuditRow[]>`
      SELECT "id", "userId", "action", "timestamp", "ip", "device", "context", "prevHash", "currentHash"
      FROM "AuditTrailEntry"
      ORDER BY "timestamp" DESC
      LIMIT ${limit}
    `;
    return rows.map(this.mapRow);
  }

  async findLatest(): Promise<AuditEntry | null> {
    const rows = await this.prisma.$queryRaw<RawAuditRow[]>`
      SELECT "id", "userId", "action", "timestamp", "ip", "device", "context", "prevHash", "currentHash"
      FROM "AuditTrailEntry"
      ORDER BY "timestamp" DESC
      LIMIT 1
    `;
    return rows.length > 0 ? this.mapRow(rows[0]!) : null;
  }

  async findAll(offset = 0, limit = 10000): Promise<AuditEntry[]> {
    const rows = await this.prisma.$queryRaw<RawAuditRow[]>`
      SELECT "id", "userId", "action", "timestamp", "ip", "device", "context", "prevHash", "currentHash"
      FROM "AuditTrailEntry"
      ORDER BY "timestamp" ASC
      OFFSET ${offset}
      LIMIT ${limit}
    `;
    return rows.map(this.mapRow);
  }

  async count(): Promise<number> {
    const result = await this.prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM "AuditTrailEntry"
    `;
    return Number(result[0].count);
  }

  private mapRow(row: RawAuditRow): AuditEntry {
    return {
      id: row.id,
      userId: row.userId,
      action: row.action,
      timestamp:
        row.timestamp instanceof Date
          ? row.timestamp.toISOString()
          : String(row.timestamp),
      ip: row.ip,
      device: row.device,
      context:
        typeof row.context === 'string'
          ? JSON.parse(row.context)
          : (row.context as Record<string, unknown>),
      prevHash: row.prevHash,
      currentHash: row.currentHash,
    };
  }
}

interface RawAuditRow {
  id: string;
  userId: string;
  action: string;
  timestamp: Date | string;
  ip: string;
  device: string;
  context: unknown;
  prevHash: string;
  currentHash: string;
}
