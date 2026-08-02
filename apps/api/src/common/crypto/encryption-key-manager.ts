import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EncryptionError } from './encryption.errors';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** AES-256 needs exactly 32 bytes of key material. */
const KEY_BYTES = 32;

/**
 * Current key version. The active version is written into the
 * envelope so the decrypt-side can route to the correct historical
 * key after a rotation lands (Task 28.2). For now there is only one
 * version (`v1`) and the manager hands out the same buffer for every
 * lookup that matches it.
 */
export const ACTIVE_KEY_VERSION = 'v1' as const;

/**
 * Stable dev fallback key (32 bytes, base64 encoded). Generated once,
 * pinned in source so existing tests / `pnpm dev` round-trip without
 * having to plumb `MASTER_ENCRYPTION_KEY` through every fixture.
 *
 * **Never use this anywhere outside of dev / test.** Production refuses
 * to start without an explicit `MASTER_ENCRYPTION_KEY` (see
 * {@link EncryptionKeyManager}).
 */
const DEV_FALLBACK_KEY_BASE64 =
  'ZGV2LWVuY3J5cHRpb24ta2V5LWVkdWJyaWRnZS0zMmI=';

// ---------------------------------------------------------------------------
// Boot-time master-key validation
// ---------------------------------------------------------------------------

/**
 * Decode a master-key string (base64 or hex) into a 32-byte `Buffer`.
 * Throws `EncryptionError` with an actionable code so the bootstrap
 * can refuse to start with a malformed configuration.
 *
 * Accepted formats:
 *   - base64 of exactly 32 raw bytes (44 chars padded, 43 unpadded)
 *   - hex of 64 chars (32 bytes)
 *
 * Rejected:
 *   - missing / empty (`MASTER_KEY_MISSING`)
 *   - decodes to anything other than 32 bytes (`MASTER_KEY_INVALID`)
 */
export function decodeMasterKey(rawValue: string | undefined): Buffer {
  if (!rawValue || rawValue.trim().length === 0) {
    throw new EncryptionError(
      'MASTER_KEY_MISSING',
      'MASTER_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32`.',
    );
  }

  const trimmed = rawValue.trim();

  // Try hex first when the string only contains hex chars and is
  // exactly 64 characters — that disambiguates from base64.
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }

  let decoded: Buffer;
  try {
    decoded = Buffer.from(trimmed, 'base64');
  } catch (err) {
    throw new EncryptionError(
      'MASTER_KEY_INVALID',
      'MASTER_ENCRYPTION_KEY is not valid base64.',
      err,
    );
  }

  if (decoded.length !== KEY_BYTES) {
    throw new EncryptionError(
      'MASTER_KEY_INVALID',
      `MASTER_ENCRYPTION_KEY must decode to exactly ${KEY_BYTES} bytes; got ${decoded.length}.`,
    );
  }

  return decoded;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * `EncryptionKeyManager` — holds the active and historical master
 * keys used by `EncryptionService`.
 *
 * This is the seam where Task 28.2 (Vault / KMS integration + 90-day
 * rotation) plugs in. The current implementation reads a single key
 * from `MASTER_ENCRYPTION_KEY`; once 28.2 lands the same interface
 * (`getActiveKey`, `getKey`, `getActiveVersion`) backs onto a
 * versioned KMS map without any churn at the call sites.
 *
 * Why a separate class (instead of a constant inside the service):
 *   - Lets `EncryptionService` stay pure / stateless w.r.t. key
 *     resolution. The service just asks for "the active key" or
 *     "the key for version X" and the manager owns the policy.
 *   - Makes per-test substitution trivial: production code injects
 *     the real manager, tests construct a `new EncryptionKeyManager`
 *     directly with a known buffer.
 *   - Keeps the boot-time validation co-located with the storage so
 *     a misconfigured deployment fails as early as possible — the
 *     constructor either resolves a 32-byte key or throws.
 */
@Injectable()
export class EncryptionKeyManager {
  private readonly logger = new Logger(EncryptionKeyManager.name);
  private readonly keysByVersion: Map<string, Buffer>;
  private readonly activeVersion: string;

