import { Prisma } from '@prisma/client';

import { EncryptionService } from './encryption.service';

/**
 * Maps a Prisma model name to the set of fields that should be
 * encrypted at rest. Keep this list small and explicit — every new
 * entry expands the blast radius of an encryption bug.
 *
 * The extension treats unknown models as plaintext so dropping a
 * model from the schema doesn't accidentally surface ciphertext as a
 * decryption failure later.
 *
 * `kind`:
 *   - `string`  — the column is a TEXT/VARCHAR storing the envelope
 *                 directly. Read-side `decrypt()` runs unconditionally
 *                 when the value looks like an envelope, otherwise the
 *                 raw value is returned (rollout-safe).
 *   - `json`    — the column is JSONB. We serialise the JSON to a
 *                 string before encrypting and parse on read. This
 *                 keeps the entire payload opaque at the database
 *                 layer (cardLastFour, accountId, anything in the
 *                 JSON) without per-key ceremony.
 *
 * Demonstration coverage (Task 28.1, point 4):
 *   - `User.phone`              — plaintext PII (string envelope)
 *   - `PaymeTransaction.account` — payment account JSON (json envelope)
 */
export interface EncryptedFieldSpec {
  kind: 'string' | 'json';
}

export interface EncryptedFieldMap {
  [model: string]: { [field: string]: EncryptedFieldSpec };
}

/**
 * Default encrypted-field map. Bounded contexts can override per-test
 * by passing their own map to {@link createPrismaEncryptionExtension}.
 *
 * Coverage (Req 28.3 — column-level encryption mandate):
 *   - `User.phone`                    — high-PII contact info
 *   - `User.address`                  — high-PII residence info
 *   - `PaymeTransaction.account`      — payer account JSON
 *                                       (e.g. `{ "phone": "+998..." }`)
 *   - `PaymeTransaction.cardLastFour` — last four PAN digits, treated
 *                                       as restricted PCI data
 *
 * Fields are listed unconditionally even when the underlying Prisma
 * column hasn't shipped yet. The extension skips fields that aren't
 * present on the row (`if (!(field in obj)) continue;`), so adding
 * the column later is a no-code-change rollout.
 */
export const DEFAULT_ENCRYPTED_FIELDS: EncryptedFieldMap = {
  User: {
    phone: { kind: 'string' },
    address: { kind: 'string' },
  },
  PaymeTransaction: {
    account: { kind: 'json' },
    cardLastFour: { kind: 'string' },
  },
};

// ---------------------------------------------------------------------------
// Hook factory — testable in isolation
// ---------------------------------------------------------------------------

/**
 * Shape of the `params.args` object as Prisma passes it to the
 * `$allOperations` hook. `unknown` keeps us decoupled from Prisma's
 * internal generated types (which vary by model).
 */
export type PrismaOperationArgs = Record<string, unknown>;

/**
 * The `$allOperations` callback signature exposed by `Prisma.defineExtension`.
 * Capturing it as a top-level type lets us unit-test the hook
 * directly without instantiating an extension.
 */
export type PrismaAllOperationsHook = (params: {
  model?: string;
  operation: string;
  args: PrismaOperationArgs;
  query: (args: PrismaOperationArgs) => Promise<unknown>;
}) => Promise<unknown>;

/**
 * Build the `$allOperations` hook. Exported so tests can call it
 * directly — the runtime extension wrapper (`Prisma.defineExtension`)
 * just delegates to this function.
 */
