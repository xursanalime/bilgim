import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';

import {
  CryptoModule,
  encryptionKeyManagerFactory,
} from './crypto.module';
import { EncryptionKeyManager } from './encryption-key-manager';
import { EncryptionError } from './encryption.errors';
import {
  ENCRYPTION_KEY_MANAGER_TOKEN,
  EncryptionService,
} from './encryption.service';

/**
 * Wiring tests for `CryptoModule` (Task 28.1).
 *
 *   - DI provides a working `EncryptionService` from a base64 env var.
 *   - The module falls back to a stable dev key in dev/test when the
 *     env var is missing (so existing tests don't have to plumb a key).
 *   - In production the module refuses to start without the env var.
 *   - The same `EncryptionKeyManager` instance is bound under both
 *     the symbol token and the class token.
 */

describe('CryptoModule — DI wiring', () => {
  it('builds an EncryptionService that round-trips when MASTER_ENCRYPTION_KEY is supplied', async () => {
    const key = randomBytes(32).toString('base64');

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          load: [
            () => ({
              MASTER_ENCRYPTION_KEY: key,
              NODE_ENV: 'test',
            }),
          ],
        }),
        CryptoModule,
      ],
    }).compile();

    const enc = moduleRef.get(EncryptionService);
    const manager = moduleRef.get<EncryptionKeyManager>(
      ENCRYPTION_KEY_MANAGER_TOKEN,
    );
    const managerByClass = moduleRef.get(EncryptionKeyManager);

    expect(manager).toBeInstanceOf(EncryptionKeyManager);
    expect(manager.getActiveKey().length).toBe(32);
    // `EncryptionKeyManager` (class token) and the symbol token must
    // resolve to the exact same instance — that's the contract the
    // rotation worker (Task 28.2) relies on.
    expect(managerByClass).toBe(manager);

    const envelope = enc.encrypt('hello');
    expect(enc.decrypt(envelope)).toBe('hello');
  });

  it('falls back to the stable dev key in test/dev when the env var is missing', async () => {
    // Make sure we aren't accidentally inheriting a real key from the
    // process env — the factory reads `process.env` as a last resort.
    const previous = process.env.MASTER_ENCRYPTION_KEY;
    delete process.env.MASTER_ENCRYPTION_KEY;
    try {
      const moduleRef = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            ignoreEnvFile: true,
            load: [() => ({ NODE_ENV: 'test' })],
          }),
          CryptoModule,
        ],
      }).compile();

      const enc = moduleRef.get(EncryptionService);
      const manager = moduleRef.get<EncryptionKeyManager>(
        ENCRYPTION_KEY_MANAGER_TOKEN,
      );

      expect(manager.getActiveKey().length).toBe(32);
      expect(enc.decrypt(enc.encrypt('hello'))).toBe('hello');
    } finally {
      if (previous !== undefined) {
        process.env.MASTER_ENCRYPTION_KEY = previous;
      }
    }
  });

  it('refuses to start in production when MASTER_ENCRYPTION_KEY is missing', () => {
    // Drive the factory directly with a minimal `ConfigService`
    // surrogate so we exercise the boot-time `MASTER_KEY_MISSING`
    // guard without depending on Nest to invoke the factory eagerly
    // inside `compile()`.
    const factory = encryptionKeyManagerFactory();
    const previous = process.env.MASTER_ENCRYPTION_KEY;
    delete process.env.MASTER_ENCRYPTION_KEY;
    try {
      const fakeConfig = {
        get: (key: string) =>
          key === 'NODE_ENV' ? 'production' : undefined,
      } as unknown as { get: (key: string) => unknown };

      let caught: unknown;
      try {
        factory(fakeConfig as any);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(EncryptionError);
      expect((caught as EncryptionError).code).toBe('MASTER_KEY_MISSING');
    } finally {
      if (previous !== undefined) {
        process.env.MASTER_ENCRYPTION_KEY = previous;
      }
    }
  });

  it('refuses to start when MASTER_ENCRYPTION_KEY decodes to wrong length', () => {
    const factory = encryptionKeyManagerFactory();
    const tooShort = randomBytes(16).toString('base64');
    const fakeConfig = {
      get: (key: string) =>
        key === 'NODE_ENV'
          ? 'production'
          : key === 'MASTER_ENCRYPTION_KEY'
            ? tooShort
            : undefined,
    } as unknown as { get: (key: string) => unknown };

    let caught: unknown;
    try {
      factory(fakeConfig as any);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(EncryptionError);
    expect((caught as EncryptionError).code).toBe('MASTER_KEY_INVALID');
  });

  it('falls back to the dev key when env is dev and the var is missing', () => {
    const factory = encryptionKeyManagerFactory();
    const previous = process.env.MASTER_ENCRYPTION_KEY;
    delete process.env.MASTER_ENCRYPTION_KEY;
    try {
      const fakeConfig = {
        get: (key: string) =>
          key === 'NODE_ENV' ? 'development' : undefined,
      } as unknown as { get: (key: string) => unknown };

      const manager = factory(fakeConfig as any);
      expect(manager).toBeInstanceOf(EncryptionKeyManager);
      expect(manager.getActiveKey().length).toBe(32);
    } finally {
      if (previous !== undefined) {
        process.env.MASTER_ENCRYPTION_KEY = previous;
      }
    }
  });
});
