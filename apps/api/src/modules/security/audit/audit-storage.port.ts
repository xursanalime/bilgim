/**
 * Port interface for audit trail storage backends.
 *
 * Task 30.3, Requirements 32.3 / 32.4.
 *
 * Implementations:
 *   - `AuditDbAdapter` — Prisma-based append-only DB storage
 *   - (future) S3 WORM adapter — Object Lock immutable archival
 *
 * The port enforces append-only semantics: there is no `update` or
 * `delete` method. Once written, an audit entry is immutable.
 */

/** Shape of a single audit trail entry. */
export interface AuditEntry {
  /** Unique identifier (UUIDv4). */
  id: string;
  /** User who performed the action. */
  userId: string;
  /** Action identifier (e.g., 'user.login', 'admin.permission_change'). */
  action: string;
  /** ISO-8601 timestamp of when the action occurred. */
  timestamp: string;
  /** Client IP address. */
  ip: string;
  /** Device/user-agent string. */
  device: string;
  /** Arbitrary context payload (reason, affected resource, etc.). */
  context: Record<string, unknown>;
  /** SHA-256 hash of the previous entry in the chain (genesis = '0'.repeat(64)). */
  prevHash: string;
  /** SHA-256 hash of this entry: SHA-256(id + userId + action + timestamp + ip + device + JSON(context) + prevHash). */
  currentHash: string;
}

/** Injection token for the audit storage adapter. */
export const AUDIT_STORAGE = Symbol('AUDIT_STORAGE');

/**
 * Storage port — append-only contract for audit trail persistence.
 */
export interface AuditStoragePort {
  /**
   * Append a new audit entry. Must be atomic — partial writes are
   * not acceptable for tamper-proof guarantees.
   */
  append(entry: AuditEntry): Promise<void>;

  /**
   * Retrieve the most recent N entries, ordered newest-first.
   * Used by the verification endpoint to walk the hash chain.
   */
  findRecent(limit: number): Promise<AuditEntry[]>;

  /**
   * Retrieve the single most recent entry (the chain head).
   * Returns `null` when the log is empty (genesis state).
   */
  findLatest(): Promise<AuditEntry | null>;

  /**
   * Retrieve all entries in chronological order (oldest-first).
   * Used for full-chain integrity verification.
   * Supports optional pagination via offset/limit.
   */
  findAll(offset?: number, limit?: number): Promise<AuditEntry[]>;

  /**
   * Count total entries in the audit log.
   */
  count(): Promise<number>;
}
