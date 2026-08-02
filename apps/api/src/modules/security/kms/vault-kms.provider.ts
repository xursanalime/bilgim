import { Injectable, Logger } from '@nestjs/common';

import type { KmsKey, KmsKeyStatus, KmsProvider } from './kms.port';

/**
 * Optional fetch seam — keeps the service unit-testable without
 * pulling a real `fetch` mock library. The default uses the global
 * `fetch` provided by Node 18+.
 */
export type VaultHttpFetcher = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

export interface VaultKmsConfig {
  /** Vault address, e.g. `https://vault.internal:8200`. */
  addr: string;
  /** Vault token (cluster-issued) used for the Authorization header. */
  token: string;
  /**
   * Transit secrets-engine key name. Vault auto-rotates versions
   * under a single name; we map each version to a `KmsKey` id of
   * `<keyName>:<version>`.
   */
  keyName: string;
  /** Mount path of the Transit engine. Defaults to `transit`. */
  mountPath?: string;
}

interface VaultTransitKey {
  type: string;
  keys: Record<string, number>; // version → unix seconds
  latest_version: number;
  min_decryption_version: number;
  min_encryption_version: number;
}

interface VaultExportResponse {
  data: {
    keys: Record<string, string>; // version → base64 key bytes
    name: string;
  };
}

/**
 * `VaultKmsProvider` — Task 28.2.
 *
 * Talks to HashiCorp Vault's Transit secrets engine over HTTP. Each
 * Vault Transit key version maps onto one `KmsKey`:
 *
 *   - `getActiveKey()` → `vault read transit/keys/<keyName>` and
 *     export the `latest_version`.
 *   - `listKeys()`     → enumerate every version.
 *   - `createKey()`    → `vault write transit/keys/<keyName>/rotate`
 *     and return the freshly-minted version.
 *   - `markRotated()`  → no-op (Vault tracks the version order
 *     itself; we keep the API surface stable for ops scripting).
 *
 * Vault is the primary production target. Operators that haven't yet
 * rolled it out keep the local provider via `KMS_PROVIDER=local`. We
 * deliberately don't fall back to local *inside* this class — that
 * decision lives in `SecurityModule` so misconfiguration surfaces at
 * boot rather than silently degrading at runtime.
 *
 * **Security caveats**:
 *   - The Transit key MUST be created with `exportable=true` and
 *     `allow_plaintext_backup=false`. Without `exportable` the
 *     re-encrypt path can't fetch the raw bytes; `plaintext_backup`
 *     would let any operator dump the master key store. The provider
 *     calls the export endpoint lazily and Vault's audit log
 *     captures every fetch.
 *   - The Vault token should be short-lived and bound to a policy
 *     that allows only `read`, `update` (rotate), and `read` on
 *     `transit/export/encryption-key/<keyName>`. Production
 *     deployments should use response wrapping.
 */
@Injectable()
export class VaultKmsProvider implements KmsProvider {
  private readonly logger = new Logger(VaultKmsProvider.name);
  private fetcher: VaultHttpFetcher;
  private readonly config: VaultKmsConfig;

  constructor(config: VaultKmsConfig, fetcher?: VaultHttpFetcher) {
    if (!config.addr || !config.token || !config.keyName) {
      throw new Error(
        'VaultKmsProvider: addr, token, and keyName are all required.',
      );
    }
    this.config = {
      ...config,
      mountPath: config.mountPath ?? 'transit',
    };
    this.fetcher = fetcher ?? this.defaultFetcher();
  }

  /** Test seam — never use in production. */
  setFetcherForTesting(fetcher: VaultHttpFetcher): void {
    this.fetcher = fetcher;
  }

  // -------------------------------------------------------------------------
  // KmsProvider implementation
  // -------------------------------------------------------------------------

  async getActiveKey(): Promise<KmsKey> {
    const meta = await this.readKeyMetadata();
    const latest = meta.latest_version;
    if (!latest) {
      throw new Error(
        `VaultKmsProvider: Vault returned no versions for key "${this.config.keyName}".`,
      );
    }
    const keys = await this.exportKeys();
    const material = keys.get(latest);
    if (!material) {
      throw new Error(
        `VaultKmsProvider: latest version ${latest} not present in Vault export response.`,
      );
    }
    return this.toKmsKey(latest, material, meta, 'ACTIVE');
  }

  async listKeys(): Promise<KmsKey[]> {
    const meta = await this.readKeyMetadata();
    const exports = await this.exportKeys();
    const out: KmsKey[] = [];
    const versions = Object.keys(meta.keys)
      .map((v) => Number.parseInt(v, 10))
      .filter((v) => Number.isFinite(v))
      .sort((a, b) => a - b);
    for (const version of versions) {
      const material = exports.get(version);
      if (!material) continue;
      const status: KmsKeyStatus =
        version === meta.latest_version ? 'ACTIVE' : 'RETIRED';
      out.push(this.toKmsKey(version, material, meta, status));
    }
    return out;
  }

