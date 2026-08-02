/**
 * Shared type aliases for the `common/security` surface (Task 28.1).
 *
 * These are documentation-only nominal types — they help readers and
 * IDEs distinguish encrypted column values from plaintext strings,
 * but are erased at runtime. They are NOT generated from / wired into
 * Prisma; database columns that hold encrypted material are still
 * typed as `string` in `schema.prisma` and we lean on the type alias
 * here to flag them at the application layer.
 */

declare const encryptedFieldBrand: unique symbol;

/**
 * Branded alias for a string value produced by `EncryptionService.encrypt(...)`.
 *
 * The brand is purely a TypeScript nominal-typing trick — at runtime
 * the value is a plain `string` shaped like
 * `v1:<iv>:<tag>:<ciphertext>` (each segment base64url-encoded). We
 * tag the type so that:
 *
 *   - Service signatures can advertise "this column / field stores
 *     ciphertext" without reaching for documentation comments.
 *   - Accidentally passing a plaintext through a function that
 *     expects the encrypted form fails type-check.
 *   - Reverse direction — passing ciphertext where plaintext is
 *     expected — also fails because the brand intersects with
 *     `string` but is not assignable from a bare `string`.
 *
 * To produce a value of this type, callers must funnel through the
 * `EncryptionService.encrypt` API, which performs the cast internally.
 * The type is intentionally not exported with a constructor helper —
 * we want every assignment to go through the service so the wire
 * format stays in one place.
 *
 * Example usage:
 *
 * ```ts
 * // Repository contract — phone is stored encrypted at rest.
 * interface UserRow {
 *   id: string;
 *   email: string;
 *   phoneCipher: EncryptedField | null;
 * }
 * ```
 */
export type EncryptedField = string & {
  readonly [encryptedFieldBrand]: never;
};