export function createEncryptionAllOperationsHook(
  enc: EncryptionService,
  fields: EncryptedFieldMap = DEFAULT_ENCRYPTED_FIELDS,
): PrismaAllOperationsHook {
  return async function $allOperations({ model, operation, args, query }) {
    const modelSpec = model ? fields[model] : undefined;

    // Encrypt write-side fields BEFORE the query is dispatched.
    // We only mutate the args object on operations that carry a
    // `data` payload (create, update, upsert, createMany, etc.) so
    // reads aren't slowed down with no-op walks.
    if (modelSpec && operation && OPS_WITH_DATA.has(operation)) {
      encryptArgs(args, modelSpec, enc);
    }

    // Run the query.
    const result = await query(args);

    // Decrypt read-side fields. The hook runs on every operation —
    // including writes (which may return the row in `RETURNING` form).
    // When a model has no encrypted spec, we return the raw result
    // unchanged.
    if (!modelSpec) return result;
    return decryptResult(result, modelSpec, enc);
  };
}

// ---------------------------------------------------------------------------
// Prisma extension wrapper
// ---------------------------------------------------------------------------

/**
 * Build a `Prisma.defineExtension` that auto-encrypts encrypted fields
 * on write and auto-decrypts them on read.
 *
 * Caveats and design trade-offs:
 *   - **No filtering on encrypted columns.** Equality / contains
 *     queries against an encrypted field can't match the underlying
 *     plaintext (different IV per row → different ciphertext). The
 *     `User.phone` `@unique` index is therefore reduced to "unique
 *     ciphertext" — collisions on plaintext are still possible if two
 *     users encrypt different phones to the same envelope, but that
 *     is cryptographically improbable. For login-by-phone (none today)
 *     a separate deterministic-tokenisation pass would be needed.
 *   - **Per-context encryption is opt-in.** This extension always
 *     encrypts with the *master* key (no `userId` context) so a
 *     migration / admin tooling can decrypt any row without knowing
 *     the owning user. Per-user contexts remain available for callers
 *     that go through `EncryptionService` directly (e.g. crypto-shred
 *     workflows in Task 28.3).
 *   - **Rollout safety.** On read we only attempt decryption when the
 *     value looks like an envelope (`v1:...`). Legacy plaintext rows
 *     pass through unchanged so the rollout can ship before the
 *     backfill completes.
 */
export function createPrismaEncryptionExtension(
  enc: EncryptionService,
  fields: EncryptedFieldMap = DEFAULT_ENCRYPTED_FIELDS,
) {
  const hook = createEncryptionAllOperationsHook(enc, fields);
  return Prisma.defineExtension({
    name: 'edubridge-encryption',
    query: {
      $allModels: {
        $allOperations: hook as never,
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Operations whose `args` carry mutable data payloads. We avoid a hot
 * `if/else` chain by hashing them into a Set.
 */
const OPS_WITH_DATA = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
]);

/**
 * Walk the write `args` and replace plaintext field values with their
 * encrypted envelopes. This is purposefully **mutating** — Prisma hands
 * us a fresh object per call, so the in-place edit avoids a deep
 * clone of potentially large payloads (e.g. nested `connectOrCreate`).
 *
 * We DO NOT recurse into nested relation writes — Prisma's nested
 * `create`/`connect` shapes use the same field names but represent
 * different models. Without per-model resolution it's safer to leave
 * nested encryption to the caller (or to the bounded context's own
 * service-layer mapper).
 */
function encryptArgs(
  args: Record<string, unknown>,
  modelSpec: Record<string, EncryptedFieldSpec>,
  enc: EncryptionService,
): void {
  // `data` shows up on create / update / upsert / createMany.
  const data = args?.['data'];
  if (Array.isArray(data)) {
    for (const row of data) {
      if (row && typeof row === 'object') {
        encryptObject(row as Record<string, unknown>, modelSpec, enc);
      }
    }
  } else if (data && typeof data === 'object') {
    encryptObject(data as Record<string, unknown>, modelSpec, enc);
  }

  // Upsert has both `create` and `update` shapes.
  const create = args?.['create'];
  if (create && typeof create === 'object' && !Array.isArray(create)) {
    encryptObject(create as Record<string, unknown>, modelSpec, enc);
  }
  const update = args?.['update'];
  if (update && typeof update === 'object' && !Array.isArray(update)) {
    encryptObject(update as Record<string, unknown>, modelSpec, enc);
  }
}

/**
 * Replace each encrypted field in `obj` with its envelope. Skips
 * `null` (means "clear the column") and existing envelopes (means the
 * caller pre-encrypted, e.g. during a backfill).
 *
 * Prisma's `set:`/`increment:` style update operators are passed
 * through unchanged because the field's value in those cases is an
 * object like `{ set: 'value' }` — we transparently rewrap the
 * `set` payload.
 */
function encryptObject(
  obj: Record<string, unknown>,
  modelSpec: Record<string, EncryptedFieldSpec>,
  enc: EncryptionService,
): void {
  for (const [field, spec] of Object.entries(modelSpec)) {
    if (!(field in obj)) continue;
    const value = obj[field];

    // Prisma update operators: `{ set: <value> }`.
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      'set' in (value as Record<string, unknown>)
    ) {
      const inner = (value as { set: unknown }).set;
      const encrypted = encryptValue(inner, spec, enc);
      if (encrypted !== undefined) {
        (value as { set: unknown }).set = encrypted;
      }
      continue;
    }

    const encrypted = encryptValue(value, spec, enc);
    if (encrypted !== undefined) obj[field] = encrypted;
  }
}

/**
 * Encrypt a single value if it looks plaintext. Returns `undefined`
 * to signal "leave the existing value as-is" so the caller can keep
 * `null` columns intact.
 */
function encryptValue(
  value: unknown,
  spec: EncryptedFieldSpec,
  enc: EncryptionService,
): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string' && enc.isEnvelope(value)) {
    // Already encrypted (probably from a backfill script). Idempotent.
    return undefined;
  }

  if (spec.kind === 'string') {
    if (typeof value !== 'string') return undefined;
    return enc.encrypt(value);
  }

  // kind === 'json': stringify first, encrypt the JSON text.
  try {
    return enc.encrypt(JSON.stringify(value));
  } catch {
    return undefined;
  }
}

