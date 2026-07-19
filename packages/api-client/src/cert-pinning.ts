/**
 * Certificate pinning support (Task 28.4, Req 28.9).
 *
 * The shared `@edubridge/api-client` runs in three different
 * runtimes: a browser (web), React Native (mobile), and Node
 * (server-to-server callers, scheduled jobs, e2e tests). Only the
 * Node runtime exposes the certificate chain to user code — the
 * browser and React Native APIs never expose it.
 *
 * For that reason the SDK supports pinning **only when run on
 * Node**. Browser / React Native callers must rely on the platform
 * pinning surfaces:
 *
 *   - Android: `apps/mobile/security/network-security-config.xml`
 *   - iOS:    `apps/mobile/security/ats-info.plist.snippet`
 *   - Web:    HSTS + HPKP-equivalent at the Cloudflare edge.
 *
 * The `pinnedFingerprints` config option is therefore a best-effort
 * Node-side guard: when the runtime exposes `tls.checkServerIdentity`
 * (i.e. native fetch backed by `https.Agent`), the SDK installs a
 * custom check that compares the server's leaf SPKI SHA-256 against
 * the configured allowlist. On any other runtime the option is
 * silently ignored — `isPinningSupported()` returns the runtime's
 * stance.
 */

/**
 * SHA-256 hash of the server leaf certificate's
 * SubjectPublicKeyInfo (SPKI), encoded as base64. Generate with:
 *
 *   openssl s_client -servername <host> -connect <host>:443 </dev/null \
 *     | openssl x509 -pubkey -noout \
 *     | openssl pkey -pubin -outform DER \
 *     | openssl dgst -sha256 -binary \
 *     | openssl enc -base64
 *
 * Always configure TWO fingerprints — active + backup — so an
 * emergency rotation can ship without rebuilding the SDK callers.
 */
export type Sha256SpkiPin = string;

export interface CertPinningConfig {
  /** Hostname the pin set applies to (e.g. `api.edubridge.uz`). */
  host: string;
  /** Base64 SHA-256 SPKI hashes (active + backup). */
  pinnedFingerprints: Sha256SpkiPin[];
}

/** Discriminator for the runtime support state. */
export type PinningSupport =
  | { supported: true; runtime: 'node' }
  | {
      supported: false;
      runtime: 'browser' | 'react-native' | 'unknown';
      reason: string;
    };

/**
 * Quick runtime-feature check. Returns whether the current
 * environment can verify pins at the TLS layer.
 *
 * The `process.versions.node` and `globalThis.process?.versions?.node`
 * checks are deliberately defensive — bundlers (Webpack, Metro) often
 * shim `process` partially.
 */
export function isPinningSupported(): PinningSupport {
  // React Native's polyfill defines `navigator.product === 'ReactNative'`.
  const nav = (globalThis as { navigator?: { product?: string } }).navigator;
  if (typeof nav?.product === 'string' && nav.product === 'ReactNative') {
    return {
      supported: false,
      runtime: 'react-native',
      reason:
        'React Native does not expose the TLS certificate chain. Use react-native-ssl-pinning or apply the platform configs in apps/mobile/security/.',
    };
  }

  const proc = (globalThis as { process?: { versions?: Record<string, string> } }).process;
  if (proc?.versions?.node) {
    return { supported: true, runtime: 'node' };
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    return {
      supported: false,
      runtime: 'browser',
      reason:
        'Browsers do not expose the TLS certificate chain to JavaScript. Rely on Cloudflare HSTS + zone TLS 1.3 enforcement.',
    };
  }

  return {
    supported: false,
    runtime: 'unknown',
    reason: 'Could not detect runtime; certificate pinning is disabled.',
  };
}

/**
 * Build a Node-only `fetch` wrapper that verifies the leaf
 * certificate's SPKI SHA-256 against the configured pin list. Falls
 * back to the platform `fetch` on non-Node runtimes (with a single
 * console.warn at construction time).
 *
 * The implementation is deliberately lazy: we only resolve the Node
 * `https` / `crypto` / `tls` modules when the runtime check confirms
 * we are on Node. This keeps the package importable from web and
 * React Native without bundler shims, and lets us avoid a hard
 * compile-time dependency on `@types/node` (the api-client package
 * is intentionally pure TypeScript / standard `fetch`).
 */
