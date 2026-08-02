import { z } from 'zod';

export const envSchema = z.object({
  // App
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  API_PORT: z.coerce.number().default(4000),
  APP_URL: z.string().url().default('http://localhost:3000'),
  API_URL: z.string().url().default('http://localhost:4000'),

  // Security / hardening (Task 24.1, Req 17.x, 21.x)
  /**
   * Express `trust proxy` setting — decides which `X-Forwarded-For` hops
   * are believed when resolving `req.ip`.
   *
   * `req.ip` is the input to every IP-scoped control in the app (rate
   * limits, brute-force lockout, WAF blocklist, geo-blocking), so this
   * value has to match the real deployment topology:
   *
   *   - `loopback` (default) — the Next.js BFF runs on the same host and
   *     is the only thing talking to the API. Correct for docker-compose
   *     and the local `bilgim` stack.
   *   - a CIDR / comma-separated list — the BFF or ingress runs on a
   *     known private range, e.g. `10.0.0.0/8`.
   *   - a small integer — number of trusted proxy hops in front of the
   *     API, e.g. `2` behind Cloudflare + an ingress controller.
   *
   * Do NOT set this to `true`: that trusts the leftmost XFF entry from
   * anyone, which lets a caller pick its own rate-limit bucket and
   * escape an IP block.
   */
  TRUST_PROXY: z.string().default('loopback'),
  /**
   * Shared secret between the Next.js BFF and this API.
   *
   * When set, the API honours the `x-bilgim-client-ip` header on requests
   * that also present a matching `x-bilgim-proxy-token`, and uses it as
   * `req.ip`. Without it every request proxied by the BFF looks like it
   * came from the BFF's own address, so all per-IP rate limiting,
   * brute-force lockout and IP blocking collapse into a single shared
   * bucket — one user's failures then punish everybody, and a burst of
   * errors can blocklist the whole platform.
   *
   * Must match `BFF_PROXY_SECRET` in the web app. Leave unset to fall
   * back to plain `TRUST_PROXY` behaviour.
   */
  BFF_PROXY_SECRET: z.string().optional(),
  /**
   * Comma-separated list of origins permitted by the CORS layer.
   * Defaults to APP_URL + the local Next dev server. Values like
   * `https://bilgim.uz,https://www.bilgim.uz` lock down the
   * production allowlist.
   */
  WEB_ORIGIN: z
    .string()
    .default('http://localhost:3000,http://127.0.0.1:3000'),
  /**
   * When `true`, CORS responds with `Access-Control-Allow-Credentials: true`.
   * Defaults to `true` since the web app uses HttpOnly auth cookies, but
   * any deployment serving cross-origin public clients (mobile, embeds)
   * should disable this explicitly.
   */
  CORS_CREDENTIALS: z
    .union([z.boolean(), z.string()])
    .default('true')
    .transform((v) =>
      typeof v === 'boolean' ? v : v.toLowerCase() === 'true',
    ),
  /**
   * Maximum request body size (bytes) — applied to JSON and urlencoded
   * parsers. Defaults to 1 MB to limit slow-loris / payload-flood vectors;
   * media uploads use multipart presigned URLs and never traverse this
   * parser.
   */
  BODY_LIMIT_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(1024 * 1024),
  /**
   * Hard timeout (milliseconds) for inbound HTTP requests. Requests that
   * exceed this duration are forcibly closed to defend against
   * slow-loris-style attacks. Defaults to 30s.
   */
  REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(30_000),
  /**
   * When `true`, helmet's CSP middleware is enabled. Default is `true`
   * for production and `false` everywhere else, because the dev tooling
   * (Next.js Fast Refresh, Swagger UI, source maps) needs inline scripts.
   */
  HELMET_CSP: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => {
      if (typeof v === 'boolean') return v;
      if (typeof v === 'string') return v.toLowerCase() === 'true';
      return undefined;
    }),
  /**
   * Comma-separated list of CIDR ranges or single IPs that bypass every
   * application-side WAF check (Task 27.1). Use this for trusted
   * internal CIDRs (Kubernetes pod range, monitoring agents, office
   * NAT). Loopback (`127.0.0.1`, `::1`) is always allow-listed.
   *
   * Examples:
   *   WAF_ALLOWLIST=10.0.0.0/8,172.16.0.0/12,203.0.113.5
   *
   * Invalid entries are dropped at startup with a warning so a typo
   * never widens the allow-list.
   */
  WAF_ALLOWLIST: z.string().default(''),

  /**
   * Comma-separated IPs that `IpBlocklistGuard` must never reject,
   * whatever is sitting in the blocklist.
   *
   * This is the break-glass control for the failure mode that took the
   * platform down on 2026-07-25: the guard runs ahead of authentication
   * and therefore gates `/auth/login` too, so once an address is blocked
   * nobody using it can sign in — including the admin who would clear
   * the block from the admin panel. Private / CGNAT addresses are now
   * structurally unblockable (see `common/security/ip-classification`),
   * but a *public* address can still be blocked legitimately and then
   * turn out to be, say, the whole office behind one NAT.
   *
   * Setting this needs only an env var and a redeploy — no Redis shell —
   * which is the point: recovery must not depend on access the operator
   * may not have. Exact matches only (no CIDR): an over-broad break-glass
   * entry is worse than a second redeploy.
   *
   * Example:
   *   IP_BLOCKLIST_ALLOWLIST=203.0.113.5,198.51.100.9
   */
  IP_BLOCKLIST_ALLOWLIST: z.string().default(''),

  // HMAC request signing (Task 29.4, Req 30.1)
  /**
   * Shared secret used to verify `X-Signature` headers on routes
   * decorated with `@RequireHmac()`. Must be a high-entropy string
   * (≥32 bytes recommended). Optional in dev / test so the local
   * stack works without ceremony; production deployments MUST set
   * a real key, otherwise any signed admin endpoint returns
   * `401 SIGNATURE_MISCONFIGURED`.
   *
   * Rotation pattern: configure two keys (active + previous) for a
   * brief overlap window when rotating, then drop the old one once
   * all signed clients have moved over.
   */
  HMAC_ADMIN_SECRET: z.string().optional(),
  /**
   * Per-surface secret for the Payme webhook signing path. Distinct
   * from `HMAC_ADMIN_SECRET` so the impact of a leaked key is bounded
   * to one surface and rotation is independent.
   */
  PAYME_HMAC_SECRET: z.string().optional(),
  /**
   * Shared secret used by the {@link HmacVerifyMiddleware} on
   * `/api/v1/internal/*` (server-to-server) routes (Task 29.4, Req 30.1).
   *
   * Format: any high-entropy ≥32-byte string. The middleware refuses
   * to start when the value is set but shorter than 32 chars so a
   * typo can never silently weaken the surface; leaving it unset in
   * production hard-disables every `/internal/*` route (the middleware
   * fails closed with `SIGNATURE_MISCONFIGURED`).
   *
   * Generate with: `openssl rand -hex 32`
   */
  INTERNAL_API_SECRET: z
    .string()
    .min(
      32,
      'INTERNAL_API_SECRET must be at least 32 characters (≥256 bits)',
    )
    .optional(),
  /**
   * Master switch for the application-layer WAF middleware
   * (`apps/api/src/common/security/waf/waf.middleware.ts`).
   *
   * Defaults are environment-aware — on in production, off everywhere
   * else — so local dev can craft test payloads without tripping the
   * rule table. Operators can flip the toggle explicitly to either
   * value at any time.
   */
  WAF_ENABLED: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => {
      if (typeof v === 'boolean') return v;
      if (typeof v === 'string') return v.toLowerCase() === 'true';
      return undefined;
    }),
  /**
   * Per-IP request budget for **anonymous** callers, applied by the
   * DDoS guard's sliding-window counter
   * (`apps/api/src/common/security/waf/ddos-protection.service.ts`).
   * Defaults to 100 req / `DDOS_WINDOW_SECONDS`.
   */
  DDOS_RATE_LIMIT_UNAUTH: z.coerce
    .number()
    .int()
    .positive()
    .default(100),
  /**
   * Per-IP request budget for **authenticated** callers. Defaults to
   * 1000 req / `DDOS_WINDOW_SECONDS` — an order of magnitude higher
   * than anon so legitimate users are not throttled by the same NAT
   * that an abusive anonymous flooder is sharing.
   */
  DDOS_RATE_LIMIT_AUTH: z.coerce
    .number()
    .int()
    .positive()
    .default(1000),
  /**
   * Sliding-window length applied to both DDoS counters, in seconds.
   */
  DDOS_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60),
  /**
   * Comma-separated list of CIDR ranges or single IPs that the DDoS
   * guard skips entirely. Same parsing rules as `WAF_ALLOWLIST`.
   * Loopback (`127.0.0.1`, `::1`) is always implicitly skipped so the
   * kubelet's health probes never get throttled.
   */
  DDOS_IP_WHITELIST: z.string().default(''),
  /**
   * Per-IP token-bucket cap applied by `DdosProtectionService` to
   * every anonymous caller (Task 27.1, requirement 2). The bucket
   * holds `DDOS_IP_RATE_LIMIT` tokens and refills `1/window` tokens
   * per second, so a spike up to the full bucket size is allowed
   * before the limit kicks in.
   *
   * Defaults to 200 req/min — the conservative value documented in
   * the task spec. Operators wanting the higher per-IP cap from the
   * design doc (1000 req/min) can set this explicitly.
   */
  DDOS_IP_RATE_LIMIT: z.coerce
    .number()
    .int()
    .positive()
    .default(200),
  /**
   * Comma-separated list of CIDR ranges or single IPs allowed to hit
   * the `/admin/*` routes (Task 27.1, requirement 3). Empty / unset
   * disables the check entirely — useful for local dev and for
   * environments where admin access is gated at the network layer
   * (VPN, bastion host, ingress ACL).
   *
   * Loopback (`127.0.0.1`, `::1`) is always implicitly allowed so
   * local debugging and kubelet probes stay open.
   *
   * Examples:
   *   ADMIN_IP_ALLOWLIST=10.0.0.0/8,203.0.113.5
   */
  ADMIN_IP_ALLOWLIST: z.string().default(''),

  // ---- Threat protection (Task 27.1) ----
  /**
   * Master switch for the application-layer threat-protection
   * middleware (`apps/api/src/common/security/threat-protection`).
   *
   * The middleware composes:
   *   - the suspicious-request detector (SQLi / XSS / path traversal
   *     / oversized headers → 400 `WAF_BLOCKED`)
   *   - the tiered rate limiter (per-IP burst, per-IP global,
   *     per-user → 429 `RATE_LIMITED`)
   *   - the geo-blocker (`BLOCKED_COUNTRIES` → 403 `GEO_BLOCKED`)
   *
   * Defaults are environment-aware — on in production, off everywhere
   * else — so local dev can craft test payloads without tripping the
   * rule table. Operators can flip the toggle explicitly to either
   * value at any time.
   */
  THREAT_PROTECTION_ENABLED: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => {
      if (typeof v === 'boolean') return v;
      if (typeof v === 'string') return v.toLowerCase() === 'true';
      return undefined;
    }),
  /** Per-IP burst cap for the tiered rate limiter (req / 1s). */
  THREAT_RATE_LIMIT_IP_BURST: z.coerce
    .number()
    .int()
    .positive()
    .default(50),
  /** Burst-ban duration applied when the burst cap is exceeded (s). */
  THREAT_RATE_LIMIT_IP_BURST_BAN_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(5),
  /** Per-IP global cap for the tiered rate limiter (req / 60s). */
  THREAT_RATE_LIMIT_IP_GLOBAL: z.coerce
    .number()
    .int()
    .positive()
    .default(600),
  /** Global-ban duration applied when the global cap is exceeded (s). */
  THREAT_RATE_LIMIT_IP_GLOBAL_BAN_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60),
  /** Per-user cap for the tiered rate limiter (req / 60s). */
  THREAT_RATE_LIMIT_USER: z.coerce
    .number()
    .int()
    .positive()
    .default(1200),
  /** User-ban duration applied when the user cap is exceeded (s). */
  THREAT_RATE_LIMIT_USER_BAN_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60),

  // ---- Application-level rate limiting (Task 27.1, Req 27.2) ----
  /**
   * Per-IP token-bucket capacity for the SecurityModule rate-limit
   * guard (`apps/api/src/modules/security/waf/rate-limit.guard.ts`).
   * The bucket holds this many tokens and refills `capacity / window`
   * tokens per second, so a spike up to the full bucket size is
   * allowed before the limit kicks in.
   *
   * Defaults to 1000 req/min — the value documented in Task 27.1.
   * Sits ABOVE `DDOS_IP_RATE_LIMIT` (200 req/min) so the DDoS guard
   * catches the obvious flood first, while this guard catches the
   * stealthier "fan out across many endpoints" pattern.
   */
  SECURITY_RATE_LIMIT_IP: z.coerce
    .number()
    .int()
    .positive()
    .default(1000),
  /** Refill window for the per-IP bucket, in seconds. */
  SECURITY_RATE_LIMIT_IP_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60),
  /**
   * Per-user token-bucket capacity. Only evaluated when
   * `request.user` carries a `sub` / `id`. Defaults to 300 req/min
   * matching Task 27.1.
   */
  SECURITY_RATE_LIMIT_USER: z.coerce
    .number()
    .int()
    .positive()
    .default(300),
  /** Refill window for the per-user bucket, in seconds. */
  SECURITY_RATE_LIMIT_USER_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60),
  /**
   * Comma-separated list of ISO-3166-1 alpha-2 country codes that the
   * geo-blocker rejects (placeholder for full MaxMind integration).
   * Defaults to empty — no country is blocked. Codes are
   * case-insensitive and invalid entries are dropped at startup.
   *
   * Example: `BLOCKED_COUNTRIES=KP,IR,SY`
   */
  BLOCKED_COUNTRIES: z.string().default(''),
  /**
   * Static `ip-or-cidr=ISO_CODE` overrides used by the geo-blocker
   * when the upstream `cf-ipcountry` header is missing. Useful for
   * tests and on-prem deployments without Cloudflare in front.
   *
   * Format: comma-separated `ip|cidr=CC` pairs.
   * Example: `GEO_OVERRIDES=203.0.113.0/24=KP,198.51.100.5=IR`
   */
  GEO_OVERRIDES: z.string().default(''),

  /**
   * Optional path to a MaxMind GeoLite2 City `.mmdb` file consumed by
   * `GeoIpService` (Task 27.3, Req 27.3). When unset, IP →
   * (latitude, longitude) resolution falls back to the
   * `cf-ipcountry` header → country-centroid table baked into the
   * service. Production deployments should drop in the free GeoLite2
   * download and point this at the file path so impossible-travel
   * detection has city-level precision.
   *
   * The `@maxmind/geoip2-node` package is intentionally an optional
   * dependency — it is loaded lazily at first lookup. If the package
   * is missing or the file cannot be read, the service logs once and
   * keeps running on the header path.
   */
  MAXMIND_GEOIP_DB_PATH: z.string().default(''),

  // ---- Threat intelligence feeds (Task 27.5, Req 27.10) ----
  /**
   * Master switch for `ThreatIntelService` periodic feed sync. When
   * `false` (the default) the cron is a no-op even if API keys are
   * configured — useful in CI / local dev so test runs never hit a
   * real upstream feed.
   *
   * In production set this to `true` AND provide at least one of
   * `ABUSEIPDB_API_KEY` or `SPAMHAUS_FEED_URL`.
   */
  THREAT_INTEL_SYNC_ENABLED: z
    .union([z.boolean(), z.string()])
    .default('false')
    .transform((v) =>
      typeof v === 'boolean' ? v : v.toLowerCase() === 'true',
    ),
  /**
   * AbuseIPDB v2 API key. When set, the threat-intel cron pulls the
   * `/api/v2/blacklist?confidenceMinimum=90` endpoint every 6 hours
   * and bulk-imports the returned IPs into `IpBlocklistService` with
   * a 7-day TTL. Free-tier keys are rate-limited to ~5,000 entries
   * per day; the 90% confidence floor keeps the pull well under that
   * budget while preserving recall on actively scanning hosts.
   *
   * Generate / rotate via the AbuseIPDB dashboard:
   *   https://www.abuseipdb.com/account/api
   */
  ABUSEIPDB_API_KEY: z.string().optional(),
  /**
   * Spamhaus feed URL. The public DROP / EDROP lists (text format)
   * live at:
   *   https://www.spamhaus.org/drop/drop.txt
   *   https://www.spamhaus.org/drop/edrop.txt
   * Operators should mirror these into their own bucket / proxy and
   * point this at the mirror; pulling directly from spamhaus.org from
   * a high-traffic origin runs into their fair-use throttle. When
   * unset the Spamhaus parser is a no-op.
   */
  SPAMHAUS_FEED_URL: z.string().optional(),
  /**
   * Backwards-compat alias accepted for deployments that already set
   * `SPAMHAUS_API_KEY`. The Spamhaus DROP feed itself doesn't need an
   * API key, so this is treated as a feature flag — when present and
   * `SPAMHAUS_FEED_URL` is unset, the parser falls back to the
   * public DROP URL. Empty string means "no Spamhaus feed".
   */
  SPAMHAUS_API_KEY: z.string().optional(),
  /**
   * Canonical path to the MaxMind GeoLite2 City `.mmdb` file used by
   * `GeoIpService` (Task 27.3, Req 27.3). Same semantics as
   * `MAXMIND_GEOIP_DB_PATH` — kept as a separate variable because
   * the task spec wording standardised the name on `GEOIP_MMDB_PATH`
   * and external operators / Helm charts already reference both.
   * The service reads `GEOIP_MMDB_PATH` first and falls back to
   * `MAXMIND_GEOIP_DB_PATH`, so either may be set.
   *
   * Optional — when unset, MaxMind resolution is skipped and the
   * service falls back to the `cf-ipcountry` header.
   */
  GEOIP_MMDB_PATH: z.string().optional(),
  /**
   * Great-circle distance threshold (km) above which two consecutive
   * logins inside `IMPOSSIBLE_TRAVEL_WINDOW_SECONDS` are flagged as
   * impossible travel and the session is blocked + MFA re-verification
   * is forced (Task 27.3, Req 27.3). Defaults to 500 km — a value
   * comfortably above the radius reachable by ground transport in an
   * hour and well below the haversine-vs-vincenty error band.
   */
  IMPOSSIBLE_TRAVEL_DISTANCE_KM: z.coerce
    .number()
    .positive()
    .default(500),
  /**
   * Time window (seconds) over which the impossible-travel distance
   * threshold is evaluated. Defaults to 3600 (1 hour) per Req 27.3.
   */
  IMPOSSIBLE_TRAVEL_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(3600),
  /**
   * Alias accepted for deployments that prefer the millisecond-form
   * env name from the task spec. When both `_WINDOW_MS` and
   * `_WINDOW_SECONDS` are set, the millisecond value wins so an
   * operator can override the time window without flipping units.
   * Defaults to 3_600_000 ms (1 h).
   */
  IMPOSSIBLE_TRAVEL_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .optional(),
  /**
   * Alias for `MAXMIND_GEOIP_DB_PATH` / `GEOIP_MMDB_PATH` accepted in
   * the Task 27.3 spec wording. The `GeoIpService` reads the canonical
   * `GEOIP_MMDB_PATH` first, falls back to `MAXMIND_GEOIP_DB_PATH`,
   * and finally to this short alias so external operators / Helm
   * charts that already standardised on `MAXMIND_DB_PATH` keep
   * working without renaming.
   */
  MAXMIND_DB_PATH: z.string().optional(),

  // Auth — login lockout (Task 27.2, Req 27.4 / 27.5 / 27.9)
  /**
   * Progressive lockout for failed login attempts. Each tier defines
   * the failure count that triggers the lockout and the duration in
   * seconds. The defaults match the spec wording for Task 27.2 —
   * 5/1m, 10/5m, 20/30m, 50/24h — and operators can tune them
   * without a code change.
   *
   * The four tiers are checked in ascending order of `_FAILS`. Setting
   * a higher tier's threshold below an earlier tier is undefined
   * behaviour: the loader sorts the table, but the schedule loses its
   * progressive shape and an attacker can dodge the longer lockout.
   */
  LOGIN_LOCKOUT_TIER_1_FAILS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCKOUT_TIER_1_DURATION_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60),
  LOGIN_LOCKOUT_TIER_2_FAILS: z.coerce.number().int().positive().default(10),
  LOGIN_LOCKOUT_TIER_2_DURATION_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 60),
  LOGIN_LOCKOUT_TIER_3_FAILS: z.coerce.number().int().positive().default(20),
  LOGIN_LOCKOUT_TIER_3_DURATION_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(30 * 60),
  LOGIN_LOCKOUT_TIER_4_FAILS: z.coerce.number().int().positive().default(50),
  LOGIN_LOCKOUT_TIER_4_DURATION_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(24 * 60 * 60),

  /**
   * Distinct emails attempted from the same IP inside a rolling
   * 1-hour window that flag the IP as credential stuffing. Defaults
   * to 20 — see `CredentialStuffingDetector` for details.
   */
  CREDENTIAL_STUFFING_DISTINCT_EMAILS_PER_HOUR: z.coerce
    .number()
    .int()
    .positive()
    .default(20),

  /**
   * hCaptcha server-side secret used by `HCaptchaService` (Task 27.2,
   * Req 27.4). When unset, hCaptcha verification is in DEV-MODE
   * BYPASS — a single WARN line is logged at boot. Production
   * deployments MUST set this so the captcha gate added after a
   * TEMP_LOCKED is actually enforced.
   *
   * Generate / rotate via the hCaptcha dashboard:
   *   https://dashboard.hcaptcha.com/
   */
  HCAPTCHA_SECRET: z.string().optional(),

  // ---- Bot detection (Task 27.4, Req 27.6) ----
  /**
   * Master switch for the bot-detection guard
   * (`apps/api/src/modules/security/bot-detection/bot-detection.guard.ts`).
   *
   * When `false`, the guard short-circuits to ALLOW on every request
   * even if `@RequireBotCheck()` is set on the route — useful as an
   * incident kill-switch when a tuning regression is producing false
   * positives. Defaults to `true` so the protection is on by default.
   */
  BOT_DETECTION_ENABLED: z
    .union([z.boolean(), z.string()])
    .default('true')
    .transform((v) =>
      typeof v === 'boolean' ? v : v.toLowerCase() === 'true',
    ),
  /**
   * Score `>= BOT_DETECTION_BLOCK_THRESHOLD` → `BLOCK` decision
   * (`403 BOT_DETECTED`). Operators can lower this to harden a
   * specific route or raise it during noisy migrations. Default
   * `0.85` per the task body (Req 27.6).
   */
  BOT_DETECTION_BLOCK_THRESHOLD: z.coerce
    .number()
    .min(0)
    .max(1)
    .default(0.85),
  /**
   * Score `>= BOT_DETECTION_CHALLENGE_THRESHOLD` (and below the
   * BLOCK threshold) → `CHALLENGE` decision. The bot-detection guard
   * sets `req.captchaRequired = true` and demands a valid
   * `hCaptchaToken`. Default `0.5` per the task body (Req 27.6).
   */
  BOT_DETECTION_CHALLENGE_THRESHOLD: z.coerce
    .number()
    .min(0)
    .max(1)
    .default(0.5),

  // Encryption (Task 28.1, Req 21.8, 28.1, 28.3)
  /**
   * Master key for at-rest field encryption (AES-256-GCM). Must be a
   * **base64-encoded 32-byte value** — generate with:
   *   `openssl rand -base64 32`
   *
   * The boot-time validator in `CryptoModule` (via
   * `EncryptionKeyManager`) decodes the key and refuses to start if
   * the decoded length is anything other than 32 bytes. The
   * schema-level `min(32)` guard catches obviously empty / truncated
   * values before the binary decode runs (the base64 representation
   * of 32 bytes is 44 characters, so any value under 32 chars is
   * unambiguously wrong).
   *
   * **Required in production, optional in dev / test.** Production
   * deployments must set a real key; dev / test fall back to a
   * stable well-known dev key (logged at WARN once) so existing
   * fixtures keep working.
   */
  MASTER_ENCRYPTION_KEY: z
    .string()
    .min(32, 'MASTER_ENCRYPTION_KEY must be ≥ 32 chars (base64 of 32 bytes)')
    .optional(),
  /**
   * Master key for the field-level `EncryptionService` under
   * `apps/api/src/common/security/encryption/` (Task 28.1).
   *
   * Format: hex-encoded 32 bytes (64 hex chars). Generate with:
   *   `openssl rand -hex 32`
   *
   * **Optional in the schema, required at boot in production.** The
   * length / hex validation is intentionally pushed to the
   * `EncryptionService` constructor rather than enforced via Zod
   * here, because the spec asks for a custom `MASTER_KEY_MISSING` /
   * `MASTER_KEY_INVALID` error code that distinguishes "set but
   * malformed" from "missing entirely". Zod's flat union message
   * would lose that distinction.
   *
   * In development / test, leaving this unset falls back to a
   * stable dev key (logged once at WARN). Production deployments
   * MUST set a real value — the constructor refuses to start when
   * `NODE_ENV=production` and `MASTER_KEY` is missing.
   */
  MASTER_KEY: z.string().optional(),
  /**
   * Master key for the at-rest field-level `EncryptionService` under
   * `apps/api/src/common/security/encryption.service.ts` (Task 28.1).
   *
   * Format: **hex-encoded 32 bytes (exactly 64 hex chars)**. Generate
   * with:
   *   `openssl rand -hex 32`
   *
   * Unlike `MASTER_ENCRYPTION_KEY` and `MASTER_KEY`, this key has no
   * dev fallback — the spec requires the boot to refuse to start
   * when the key is missing or has the wrong length. The Zod regex
   * + length check below is the boot guard; the `EncryptionService`
   * constructor performs the same validation defensively so unit
   * tests that bypass `envSchema` still get a deterministic error.
   *
   * The schema marks the field optional to keep existing test
   * fixtures and dev `.env` files (which may not yet supply the
   * key) buildable. Any attempt to construct an `EncryptionService`
   * without a real value throws.
   */
  ENCRYPTION_KEY: z
    .string()
    .regex(
      /^[0-9a-fA-F]{64}$/,
      'ENCRYPTION_KEY must be hex-encoded 32 bytes (64 hex chars). Generate with `openssl rand -hex 32`.',
    )
    .optional(),

  // ---- KMS / Key management (Task 28.2) ----
  /**
   * Selects the active `KmsProvider` implementation bound by
   * `SecurityModule`.
   *
   *   - `local` — store DEKs in the Prisma `EncryptionKey` table,
   *               wrapped by the master key. Suitable for dev /
   *               single-tenant deployments.
   *   - `vault` — talk to HashiCorp Vault's Transit secrets
   *               engine. Requires `VAULT_ADDR`, `VAULT_TOKEN` and
   *               `VAULT_TRANSIT_KEY` to be set; otherwise the
   *               module logs a warning and falls back to `local`.
   *
   * Defaults to `local` so local development and unit tests work
   * without standing up Vault. Production deployments should
   * normally pick `vault`.
   */
  KMS_PROVIDER: z.enum(['local', 'vault']).default('local'),
  /**
   * Vault address used by `VaultKmsProvider`, e.g.
   * `https://vault.internal:8200`. Required when
   * `KMS_PROVIDER=vault`. The provider falls back to the local
   * provider when this is unset to keep dev environments running.
   */
  VAULT_ADDR: z.string().optional(),
  /**
   * Vault token used to authenticate the Transit secrets-engine
   * calls. Should be short-lived and bound to a policy that allows
   * only `read`, `update` (rotate), and `read` on
   * `transit/export/encryption-key/<key>`.
   */
  VAULT_TOKEN: z.string().optional(),
  /**
   * Name of the Vault Transit key used as the at-rest DEK source.
   * Each Vault version maps to a single `KmsKey`.
   */
  VAULT_TRANSIT_KEY: z.string().optional(),
  /**
   * Mount path of the Transit secrets engine. Defaults to
   * `transit` (Vault's out-of-the-box path). Only set this when
   * the engine has been mounted under a custom path.
   */
  VAULT_TRANSIT_MOUNT: z.string().default('transit'),
  /**
   * Days between automatic key rotations. Defaults to 90 (Req
   * 28.5). The cron itself wakes monthly and only rotates when the
   * active key's age has exceeded this threshold, so values lower
   * than ~30 may need a tighter cron expression.
   */
  KMS_ROTATION_INTERVAL_DAYS: z.coerce
    .number()
    .int()
    .positive()
    .default(90),

  // ---- Backup encryption (Task 28.4, Req 28.8) ----
  /**
   * Master key for the offline backup encryption pipeline
   * (`BackupEncryptionService` + `apps/api/scripts/backup-encrypt.ts`).
   *
   * Format: **base64-encoded 32 bytes** (44 base64 chars). Generate
   * with:
   *   `openssl rand -base64 32`
   *
   * **Intentionally separate from `MASTER_ENCRYPTION_KEY` /
   * `ENCRYPTION_KEY`** (Req 28.8). Compromise of the live data
   * encryption key MUST NOT grant access to historical backups, and
   * vice versa. Operators store this in a different secrets backend
   * (e.g. KMS partition / Vault path) than the live keys.
   *
   * Optional in the schema so dev / test runs without backup
   * configured continue to boot. The service logs a single WARN at
   * startup when the key is missing and `encryptStream` /
   * `decryptStream` throw `BackupEncryptionError(KEY_MISSING)` if
   * called.
   */
  BACKUP_ENCRYPTION_KEY: z.string().optional(),

  // ---- TLS enforcement (Task 28.4, Req 28.2) ----
  /**
   * Master switch for `TlsEnforcementMiddleware`. When `true`, the
   * middleware rejects plaintext HTTP requests with a 403
   * `TLS_REQUIRED` envelope. When `false`, the middleware is a
   * no-op.
   *
   * Defaults are environment-aware — `true` in `production`,
   * `false` everywhere else — so local dev and tests keep working
   * over plain HTTP. Operators can override either value
   * explicitly.
   *
   * The middleware trusts `X-Forwarded-Proto` from the first hop
   * (Cloudflare / ingress); make sure `app.set('trust proxy', 1)`
   * is wired in `main.ts` (already done as part of Task 24.1)
   * before flipping this on.
   */
  TLS_ENFORCEMENT_ENABLED: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => {
      if (typeof v === 'boolean') return v;
      if (typeof v === 'string') return v.toLowerCase() === 'true';
      return undefined;
    }),

  // Database
  DATABASE_URL: z.string().min(1),
  DATABASE_READ_REPLICA_URL: z.string().optional(),
  /**
   * When `true`, the Prisma slow-query middleware (Task 24.2) emits a
   * WARN log line for any query taking longer than 200ms, with the
   * `{ model, action, durationMs }` shape. Defaults to `true` in
   * `development` and `false` everywhere else so production noise is
   * driven from APM (Tempo / Grafana), not application logs.
   *
   * Operators can flip this on temporarily to debug a regression
   * without redeploying — `LOG_SLOW_QUERIES=true` is safe in all envs
   * because the middleware only logs (it never blocks the request).
   */
  LOG_SLOW_QUERIES: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => {
      if (typeof v === 'boolean') return v;
      if (typeof v === 'string') return v.toLowerCase() === 'true';
      return undefined;
    }),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Observability (Task 24.3)
  /**
   * When set, callers must pass `?token=<METRICS_TOKEN>` (or the
   * `X-Metrics-Token` header) to scrape `/metrics`. This is *soft*
   * protection — `/metrics` is intended to live behind a private VPC
   * / Prometheus scrape-only firewall — but a token check stops a
   * misconfigured ingress from leaking metric cardinality to the
   * open internet. When unset (typical in dev), the endpoint is
   * unrestricted.
   */
  METRICS_TOKEN: z.string().optional(),
  /**
   * Selects the runtime log format. `json` forces single-line JSON
   * envelopes (Loki-friendly), `pretty`/`text` keeps the human
   * console output. When unset, JSON is used in `production` and
   * the pretty console output is used everywhere else.
   */
  LOG_FORMAT: z.enum(['json', 'pretty', 'text']).optional(),

  // JWT
  /**
   * Symmetric HS256 signing secret. Boot-guarded to be at least 32 bytes
   * (≈256 bits) so a brute-force attack against the access token is
   * computationally infeasible (Task 24.1, Req 21.2). Shorter values
   * cause the `envSchema.safeParse(...)` in `AppConfigModule` to reject
   * startup, mirroring the same posture for `JWT_ACCESS_SECRET` /
   * `JWT_REFRESH_SECRET` deployments that split the keys.
   */
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 bytes (256 bits) for HS256'),
  /**
   * Optional split-secret deployments. If present they're enforced to
   * the same minimum length so a misconfigured rotation can never weaken
   * either side of the access/refresh pair.
   */
  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'JWT_ACCESS_SECRET must be at least 32 bytes (256 bits)')
    .optional(),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, 'JWT_REFRESH_SECRET must be at least 32 bytes (256 bits)')
    .optional(),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  // MFA (Task 29.1)
  /**
   * 32-byte (≥256-bit) secret used to wrap TOTP shared secrets and
   * WebAuthn public keys via AES-256-GCM at the column level.
   * Optional today because Task 28.1 (column-level EncryptionService)
   * may not be wired yet. When unset, the MFA module falls back to a
   * deterministic dev key so tests work locally; production MUST set
   * this to a value rotated through KMS.
   */
  MFA_ENCRYPTION_KEY: z.string().optional(),
  /**
   * Issuer string embedded in `otpauth://` URIs. Authenticator apps
   * use this as the account label prefix.
   */
  MFA_TOTP_ISSUER: z.string().default('Bilgim'),
  /**
   * WebAuthn relying-party id (eTLD+1 of APP_URL). Defaults to
   * `localhost` so dev works out of the box.
   */
  MFA_WEBAUTHN_RP_ID: z.string().default('localhost'),
  /**
   * WebAuthn relying-party name shown to users during enrollment.
   */
  MFA_WEBAUTHN_RP_NAME: z.string().default('Bilgim'),
  /**
   * Origin(s) the WebAuthn response must originate from.
   * Comma-separated list. Defaults to APP_URL when unset.
   */
  MFA_WEBAUTHN_ORIGIN: z.string().optional(),
  /**
   * Short-lived MFA challenge token TTL (seconds). The login flow
   * issues this token after a successful password check and accepts
   * it on the `/auth/mfa/challenge` endpoint within this window.
   */
  MFA_CHALLENGE_TTL_SEC: z.coerce.number().int().positive().default(5 * 60),

  // Cloudflare R2
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().default('edubridge-media'),
  R2_PUBLIC_URL: z.string().optional(),
  /**
   * Local-dev-only override of the S3 endpoint handed to the LiveKit
   * Egress *container* for recording uploads. `R2_PUBLIC_URL` is set to a
   * host-reachable address (e.g. `http://127.0.0.1:9010`) because the API
   * process itself runs on the host — but Egress runs inside the Docker
   * Compose network, where that address doesn't resolve to anything
   * (127.0.0.1 there is the Egress container itself). Falls back to
   * `R2_PUBLIC_URL` when unset, which is correct in production where both
   * the API and Egress reach the same public R2 endpoint.
   */
  R2_EGRESS_URL: z.string().optional(),

  // Video transcoding — absolute paths to local ffmpeg/ffprobe binaries.
  // Falls back to the bare command name (resolved via PATH) when unset,
  // which is fine when the binaries are actually on PATH but silently
  // fails with ENOENT otherwise (e.g. local dev boxes without ffmpeg
  // installed system-wide, using the static binaries under
  // infra/local/bin/ instead).
  FFMPEG_PATH: z.string().optional(),
  FFPROBE_PATH: z.string().optional(),
  /**
   * x264 thread count per encoder (and the shared decoder feeding every
   * rung — see `FfmpegService`). Defaults to 2, tuned for constrained
   * containerized hosts where `-threads 0` (auto) reads the *host's*
   * full core count via cgroups and can OOM. Override upward on a local
   * dev box with real headroom to spare to cut transcode wall-clock time.
   */
  FFMPEG_ENCODE_THREADS: z.coerce.number().int().positive().optional(),

  // Payme
  PAYME_MERCHANT_ID: z.string().optional(),
  PAYME_KEY: z.string().optional(),
  PAYME_TEST_KEY: z.string().optional(),
  PAYME_LOGIN: z.string().default('Paycom'),
  PAYME_IP_ALLOWLIST: z.string().optional(),
  PAYME_CHECKOUT_URL: z
    .string()
    .url()
    .default('https://checkout.paycom.uz'),

  // Claude AI
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-3-5-sonnet-latest'),
  /**
   * Selects which `AiAdapter` implementation `AiModule` binds at
   * bootstrap. `mock` keeps the deterministic in-process adapter used
   * by tests and dev; `anthropic` switches to the real `@anthropic-ai/sdk`
   * client (Task 20.1, Req 13.1, 13.4, 13.5).
   *
   * Default is `mock` so existing test suites and local development
   * continue to work without an API key. Setting `AI_PROVIDER=anthropic`
   * in production requires `ANTHROPIC_API_KEY` to be present — the
   * module guards against the misconfiguration on startup.
   */
  AI_PROVIDER: z.enum(['anthropic', 'mock']).default('mock'),
  /**
   * When `true`, `HomeworkModule` binds `AI_GRADING_PORT` to the real
   * `AnthropicAiGradingAdapter` (Task 20.3) which routes per-module
   * grading through `AiGatewayService` → Anthropic. Default is `false`
   * so existing tests and local dev continue to use the deterministic
   * `MockAiAdapter` and never make network calls.
   *
   * Operators who turn this on MUST also have `AI_PROVIDER=anthropic`
   * and a valid `ANTHROPIC_API_KEY` — otherwise the gateway is
   * unhealthy and grading falls back to error rows in `AiCall`.
   */
  AI_GRADING_REAL: z
    .preprocess(
      (value) =>
        typeof value === 'string'
          ? value === 'true' || value === '1'
          : value,
      z.boolean(),
    )
    .default(false),
  /**
   * Per-user rate limit window size in milliseconds. Defaults to 10 min
   * matching Req 13.5 ("60 calls / 10 daqiqa").
   */
  AI_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(10 * 60 * 1000),
  /** Per-user rate limit max calls inside the window. */
  AI_RATE_LIMIT_MAX_CALLS: z.coerce.number().default(60),
  /**
   * Threshold in `[0, 1]` above which `Submission.aiFlagged` flips to
   * `true` after AI-text detection at submit time (Task 20.3,
   * Req 13.7, 13.8). Defaults to `0.7` matching
   * `AI_LIKELIHOOD_FLAG_THRESHOLD`. Out-of-range values fall back to
   * the default at runtime.
   */
  AI_TEXT_DETECT_THRESHOLD: z.coerce.number().min(0).max(1).default(0.7),

  // Email (SMTP)
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().default('noreply@bilgim.uz'),

  /**
   * Dev/test toggle — when `true`, newly registered users are created
   * with status=ACTIVE and skip the email-verification gate entirely
   * (no token, no `user.registered` outbox event). Production MUST keep
   * this `false` so the verification flow is enforced.
   */
  AUTH_SKIP_EMAIL_VERIFICATION: z
    .union([z.boolean(), z.string()])
    .transform((v) => v === true || v === 'true' || v === '1')
    .default(false),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().optional(),

  // mediasoup SFU
  SFU_LISTEN_IP: z.string().default('0.0.0.0'),
  SFU_ANNOUNCED_IP: z.string().default('127.0.0.1'),
  SFU_MIN_PORT: z.coerce.number().default(40000),
  SFU_MAX_PORT: z.coerce.number().default(40100),
});

export type EnvConfig = z.infer<typeof envSchema>;
