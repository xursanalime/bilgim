/**
 * `modules/security/pii` — Task 28.3 (PII Masking & Crypto-Shredding).
 *
 * Public surface:
 *   - `PiiMaskingService` — detects and masks PII (email, phone, IP,
 *     card numbers) in arbitrary text. Used by log serializers and
 *     error handlers to prevent PII leakage (Req 28.6).
 *   - `CryptoShreddingService` — destroys per-user encryption keys
 *     to make encrypted data permanently unrecoverable when a user
 *     exercises their right-to-erasure (Req 28.7).
 *   - Pino serializers (`piiSerializers`, `piiRequestSerializer`,
 *     `piiErrorSerializer`, `piiGenericSerializer`) — drop-in Pino
 *     custom serializers that automatically mask PII in log output.
 */
export {
  PiiMaskingService,
  type PiiType,
  type PiiMatch,
  type PiiMaskingConfig,
} from './pii-masking.service';

export {
  CryptoShreddingService,
  USER_KEY_STORE,
  type CryptoShreddingResult,
  type ShreddingAuditEntry,
  type UserKeyStore,
} from './crypto-shredding.service';

export {
  piiSerializers,
  piiRequestSerializer,
  piiResponseSerializer,
  piiErrorSerializer,
  piiGenericSerializer,
} from './pii-serializer';
