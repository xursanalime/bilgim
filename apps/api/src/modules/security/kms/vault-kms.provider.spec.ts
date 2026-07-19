import {
  VaultKmsProvider,
  type VaultHttpFetcher,
} from './vault-kms.provider';

/**
 * Unit tests for `VaultKmsProvider` (Task 28.2).
 *
 * The provider talks to HashiCorp Vault's Transit secrets engine
 * over HTTP. Tests substitute a deterministic `fetcher` so we can
 * assert the request shape without standing up a Vault container.
 */

function buildFetcher(
  responses: Record<
    string,
    { ok: boolean; status?: number; body: unknown } | ((init?: unknown) => {
      ok: boolean;
      status?: number;
      body: unknown;
    })
  >,
): VaultHttpFetcher {
  return jest.fn(async (url: string, init?: unknown) => {
    const route = Object.keys(responses).find((p) => url.includes(p));
    if (!route) throw new Error(`unexpected url: ${url}`);
    const value = responses[route];
    const resolved = typeof value === 'function' ? value(init) : value;
    return {
      ok: resolved!.ok,
      status: resolved!.status ?? (resolved!.ok ? 200 : 500),
      json: async () => resolved!.body,
      text: async () => JSON.stringify(resolved!.body ?? ''),
    };
  }) as unknown as VaultHttpFetcher;
}

const TRANSIT_KEY_BASE64 = Buffer.alloc(32, 7).toString('base64');

describe('VaultKmsProvider — getActiveKey', () => {
  it('reads the latest version and exports its bytes', async () => {
    const fetcher = buildFetcher({
      '/v1/transit/keys/edubridge': {
        ok: true,
        body: {
          data: {
            type: 'aes256-gcm96',
            keys: { '1': 1700000000, '2': 1700200000 },
            latest_version: 2,
            min_decryption_version: 1,
            min_encryption_version: 1,
          },
        },
      },
      '/v1/transit/export/encryption-key/edubridge': {
        ok: true,
        body: {
          data: {
            keys: { '1': TRANSIT_KEY_BASE64, '2': TRANSIT_KEY_BASE64 },
            name: 'edubridge',
          },
        },
      },
    });
    const provider = new VaultKmsProvider(
      {
        addr: 'https://vault.example',
        token: 'TOKEN',
        keyName: 'edubridge',
      },
      fetcher,
    );

    const active = await provider.getActiveKey();
    expect(active.id).toBe('edubridge:2');
    expect(active.status).toBe('ACTIVE');
    expect(active.material.length).toBe(32);
  });

  it('issues a POST to /rotate when createKey is called', async () => {
    const calls: Array<{ url: string; method?: string | undefined }> = [];
    const fetcher: VaultHttpFetcher = jest.fn(async (url, init) => {
      const method = (init as { method?: string } | undefined)?.method;
      calls.push({ url, method });
      if (url.includes('/rotate')) {
        return {
          ok: true,
          status: 204,
          json: async () => ({}),
          text: async () => '',
        };
      }
      if (url.includes('/keys/edubridge') && !url.includes('rotate')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              type: 'aes256-gcm96',
              keys: { '1': 1700000000, '2': 1700200000 },
              latest_version: 2,
              min_decryption_version: 1,
              min_encryption_version: 1,
            },
          }),
          text: async () => '',
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            keys: { '1': TRANSIT_KEY_BASE64, '2': TRANSIT_KEY_BASE64 },
            name: 'edubridge',
          },
        }),
        text: async () => '',
      };
    }) as unknown as VaultHttpFetcher;

    const provider = new VaultKmsProvider(
      { addr: 'https://vault.example', token: 'TOKEN', keyName: 'edubridge' },
      fetcher,
    );
    const created = await provider.createKey();

    const rotateCall = calls.find((c) => c.url.includes('/rotate'));
    expect(rotateCall).toBeDefined();
    expect(rotateCall?.method).toBe('POST');
    expect(created.status).toBe('ACTIVE');
  });

  it('returns null for an id that does not match the configured keyName', async () => {
    const fetcher = buildFetcher({
      '/v1/transit/keys/edubridge': {
        ok: true,
        body: {
          data: {
            type: 'aes256-gcm96',
            keys: { '1': 1700000000 },
            latest_version: 1,
            min_decryption_version: 1,
            min_encryption_version: 1,
          },
        },
      },
      '/v1/transit/export/encryption-key/edubridge': {
        ok: true,
        body: {
          data: { keys: { '1': TRANSIT_KEY_BASE64 }, name: 'edubridge' },
        },
      },
    });
    const provider = new VaultKmsProvider(
      { addr: 'https://vault.example', token: 'TOKEN', keyName: 'edubridge' },
      fetcher,
    );

    expect(await provider.getKeyById('other-key:1')).toBeNull();
    expect(await provider.getKeyById('edubridge:99')).toBeNull();
    const found = await provider.getKeyById('edubridge:1');
    expect(found?.material.length).toBe(32);
  });

  it('rejects construction without addr/token/keyName', () => {
    expect(
      () =>
        new VaultKmsProvider({
          addr: '',
          token: '',
          keyName: '',
        }),
    ).toThrow();
  });

  it('surfaces a useful error when Vault returns non-2xx', async () => {
    const fetcher = buildFetcher({
      '/v1/transit/keys/edubridge': {
        ok: false,
        status: 403,
        body: { errors: ['permission denied'] },
      },
    });
    const provider = new VaultKmsProvider(
      { addr: 'https://vault.example', token: 'TOKEN', keyName: 'edubridge' },
      fetcher,
    );
    await expect(provider.getActiveKey()).rejects.toThrow(/403/);
  });
});