export function createPinnedFetch(
  config: CertPinningConfig,
  baseFetch: typeof fetch,
): typeof fetch {
  const support = isPinningSupported();
  if (!support.supported) {
    // eslint-disable-next-line no-console
    console.warn(
      `[api-client] Certificate pinning requested but not supported in ${support.runtime} runtime: ${support.reason}`,
    );
    return baseFetch;
  }
  if (config.pinnedFingerprints.length === 0) {
    return baseFetch;
  }

  const allow = new Set(config.pinnedFingerprints.map((s) => s.trim()));

  // Lazy resolve so non-Node bundlers never try to bundle these,
  // and so this file compiles without `@types/node` on the api-client
  // package boundary. The `nodeRequire` cast is the documented escape
  // hatch when calling into a Node built-in from a runtime-agnostic
  // package.
  const nodeRequire = (
    globalThis as unknown as { require?: (id: string) => unknown }
  ).require as ((id: string) => unknown) | undefined;
  if (typeof nodeRequire !== 'function') {
    // eslint-disable-next-line no-console
    console.warn(
      '[api-client] Certificate pinning requested on Node but require() is unavailable; pinning will be a no-op.',
    );
    return baseFetch;
  }

  const tls = nodeRequire('node:tls') as {
    checkServerIdentity: (
      host: string,
      cert: { pubkey?: unknown; raw?: unknown },
    ) => Error | undefined;
  };
  const crypto = nodeRequire('node:crypto') as {
    createHash: (algo: string) => {
      update: (data: unknown) => { digest: (enc: string) => string };
    };
  };
  const https = nodeRequire('node:https') as {
    Agent: new (opts: unknown) => unknown;
    globalAgent?: unknown;
  };
  const http = nodeRequire('node:http') as {
    Agent: new (opts: unknown) => unknown;
    globalAgent?: unknown;
  };
  const undici = (() => {
    try {
      return nodeRequire('undici') as
        | {
            Agent?: new (opts: unknown) => unknown;
          }
        | null;
    } catch {
      return null;
    }
  })();

  // Custom checkServerIdentity: invoke the default check (hostname,
  // SAN, expiry) and on success additionally verify the SPKI pin.
  const checkServerIdentity = (
    host: string,
    cert: { pubkey?: unknown; raw?: unknown; subject?: { CN?: string } },
  ): Error | undefined => {
    const stockResult = tls.checkServerIdentity(host, cert);
    if (stockResult) return stockResult;

    if (host !== config.host) {
      // Only enforce pinning for the configured host; other hosts
      // pass through (e.g. health-check pings to a status page).
      return undefined;
    }

    const pubkey = cert.pubkey;
    if (!pubkey) {
      return new Error(
        'Certificate pinning failed: leaf cert public key unavailable.',
      );
    }
    const fingerprint = crypto
      .createHash('sha256')
      .update(pubkey)
      .digest('base64');
    if (!allow.has(fingerprint)) {
      return new Error(
        `Certificate pinning failed for ${host}: SPKI SHA-256 ${fingerprint} not in allowlist.`,
      );
    }
    return undefined;
  };

  const httpsAgent = new https.Agent({
    keepAlive: true,
    checkServerIdentity,
  });
  const httpAgent = new http.Agent({ keepAlive: true });

  // Most Node runtimes use undici under the hood for `globalThis.fetch`.
  // We construct an explicit `Agent` (or `Dispatcher`) when undici is
  // available so the pinning check is honoured; otherwise we fall back
  // to a manual shim for callers on Node older than 18.
  if (undici && typeof undici.Agent === 'function') {
    const dispatcher = new undici.Agent({
      connect: {
        checkServerIdentity,
      },
    });
    return ((input: RequestInfo | URL, init?: RequestInit) => {
      const merged = { ...(init ?? {}) } as RequestInit & {
        dispatcher?: unknown;
      };
      if (!merged.dispatcher) merged.dispatcher = dispatcher;
      return baseFetch(input as RequestInfo, merged as RequestInit);
    }) as typeof fetch;
  }

  // Last resort: install the global agents so any caller using
  // `https.request` directly picks up the pin.
  https.globalAgent = httpsAgent;
  http.globalAgent = httpAgent;
  // eslint-disable-next-line no-console
  console.warn(
    '[api-client] undici is not available; certificate pinning will NOT cover globalThis.fetch on this Node runtime. Upgrade to Node 18+ or supply a pinned fetch implementation explicitly.',
  );
  return baseFetch;
}
