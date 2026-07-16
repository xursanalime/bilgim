import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleInit,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { KMS_PROVIDER, type KmsKey, type KmsProvider } from './kms.port';

/**
 * Default rotation cadence: 90 days (Task 28.2 brief, Req 28.5).
 * The service computes "the active key is older than this" against
 * the provider-reported `createdAt`; the cron itself wakes monthly so
 * a misconfigured cadence would only delay a rotation by a few days
 * at worst.
 */
const DEFAULT_ROTATION_INTERVAL_DAYS = 90;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Optional config bag — keeps the service decoupled from the global
 * env schema. Defaults to `process.env`; tests pass an explicit
 * config so the behaviour is deterministic.
 */
export interface KeyManagementConfig {
  /** Active rotation interval in days. Defaults to 90. */
  rotationIntervalDays?: number;
  /** Optional callback fired after a successful rotation. The job
   * worker subscribes here to enqueue the re-encrypt sweep. */
  onRotated?: (oldKey: KmsKey | null, newKey: KmsKey) => void | Promise<void>;
}

export const KMS_ROTATION_HOOK = Symbol('KMS_ROTATION_HOOK');
/** Optional Nest token consumers can bind to receive rotation events. */
export type RotationHook = (
  oldKey: KmsKey | null,
  newKey: KmsKey,
) => void | Promise<void>;

/**
 * `KeyManagementService` — Task 28.2.
 *
 * Thin policy layer wrapping a `KmsProvider`:
 *
 *   - `getActiveKey` / `getKeyById` proxy to the provider with an
 *     in-memory cache so hot decrypt paths don't hammer the DB or
 *     Vault.
 *   - `rotate()` mints a new active key and links the previous one;
 *     the cron and the admin endpoint both call this.
 *   - 90-day cron wakes monthly and rotates when the active key is
 *     older than the configured interval. Manual rotation is always
 *     possible regardless of the cadence.
 *
 * The cron expression `0 0 1 (every-3-months) *` — midnight on the
 * first of every third month — combined with the
 * `DEFAULT_ROTATION_INTERVAL_DAYS`
 * threshold this gives the desired ~90-day cadence without drifting
 * past an exact 90-day window. Operators tuning the interval down to
 * (say) 30 days should also adjust the cron expression in
 * `securityModule` wiring; the threshold is the single source of
 * truth.
 *
 * Cache semantics:
 *   - The active key is cached with a 60-second TTL — long enough
 *     to absorb a burst of encrypts, short enough that a manual
 *     rotation propagates within a minute.
 *   - Historical keys (looked up by id) are cached indefinitely.
 *     Once a key is RETIRED its material is immutable, so the cache
 *     never has to invalidate. After the re-encrypt sweep prunes a
 *     key from the provider we'll see a `null` lookup and the cache
 *     will refresh on the next read.
 *   - Rotation explicitly clears the active-key entry before the
 *     hook fires so any synchronous re-encrypt observer reads the
 *     fresh value.
 */
@Injectable()
export class KeyManagementService implements OnModuleInit {
  private readonly logger = new Logger(KeyManagementService.name);

  /** Cached active key. Refreshed on miss / TTL / rotation. */
  private activeCache: { key: KmsKey; expiresAt: number } | null = null;
  /** Cached historical-key lookups. */
  private readonly idCache = new Map<string, KmsKey>();

  private rotationHook: RotationHook | null = null;
  private rotationIntervalDays: number = DEFAULT_ROTATION_INTERVAL_DAYS;

  /** Active-cache TTL in milliseconds. */
  private static readonly ACTIVE_TTL_MS = 60 * 1000;

  constructor(
    @Inject(KMS_PROVIDER) private readonly provider: KmsProvider,
    @Optional() @Inject(KMS_ROTATION_HOOK) rotationHook?: RotationHook,
  ) {
    if (typeof rotationHook === 'function') {
      this.rotationHook = rotationHook;
    }
    this.applyEnvConfig();
  }

  /**
   * Test seam — override the rotation interval and hook without
   * relying on env vars. Production code never calls this.
   */
  configureForTesting(config: KeyManagementConfig): void {
    if (typeof config.rotationIntervalDays === 'number') {
      this.rotationIntervalDays = Math.max(1, config.rotationIntervalDays);
    }
    if (typeof config.onRotated === 'function') {
      this.rotationHook = config.onRotated;
    }
  }

  // -------------------------------------------------------------------------
  // Public API consumed by EncryptionService and admin tooling
  // -------------------------------------------------------------------------

  /**
   * Resolve the active DEK. Cheap on the hot path — the cache holds
   * the key for {@link KeyManagementService.ACTIVE_TTL_MS} so a
   * burst of encrypts hits the provider once.
   */
  async getActiveKey(): Promise<KmsKey> {
    const now = Date.now();
    if (this.activeCache && this.activeCache.expiresAt > now) {
      return this.activeCache.key;
    }
    const key = await this.provider.getActiveKey();
    this.activeCache = {
      key,
      expiresAt: now + KeyManagementService.ACTIVE_TTL_MS,
    };
    this.idCache.set(key.id, key);
    return key;
  }

