import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { EncryptionKeyManager } from './encryption-key-manager';
import {
  ENCRYPTION_KEY_MANAGER_TOKEN,
  EncryptionService,
} from './encryption.service';

/**
 * Build the `EncryptionKeyManager` factory used by the
 * `ENCRYPTION_KEY_MANAGER_TOKEN` provider.
 *
 * Exported so unit tests can drive it directly with a stub
 * `ConfigService`, without relying on Nest's DI to invoke the
 * factory eagerly during `compile()`.
 *
 * The key manager itself owns the boot-time validation:
 *   - In production, missing `MASTER_ENCRYPTION_KEY` throws
 *     `MASTER_KEY_MISSING` and the API refuses to start.
 *   - In dev / test the manager falls back to a stable well-known
 *     key (logged at WARN once) so existing test suites that don't
 *     plumb the env var keep passing.
 */
export function encryptionKeyManagerFactory() {
  return (config: ConfigService): EncryptionKeyManager => {
    return new EncryptionKeyManager(undefined, config);
  };
}

/**
 * `CryptoModule` — globally available at-rest encryption service
 * (Task 28.1).
 *
 * Why `@Global()`:
 *   - Field-level encryption is a cross-cutting concern. Auth,
 *     Billing, Admin, Reports, MFA, and any future PII-touching
 *     module need access without re-importing the module each time.
 *   - The service holds a reference to the `EncryptionKeyManager`
 *     which itself wraps an immutable master key — there is exactly
 *     one set of keys per process and DI should reflect that.
 *
 * Boot-time behaviour (Task 28.1, "boot-time validation" point):
 *   - The `MASTER_ENCRYPTION_KEY` env var is decoded by the
 *     `EncryptionKeyManager` constructor during the factory
 *     invocation. If the key is set but the wrong length the factory
 *     throws an `EncryptionError`, which Nest surfaces as a startup
 *     failure — the API refuses to come up.
 *   - In production a missing env var is also a hard failure
 *     (`MASTER_KEY_MISSING`).
 *   - Outside production we silently use a stable well-known dev
 *     key so unit tests, ts-node scripts, and `pnpm dev` don't have
 *     to plumb the env var through every fixture. The fallback is
 *     logged at WARN once with a clear "do not use in production"
 *     message; production deployments must always set the real key.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: ENCRYPTION_KEY_MANAGER_TOKEN,
      useFactory: encryptionKeyManagerFactory(),
      inject: [ConfigService],
    },
    // Bind the concrete class to the same instance for callers that
    // want to inject the manager by type (e.g. Task 28.2 rotation
    // worker, or admin tooling that needs to register a historical
    // key).
    {
      provide: EncryptionKeyManager,
      useExisting: ENCRYPTION_KEY_MANAGER_TOKEN,
    },
    EncryptionService,
  ],
  exports: [
    EncryptionService,
    EncryptionKeyManager,
    ENCRYPTION_KEY_MANAGER_TOKEN,
  ],
})
export class CryptoModule {}

/**
 * Backwards-compatible alias. Prior internal docs and a handful of
 * call sites import `EncryptionModule` directly; we keep the alias
 * so those keep building while the canonical name is `CryptoModule`
 * (matches the task brief and the directory layout).
 */
export { CryptoModule as EncryptionModule };