  async getKeyById(id: string): Promise<KmsKey | null> {
    const version = this.parseVersion(id);
    if (version === null) return null;
    const meta = await this.readKeyMetadata();
    if (!(version in meta.keys)) return null;
    const exports = await this.exportKeys();
    const material = exports.get(version);
    if (!material) return null;
    const status: KmsKeyStatus =
      version === meta.latest_version ? 'ACTIVE' : 'RETIRED';
    return this.toKmsKey(version, material, meta, status);
  }

  async createKey(): Promise<KmsKey> {
    const url = `${this.config.addr}/v1/${this.config.mountPath}/keys/${this.config.keyName}/rotate`;
    const res = await this.fetcher(url, {
      method: 'POST',
      headers: this.headers(),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `VaultKmsProvider: rotate failed (${res.status}): ${body.slice(0, 200)}`,
      );
    }
    this.logger.log(
      `Rotated Vault Transit key "${this.config.keyName}" via /rotate.`,
    );
    return this.getActiveKey();
  }

  async markRotated(_oldId: string, _newId: string): Promise<void> {
    // Vault tracks version order itself — keeping the call surface
    // stable so the policy layer doesn't need to know which
    // provider is bound. Idempotent no-op.
    return;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async readKeyMetadata(): Promise<VaultTransitKey> {
    const url = `${this.config.addr}/v1/${this.config.mountPath}/keys/${this.config.keyName}`;
    const res = await this.fetcher(url, {
      method: 'GET',
      headers: this.headers(),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `VaultKmsProvider: read failed (${res.status}): ${body.slice(0, 200)}`,
      );
    }
    const json = (await res.json()) as { data?: VaultTransitKey };
    if (!json.data) {
      throw new Error('VaultKmsProvider: read response missing `data` field.');
    }
    return json.data;
  }

  /**
   * Pull every exportable version of the encryption key. Vault
   * returns base64-encoded raw key bytes (32 bytes for AES-256).
   */
  private async exportKeys(): Promise<Map<number, Buffer>> {
    const url = `${this.config.addr}/v1/${this.config.mountPath}/export/encryption-key/${this.config.keyName}`;
    const res = await this.fetcher(url, {
      method: 'GET',
      headers: this.headers(),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `VaultKmsProvider: export failed (${res.status}): ${body.slice(0, 200)}`,
      );
    }
    const parsed = (await res.json()) as VaultExportResponse;
    if (!parsed.data?.keys) {
      throw new Error(
        'VaultKmsProvider: export response missing `data.keys` field.',
      );
    }
    const out = new Map<number, Buffer>();
    for (const [k, v] of Object.entries(parsed.data.keys)) {
      const version = Number.parseInt(k, 10);
      if (!Number.isFinite(version)) continue;
      out.set(version, Buffer.from(v, 'base64'));
    }
    return out;
  }

  private toKmsKey(
    version: number,
    material: Buffer,
    meta: VaultTransitKey,
    status: KmsKeyStatus,
  ): KmsKey {
    const createdAt = new Date((meta.keys[String(version)] ?? 0) * 1000);
    const id = this.formatId(version);
    return {
      id,
      // Defensive copy — buffers handed out are caller-mutable.
      material: Buffer.from(material),
      status,
      createdAt: Number.isFinite(createdAt.getTime()) ? createdAt : new Date(),
      retiredAt: status === 'RETIRED' ? createdAt : null,
      rotatedToId:
        status === 'RETIRED'
          ? this.formatId(meta.latest_version)
          : null,
    };
  }

  private formatId(version: number): string {
    return `${this.config.keyName}:${version}`;
  }

  private parseVersion(id: string): number | null {
    const idx = id.lastIndexOf(':');
    if (idx < 0) return null;
    const prefix = id.slice(0, idx);
    if (prefix !== this.config.keyName) return null;
    const version = Number.parseInt(id.slice(idx + 1), 10);
    return Number.isFinite(version) ? version : null;
  }

  private headers(): Record<string, string> {
    return {
      'X-Vault-Token': this.config.token,
      'Content-Type': 'application/json',
    };
  }

  private defaultFetcher(): VaultHttpFetcher {
    if (typeof globalThis.fetch !== 'function') {
      return async () => {
        throw new Error(
          'VaultKmsProvider: global fetch is not available in this runtime.',
        );
      };
    }
    return globalThis.fetch.bind(globalThis) as VaultHttpFetcher;
  }
}
