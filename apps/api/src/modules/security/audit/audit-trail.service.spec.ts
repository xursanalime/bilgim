import { createHash } from 'node:crypto';
import fc from 'fast-check';

import { Test, TestingModule } from '@nestjs/testing';

import { AUDIT_STORAGE, type AuditEntry, type AuditStoragePort } from './audit-storage.port';
import { AuditTrailService, type AuditEventInput } from './audit-trail.service';

// ─── In-memory storage mock ──────────────────────────────────────────────────

class InMemoryAuditStorage implements AuditStoragePort {
  private entries: AuditEntry[] = [];

  async append(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }

  async findRecent(limit: number): Promise<AuditEntry[]> {
    return [...this.entries].reverse().slice(0, limit);
  }

  async findLatest(): Promise<AuditEntry | null> {
    return this.entries.length > 0
      ? this.entries[this.entries.length - 1]!
      : null;
  }

  async findAll(offset = 0, limit = 10000): Promise<AuditEntry[]> {
    return this.entries.slice(offset, offset + limit);
  }

  async count(): Promise<number> {
    return this.entries.length;
  }

  /** Test helper — tamper with an entry to simulate corruption. */
  tamperEntry(index: number, field: keyof AuditEntry, value: string): void {
    const entry = this.entries[index];
    if (entry) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (entry as any)[field] = value;
    }
  }

  /** Test helper — get raw entries. */
  getAll(): AuditEntry[] {
    return [...this.entries];
  }

  /** Test helper — clear all entries. */
  clear(): void {
    this.entries = [];
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AuditTrailService', () => {
  let service: AuditTrailService;
  let storage: InMemoryAuditStorage;

  beforeEach(async () => {
    storage = new InMemoryAuditStorage();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditTrailService,
        { provide: AUDIT_STORAGE, useValue: storage },
      ],
    }).compile();

    service = module.get<AuditTrailService>(AuditTrailService);
  });

  // ─── Entry creation ──────────────────────────────────────────────────────

  describe('record()', () => {
    it('should create an audit entry with all required fields', async () => {
      const input: AuditEventInput = {
        userId: 'user-123',
        action: 'user.login',
        ip: '192.168.1.1',
        device: 'Mozilla/5.0 Chrome/120',
        context: { reason: 'password_auth' },
      };

      const entry = await service.record(input);

      expect(entry.id).toBeDefined();
      expect(entry.userId).toBe('user-123');
      expect(entry.action).toBe('user.login');
      expect(entry.ip).toBe('192.168.1.1');
      expect(entry.device).toBe('Mozilla/5.0 Chrome/120');
      expect(entry.context).toEqual({ reason: 'password_auth' });
      expect(entry.timestamp).toBeDefined();
      expect(entry.prevHash).toBeDefined();
      expect(entry.currentHash).toBeDefined();
    });

    it('should use genesis hash as prevHash for the first entry', async () => {
      const entry = await service.record({
        userId: 'user-1',
        action: 'user.login',
        ip: '10.0.0.1',
        device: 'test-device',
      });

      expect(entry.prevHash).toBe(AuditTrailService.GENESIS_HASH);
      expect(entry.prevHash).toBe('0'.repeat(64));
    });

    it('should default context to empty object when not provided', async () => {
      const entry = await service.record({
        userId: 'user-1',
        action: 'user.logout',
        ip: '10.0.0.1',
        device: 'test-device',
      });

      expect(entry.context).toEqual({});
    });

    it('should store the entry in the storage backend', async () => {
      await service.record({
        userId: 'user-1',
        action: 'admin.role_change',
        ip: '10.0.0.1',
        device: 'test-device',
        context: { targetUser: 'user-2', newRole: 'ADMIN' },
      });

      const stored = storage.getAll();
      expect(stored).toHaveLength(1);
      expect(stored[0]!.action).toBe('admin.role_change');
    });
  });

  // ─── Hash chaining ───────────────────────────────────────────────────────

  describe('hash chaining', () => {
    it('should chain entries — second entry prevHash equals first entry currentHash', async () => {
      const first = await service.record({
        userId: 'user-1',
        action: 'user.login',
        ip: '10.0.0.1',
        device: 'device-a',
      });

      const second = await service.record({
        userId: 'user-2',
        action: 'user.login',
        ip: '10.0.0.2',
        device: 'device-b',
      });

      expect(second.prevHash).toBe(first.currentHash);
    });

    it('should produce a valid chain of 5 entries', async () => {
      const entries: AuditEntry[] = [];

      for (let i = 0; i < 5; i++) {
        const entry = await service.record({
          userId: `user-${i}`,
          action: `action.${i}`,
          ip: `10.0.0.${i}`,
          device: `device-${i}`,
          context: { index: i },
        });
        entries.push(entry);
      }

      // Verify chain linkage.
      expect(entries[0]!.prevHash).toBe(AuditTrailService.GENESIS_HASH);
      for (let i = 1; i < entries.length; i++) {
        expect(entries[i]!.prevHash).toBe(entries[i - 1]!.currentHash);
      }
    });

    it('should compute currentHash correctly using SHA-256', async () => {
      const entry = await service.record({
        userId: 'user-abc',
        action: 'payment.completed',
        ip: '172.16.0.1',
        device: 'Safari/17',
        context: { amount: 100, currency: 'UZS' },
      });

      // Manually recompute the hash.
      const payload =
        entry.id +
        entry.userId +
        entry.action +
        entry.timestamp +
        entry.ip +
        entry.device +
        JSON.stringify(entry.context) +
        entry.prevHash;

      const expected = createHash('sha256').update(payload).digest('hex');
      expect(entry.currentHash).toBe(expected);
    });

    it('computeHash static method should produce deterministic results', () => {
      const params = {
        id: 'test-id',
        userId: 'user-1',
        action: 'test.action',
        timestamp: '2024-01-01T00:00:00.000Z',
        ip: '127.0.0.1',
        device: 'test',
        context: { key: 'value' },
        prevHash: '0'.repeat(64),
      };

      const hash1 = AuditTrailService.computeHash(params);
      const hash2 = AuditTrailService.computeHash(params);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 hex = 64 chars
    });

    it('computeHash should produce different hashes for different inputs', () => {
      const base = {
        id: 'test-id',
        userId: 'user-1',
        action: 'test.action',
        timestamp: '2024-01-01T00:00:00.000Z',
        ip: '127.0.0.1',
        device: 'test',
        context: {},
        prevHash: '0'.repeat(64),
      };

      const hash1 = AuditTrailService.computeHash(base);
      const hash2 = AuditTrailService.computeHash({ ...base, userId: 'user-2' });
      const hash3 = AuditTrailService.computeHash({ ...base, action: 'other.action' });

      expect(hash1).not.toBe(hash2);
      expect(hash1).not.toBe(hash3);
      expect(hash2).not.toBe(hash3);
    });
  });

  // ─── Integrity verification ──────────────────────────────────────────────

  describe('verifyIntegrity()', () => {
    it('Property 29: validates correctly and always detects tampering anywhere in the chain', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              userId: fc.uuid(),
              action: fc.string({ minLength: 1 }),
              ip: fc.ipV4(),
              device: fc.string(),
              context: fc.dictionary(fc.string(), fc.string()),
            }),
            { minLength: 1, maxLength: 50 }
          ),
          fc.option(
            fc.record({
              index: fc.integer({ min: 0, max: 49 }),
              field: fc.constantFrom('action', 'userId', 'ip', 'device', 'currentHash', 'prevHash'),
              value: fc.string(),
            })
          ),
          async (events, tamper) => {
            storage.clear();
            for (const event of events) {
              await service.record(event as any);
            }

            let expectValid = true;
            if (tamper && tamper.index < events.length) {
              storage.tamperEntry(tamper.index, tamper.field as any, tamper.value);
              expectValid = false;
            }

            const result = await service.verifyIntegrity();
            expect(result.valid).toBe(expectValid);
          }
        )
      );
    });

    it('should return valid for an empty log', async () => {
      const result = await service.verifyIntegrity();

      expect(result.valid).toBe(true);
      expect(result.totalEntries).toBe(0);
      expect(result.validEntries).toBe(0);
    });

    it('should return valid for a single entry', async () => {
      await service.record({
        userId: 'user-1',
        action: 'user.login',
        ip: '10.0.0.1',
        device: 'test',
      });

      const result = await service.verifyIntegrity();

      expect(result.valid).toBe(true);
      expect(result.totalEntries).toBe(1);
      expect(result.validEntries).toBe(1);
    });

    it('should return valid for a chain of multiple entries', async () => {
      for (let i = 0; i < 10; i++) {
        await service.record({
          userId: `user-${i}`,
          action: `action.${i}`,
          ip: `10.0.0.${i}`,
          device: `device-${i}`,
        });
      }

      const result = await service.verifyIntegrity();

      expect(result.valid).toBe(true);
      expect(result.totalEntries).toBe(10);
      expect(result.validEntries).toBe(10);
    });

    it('should detect tampering — modified action field', async () => {
      for (let i = 0; i < 5; i++) {
        await service.record({
          userId: `user-${i}`,
          action: `action.${i}`,
          ip: `10.0.0.${i}`,
          device: `device-${i}`,
        });
      }

      // Tamper with the 3rd entry's action field.
      storage.tamperEntry(2, 'action', 'tampered.action');

      const result = await service.verifyIntegrity();

      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBeDefined();
      expect(result.brokenAt!.index).toBe(2);
    });

    it('should detect tampering — modified currentHash', async () => {
      for (let i = 0; i < 3; i++) {
        await service.record({
          userId: `user-${i}`,
          action: `action.${i}`,
          ip: `10.0.0.${i}`,
          device: `device-${i}`,
        });
      }

      // Tamper with the 2nd entry's currentHash — breaks linkage to 3rd.
      storage.tamperEntry(1, 'currentHash', 'a'.repeat(64));

      const result = await service.verifyIntegrity();

      expect(result.valid).toBe(false);
      // The break is detected at entry index 1 (hash mismatch) or
      // index 2 (prevHash linkage mismatch).
      expect(result.brokenAt).toBeDefined();
    });

    it('should detect tampering — modified prevHash breaks linkage', async () => {
      for (let i = 0; i < 3; i++) {
        await service.record({
          userId: `user-${i}`,
          action: `action.${i}`,
          ip: `10.0.0.${i}`,
          device: `device-${i}`,
        });
      }

      // Tamper with the 2nd entry's prevHash.
      storage.tamperEntry(1, 'prevHash', 'b'.repeat(64));

      const result = await service.verifyIntegrity();

      expect(result.valid).toBe(false);
      expect(result.brokenAt!.index).toBe(1);
    });
  });

  // ─── getRecent ───────────────────────────────────────────────────────────

  describe('getRecent()', () => {
    it('should return entries in newest-first order', async () => {
      for (let i = 0; i < 5; i++) {
        await service.record({
          userId: `user-${i}`,
          action: `action.${i}`,
          ip: `10.0.0.${i}`,
          device: `device-${i}`,
        });
      }

      const recent = await service.getRecent(3);

      expect(recent).toHaveLength(3);
      expect(recent[0]!.action).toBe('action.4');
      expect(recent[1]!.action).toBe('action.3');
      expect(recent[2]!.action).toBe('action.2');
    });

    it('should default to 50 entries', async () => {
      // Just verify it doesn't throw with default.
      const recent = await service.getRecent();
      expect(recent).toEqual([]);
    });
  });
});
