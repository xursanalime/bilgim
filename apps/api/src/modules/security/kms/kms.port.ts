/**
 * `KmsProvider` — Task 28.2.
 *
 * Pluggable storage / lifecycle layer for at-rest data-encryption
 * keys (DEKs). The provider is the seam between
 * `KeyManagementService` (the policy: rotation cadence, zero-downtime
 * promote, re-encrypt scheduling) and the actual key vault (the
 * mechanism: a Postgres table, HashiCorp Vault Transit, AWS KMS, …).
 *
 * Two implementations ship today:
 *
 *   - `LocalKmsProvider`  — keys live in the Prisma `EncryptionKey`
 *     table, wrapped by the master key. Suitable for dev /
 *     single-tenant deployments; needs no extra infrastructure.
 *   - `VaultKmsProvider`  — keys are issued by HashiCorp Vault's
 *     Transit secrets engine over HTTP. Falls back to the local
 *     provider when `VAULT_ADDR` is not set.
 *
 * The active implementation is selected by `KMS_PROVIDER`
 * (`local` / `vault`, default `local`) and bound by `SecurityModule`.
 *
 * Shape choices:
 *   - `Key.id` is opaque to the caller. The local provider uses
 *     Prisma `cuid()`, Vault uses its own version label. Callers
 *     embed the id in the encryption envelope and look it up via
 *     {@link KmsProvider.getKeyById} on decrypt.
 *   - `Key.material` is the raw 32-byte key buffer (AES-256). It
 *     never leaves a provider's local memory once handed out — the
 *     `EncryptionService` zeroes it after use. **Never persist this
 *     value verbatim** outside the provider.
 *   - `markRotated` is intentionally NOT a generic "update key"
 *     method. The whole rotation lifecycle (create new active,
 *     retire old, link the two) is the provider's responsibility,
 *     so the policy layer cannot accidentally produce two `ACTIVE`
 *     rows or orphan a `RETIRED` one.
 */

/**
 * Lifecycle status of a data-encryption key. Mirrors the Prisma
 * enum so the local provider can return DB rows verbatim.
 */
export type KmsKeyStatus = 'ACTIVE' | 'RETIRED';

/**
 * In-memory representation of a single key. The `material` field
 * carries the raw 32-byte AES-256 buffer; consumers that are
 * memory-sensitive should treat it as ephemeral.
 */
export interface KmsKey {
  /** Opaque provider-assigned id. Embed in the encryption envelope. */
  id: string;
  /** Raw 32-byte AES-256 key material. */
  material: Buffer;
  /** Lifecycle status. Always `ACTIVE` for the result of `getActiveKey`. */
  status: KmsKeyStatus;
  /** Wall-clock creation time. */
  createdAt: Date;
  /** Wall-clock retirement time, populated once `status === 'RETIRED'`. */
  retiredAt?: Date | null;
  /**
   * Forward pointer set by `markRotated(oldId, newId)`. Lets reports
   * trace which key replaced which without scanning the whole table.
   */
  rotatedToId?: string | null;
}

/**
 * Pluggable provider contract — see file-level JSDoc.
 *
 * Implementations MUST:
 *   - Guarantee at most one `ACTIVE` key at any moment. `createKey`
 *     and `markRotated` are the two hooks that maintain this
 *     invariant; they may transactionally retire the previous active
 *     row before inserting a new one.
 *   - Return defensively-copied `Buffer`s for `material` so callers
 *     can mutate / zero them without affecting subsequent lookups.
 *   - Be safe to call concurrently. Cron-driven rotations and
 *     manual ops triggers can race; using a unique partial index
 *     (`WHERE status = 'ACTIVE'`) at the storage layer is the
 *     recommended pattern.
 */
export interface KmsProvider {
  /**
   * Return the currently-active key. Throws if none exists — the
   * service bootstraps a key the first time `KeyManagementService`
   * starts up so this should only fail on a misconfigured backend.
   */
  getActiveKey(): Promise<KmsKey>;

  /**
   * List every key the provider knows about (ACTIVE + RETIRED).
   * Used by the re-encryption job to walk historical envelopes and
   * by the admin panel to surface rotation state.
   */
  listKeys(): Promise<KmsKey[]>;

  /**
   * Resolve a key by its provider id. Must succeed for every
   * non-pruned key — callers use this on the decrypt path so a
   * read against a retired-but-not-yet-recycled key still works.
   * Returns `null` when the id is unknown (e.g. the key was pruned
   * after re-encryption finished).
   */
  getKeyById(id: string): Promise<KmsKey | null>;

  /**
   * Mint a new active key. The provider MUST atomically retire the
   * previous active key (if any) and link them with `rotatedToId =
   * oldId` so callers can introspect rotation history. The returned
   * key is the freshly-minted ACTIVE one.
   */
  createKey(): Promise<KmsKey>;

  /**
   * Stamp an explicit "rotated FROM `oldId` TO `newId`" link on the
   * old row. Most providers will already do this inside `createKey`;
   * this method is the manual fallback used by `KeyManagementService`
   * to fix up bookkeeping when rotation is driven by an external
   * trigger (e.g. an out-of-band Vault rotation). Idempotent — calling
   * it twice with the same arguments is a no-op.
   */
  markRotated(oldId: string, newId: string): Promise<void>;
}

/**
 * Symbol used by `SecurityModule` to bind the active provider into
 * the Nest DI graph. Consumers depend on the abstract contract via
 * `@Inject(KMS_PROVIDER) provider: KmsProvider` so swapping
 * implementations is one line of module wiring.
 */
export const KMS_PROVIDER = Symbol('KMS_PROVIDER');
