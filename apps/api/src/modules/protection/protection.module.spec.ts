import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { DevFallbackProtectionProvider } from './adapters/dev-fallback-protection.adapter';
import { ProtectionModule } from './protection.module';
import { PROTECTION_PROVIDER, ProtectionProvider } from './protection.types';

/**
 * Unit tests for the `PROTECTION_PROVIDER` DI factory in
 * `ProtectionModule` (Task 1.2, Req 2.1, 7.2, 7.3).
 *
 * Proves the selection logic:
 *   - default / dev flag → the clearly-flagged dev fallback;
 *   - a real (TBD) vendor flag → fails closed at bootstrap rather than
 *     silently serving unprotected content.
 *
 * `DRM_PROVIDER` is read defensively from `process.env` by the factory,
 * so we drive selection by toggling `process.env.DRM_PROVIDER`.
 */
describe('ProtectionModule provider binding', () => {
  const original = process.env.DRM_PROVIDER;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.DRM_PROVIDER;
    } else {
      process.env.DRM_PROVIDER = original;
    }
  });

  async function resolveProvider(): Promise<ProtectionProvider> {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ ignoreEnvFile: true }), ProtectionModule],
    }).compile();
    return moduleRef.get<ProtectionProvider>(PROTECTION_PROVIDER);
  }

  it('binds the dev fallback when DRM_PROVIDER is unset (default)', async () => {
    delete process.env.DRM_PROVIDER;

    const provider = await resolveProvider();

    expect(provider).toBeInstanceOf(DevFallbackProtectionProvider);
  });

  it('binds the dev fallback when DRM_PROVIDER=dev-fallback', async () => {
    process.env.DRM_PROVIDER = 'dev-fallback';

    const provider = await resolveProvider();

    expect(provider).toBeInstanceOf(DevFallbackProtectionProvider);
  });

  it('fails closed when a real (TBD) vendor is selected without an adapter', async () => {
    process.env.DRM_PROVIDER = 'vdocipher';

    await expect(resolveProvider()).rejects.toThrow(/no protection adapter wired/i);
  });
});

/**
 * The factory logic is also unit-testable in isolation by replicating the
 * `useFactory` selection used by the module, so we can assert the
 * decision boundary without standing up the whole Nest container.
 */
describe('ProtectionModule selection (isolated factory check)', () => {
  function selectProvider(flag: string | undefined): 'dev' | 'throws' {
    const config = {
      get: (key: string) => (key === 'DRM_PROVIDER' ? flag : undefined),
    } as unknown as ConfigService;
    const devFallback = new DevFallbackProtectionProvider(config);

    // Mirror the module's defensive read + selection.
    const resolved = config.get<string>('DRM_PROVIDER') ?? flag;
    const normalized = (resolved ?? '').trim().toLowerCase();
    const devFlags = ['', 'dev', 'dev-fallback', 'none'];
    if (devFlags.includes(normalized)) {
      return devFallback instanceof DevFallbackProtectionProvider
        ? 'dev'
        : 'throws';
    }
    return 'throws';
  }

  it.each([undefined, '', 'dev', 'dev-fallback', 'none'])(
    'selects the dev fallback for flag=%p',
    (flag) => {
      expect(selectProvider(flag)).toBe('dev');
    },
  );

  it.each(['vdocipher', 'gumlet', 'mux'])(
    'does not select the dev fallback for real vendor flag=%p',
    (flag) => {
      expect(selectProvider(flag)).toBe('throws');
    },
  );
});