/**
 * Walk the read result and decrypt encrypted fields in place. Handles:
 *   - `null` results from `findUnique` (passes through)
 *   - single object (typical findUnique / create / update)
 *   - array (findMany / createMany returning rows)
 *
 * Decryption is always best-effort: a malformed legacy plaintext is
 * returned unchanged so the rollout can ship before the migration
 * completes. Hard-tampered envelopes (auth-tag mismatch) raise a
 * typed error so callers see the failure in the response.
 */
function decryptResult<T>(
  result: T,
  modelSpec: Record<string, EncryptedFieldSpec>,
  enc: EncryptionService,
): T {
  if (result === null || result === undefined) return result;
  if (Array.isArray(result)) {
    for (const row of result) decryptObject(row, modelSpec, enc);
    return result;
  }
  if (typeof result === 'object') {
    decryptObject(result as Record<string, unknown>, modelSpec, enc);
  }
  return result;
}

/**
 * Decrypt encrypted fields in place. Skips fields that aren't
 * envelopes so legacy plaintext rows pass through unchanged.
 */
function decryptObject(
  obj: unknown,
  modelSpec: Record<string, EncryptedFieldSpec>,
  enc: EncryptionService,
): void {
  if (!obj || typeof obj !== 'object') return;
  const row = obj as Record<string, unknown>;
  for (const [field, spec] of Object.entries(modelSpec)) {
    if (!(field in row)) continue;
    const value = row[field];
    if (typeof value !== 'string') continue; // null / non-string passthrough
    if (!enc.isEnvelope(value)) continue;

    const plaintext = enc.decrypt(value);
    if (spec.kind === 'string') {
      row[field] = plaintext;
    } else {
      try {
        row[field] = JSON.parse(plaintext);
      } catch {
        // The envelope decoded to non-JSON — leave the raw plaintext so
        // an operator can debug, rather than silently dropping data.
        row[field] = plaintext;
      }
    }
  }
}