  /**
   * Two construction shapes are supported:
   *
   *   1. Direct injection of a master-key buffer — used by tests and
   *      by the Nest factory (`EncryptionModule`).
   *   2. Nest DI with `ConfigService` — when the manager is resolved
   *      out of the global module and no override is present, it
   *      reads `MASTER_ENCRYPTION_KEY` from config / env itself.
   *
   * The constructor always materialises at least one key (the active
   * one). Future versions will be appended in-process by
   * `loadHistoricalKey` (Task 28.2 hook below) without restarting.
   */
  constructor(
    @Optional() activeKey?: Buffer,
    @Optional() configService?: ConfigService,
  ) {
    let materialised: Buffer;

    if (activeKey) {
      if (!Buffer.isBuffer(activeKey)) {
        throw new EncryptionError(
          'MASTER_KEY_INVALID',
          'EncryptionKeyManager: active key must be a Buffer.',
        );
      }
      if (activeKey.length !== KEY_BYTES) {
        throw new EncryptionError(
          'MASTER_KEY_INVALID',
          `EncryptionKeyManager: active key must be ${KEY_BYTES} bytes; got ${activeKey.length}.`,
        );
      }
      materialised = Buffer.from(activeKey);
    } else {
      const raw =
        configService?.get<string>('MASTER_ENCRYPTION_KEY') ??
        process.env.MASTER_ENCRYPTION_KEY;
      const nodeEnv =
        configService?.get<string>('NODE_ENV') ?? process.env.NODE_ENV;

      if (raw && raw.trim().length > 0) {
        materialised = decodeMasterKey(raw);
      } else if (nodeEnv === 'production') {
        // Hard-stop the boot — production must always set a real key.
        throw new EncryptionError(
          'MASTER_KEY_MISSING',
          'MASTER_ENCRYPTION_KEY is required in production. Generate one with `openssl rand -base64 32`.',
        );
      } else {
        materialised = decodeMasterKey(DEV_FALLBACK_KEY_BASE64);
        this.logger.warn(
          `MASTER_ENCRYPTION_KEY not set; using the well-known dev fallback for ${
            nodeEnv ?? 'dev'
          } only. Set MASTER_ENCRYPTION_KEY before deploying to production.`,
        );
      }
    }

    this.activeVersion = ACTIVE_KEY_VERSION;
    this.keysByVersion = new Map<string, Buffer>([
      [ACTIVE_KEY_VERSION, materialised],
    ]);
  }

  /**
   * The version label that should be embedded in newly-created
   * envelopes. `EncryptionService` reads this on every `encrypt()`
   * call so a future rotation flips reads + writes atomically once
   * the new version is loaded into the manager.
   */
  getActiveVersion(): string {
    return this.activeVersion;
  }

  /**
   * Hand out the currently-active 32-byte key. Returns a fresh copy
   * so callers (or `gc`) can safely zero the buffer after use without
   * affecting subsequent calls.
   */
  getActiveKey(): Buffer {
    const key = this.keysByVersion.get(this.activeVersion);
    if (!key) {
      // This should be impossible given the constructor invariant,
      // but a defensive throw keeps the failure mode obvious if a
      // future maintainer accidentally drains the map.
      throw new EncryptionError(
        'MASTER_KEY_MISSING',
        `Active key version "${this.activeVersion}" is missing from the key manager.`,
      );
    }
    return Buffer.from(key);
  }

  /**
   * Resolve a historical key by version label. Used by the decrypt
   * path so envelopes written before a rotation still round-trip.
   *
   * Throws `UNSUPPORTED_VERSION` rather than `MASTER_KEY_MISSING`
   * because from the caller's perspective the failure is "this
   * binary does not know how to read this envelope" — which is
   * structurally identical to receiving a future-format payload.
   */
  getKey(version: string): Buffer {
    const key = this.keysByVersion.get(version);
    if (!key) {
      throw new EncryptionError(
        'UNSUPPORTED_VERSION',
        `EncryptionKeyManager: no key registered for version "${version}".`,
      );
    }
    return Buffer.from(key);
  }

  /**
   * **Task 28.2 seam.** Register an additional historical key under a
   * version label. Once 28.2 lands, the rotation worker calls this
   * with the previous key when a new active key is loaded, so reads
   * of pre-rotation envelopes continue to succeed.
   *
   * Re-registering the same `version` is rejected — keys are
   * immutable once loaded, mirroring real KMS behaviour where each
   * version is monotonic.
   */
  registerHistoricalKey(version: string, key: Buffer): void {
    if (key.length !== KEY_BYTES) {
      throw new EncryptionError(
        'MASTER_KEY_INVALID',
        `Historical key for version "${version}" must be ${KEY_BYTES} bytes; got ${key.length}.`,
      );
    }
    if (this.keysByVersion.has(version)) {
      throw new EncryptionError(
        'MASTER_KEY_INVALID',
        `Key version "${version}" is already registered.`,
      );
    }
    this.keysByVersion.set(version, Buffer.from(key));
  }

  /**
   * **Task 28.2 seam.** Promote a previously-registered historical
   * key to active. Used by zero-downtime rotation: the worker first
   * registers the new key under a fresh version, then atomically
   * switches `activeVersion` so subsequent encrypts use it.
   */
  promoteToActive(version: string): void {
    if (!this.keysByVersion.has(version)) {
      throw new EncryptionError(
        'UNSUPPORTED_VERSION',
        `Cannot promote unknown version "${version}" to active.`,
      );
    }
    // The cast keeps the public `activeVersion` type as `string`
    // (versions can grow past `v1`) while the read-side getter still
    // narrows to the literal when we're on the default.
    (this as unknown as { activeVersion: string }).activeVersion = version;
  }
}