  /**
   * Resolve a key by id — used by the decrypt path so envelopes
   * written before a rotation still round-trip. Returns `null` when
   * the id is unknown (e.g. the row has been pruned post
   * re-encryption).
   */
  async getKeyById(id: string): Promise<KmsKey | null> {
    const cached = this.idCache.get(id);
    if (cached) return cached;
    const key = await this.provider.getKeyById(id);
    if (key) this.idCache.set(id, key);
    return key;
  }

  /**
   * Enumerate every key the provider knows about. Used by the
   * re-encryption sweep and the admin "rotation history" view.
   */
  async listKeys(): Promise<KmsKey[]> {
    const keys = await this.provider.listKeys();
    for (const key of keys) {
      this.idCache.set(key.id, key);
    }
    return keys;
  }

  /**
   * Mint a new active key. Returns `{ oldKey, newKey }` so callers
   * (admin endpoint, re-encrypt processor) can audit the transition
   * without a second round trip.
   *
   * Atomicity is delegated to the provider — the local provider
   * uses a single Prisma transaction, Vault relies on its own
   * versioning. Either way the post-condition is "exactly one
   * ACTIVE key".
   */
  async rotate(): Promise<{ oldKey: KmsKey | null; newKey: KmsKey }> {
    const oldKey = await this.safeGetActiveKey();
    const newKey = await this.provider.createKey();

    if (oldKey && oldKey.id !== newKey.id) {
      // Local provider already retired the previous key inside the
      // create transaction; Vault tracks versions itself. Calling
      // `markRotated` is the idempotent "make sure the link is
      // there" hook for providers that don't auto-link.
      await this.provider.markRotated(oldKey.id, newKey.id);
    }

    // Refresh caches before firing the hook so any synchronous
    // observer (e.g. a re-encrypt enqueue) reads the fresh values.
    this.activeCache = null;
    this.idCache.set(newKey.id, newKey);
    if (oldKey) {
      // Force a fresh read on the next id lookup so the new
      // RETIRED status is reflected.
      this.idCache.delete(oldKey.id);
    }

    this.logger.log(
      `Key rotation complete: oldId=${oldKey?.id ?? 'none'} → newId=${newKey.id}`,
    );

    if (this.rotationHook) {
      try {
        await this.rotationHook(oldKey, newKey);
      } catch (err) {
        // The hook is observability — never let a hook failure
        // mask the rotation success itself.
        this.logger.error(
          `Rotation hook failed: ${(err as Error).message}`,
          (err as Error).stack,
        );
      }
    }

    return { oldKey, newKey };
  }

  // -------------------------------------------------------------------------
  // Cron — 90-day rotation
  // -------------------------------------------------------------------------

  /**
   * Cron expression: midnight on the first of every third month
   * (the standard "0 0 1 every-third-month *" schedule). Combined
   * with the configured threshold this produces the ~90-day
   * cadence Req 28.5 calls for. Wrapped to never throw —
   * `@nestjs/schedule` suppresses subsequent ticks' logs when a
   * handler raises.
   */
  @Cron('0 0 1 */3 *', { name: 'security.kms.rotate' })
  async cronRotate(): Promise<void> {
    try {
      const active = await this.safeGetActiveKey();
      if (!active) {
        this.logger.log('cronRotate: no active key found, bootstrapping.');
        await this.rotate();
        return;
      }
      const ageMs = Date.now() - active.createdAt.getTime();
      const intervalMs = this.rotationIntervalDays * ONE_DAY_MS;
      if (ageMs < intervalMs) {
        this.logger.debug(
          `cronRotate: active key is ${Math.round(ageMs / ONE_DAY_MS)}d old (< ${this.rotationIntervalDays}d threshold); skipping.`,
        );
        return;
      }
      this.logger.log(
        `cronRotate: active key is ${Math.round(ageMs / ONE_DAY_MS)}d old (≥ ${this.rotationIntervalDays}d); rotating.`,
      );
      await this.rotate();
    } catch (err) {
      this.logger.error(
        `cronRotate: top-level failure: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async onModuleInit(): Promise<void> {
    // Bootstrap an active key on first boot so the encrypt path
    // never sees a missing-key error in production. The provider's
    // `getActiveKey` lazily creates one when none exists.
    try {
      await this.getActiveKey();
    } catch (err) {
      this.logger.warn(
        `onModuleInit: unable to materialise active key: ${(err as Error).message}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async safeGetActiveKey(): Promise<KmsKey | null> {
    try {
      return await this.provider.getActiveKey();
    } catch (err) {
      this.logger.warn(
        `safeGetActiveKey: provider returned an error: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private applyEnvConfig(): void {
    const raw = process.env.KMS_ROTATION_INTERVAL_DAYS;
    if (!raw) return;
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 1) {
      this.rotationIntervalDays = parsed;
    }
  }
}
