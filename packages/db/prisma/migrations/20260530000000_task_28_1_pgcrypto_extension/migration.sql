-- Task 28.1 — Data Protection: AES-256-GCM at-rest encryption.
--
-- The application-layer envelope encryption (see
-- `apps/api/src/common/crypto/encryption.service.ts` and the
-- `modules/security/encryption/*` re-export surface) is the primary
-- mechanism for column-level encryption of:
--
--   * User.phone                    (string envelope)
--   * User.address                  (string envelope, when shipped)
--   * PaymeTransaction.account      (json envelope)
--   * PaymeTransaction.cardLastFour (string envelope, when shipped)
--
-- The `pgcrypto` extension is enabled here as a defence-in-depth
-- layer: it provides DB-level `pgp_sym_encrypt()` / `pgp_sym_decrypt()`
-- for any future columns that need transparent encryption inside SQL
-- (e.g. backup-time payload encryption, ad-hoc analytics queries that
-- must round-trip ciphertext outside the application layer).
--
-- Idempotent — `CREATE EXTENSION IF NOT EXISTS` is a no-op when the
-- extension is already loaded by the earlier
-- `20260525172000_extensions_indexes_triggers` migration. Re-asserting
-- it here keeps the encryption surface auditable from a single
-- migration when the DB-level helpers are eventually adopted.
--
-- Requirements: 28.1, 28.3.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Document the convention. The application-layer envelope is the
-- source of truth; pgcrypto is reserved for future DB-only use cases.
COMMENT ON EXTENSION "pgcrypto" IS
  'Phase 10 / Task 28.1: defence-in-depth for column-level encryption. '
  'Application-layer envelope encryption (AES-256-GCM) is primary; '
  'pgcrypto is reserved for SQL-level helpers like pgp_sym_encrypt() '
  'when an operation must round-trip ciphertext outside the app.';
