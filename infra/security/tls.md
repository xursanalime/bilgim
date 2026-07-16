# TLS configuration (Task 28.4)

This document describes the **TLS 1.3-only** posture Bilgim enforces
end-to-end and the controls that back it up. It complements
`infra/cloudflare/waf-rules.md` (which captures the broader Cloudflare
zone configuration) and the `helmet` configuration baked into
`apps/api/src/main.ts`.

> **Spec linkage**
>
> - **Req 28.2** — TLS 1.3 majburiy, TLS 1.2 / lower fallback man'.
> - **Req 28.8** — Backup encryption uses separate keys (covered in
>   `apps/api/src/modules/security/backup/backup-encryption.service.ts`).
> - **Req 28.9** — Certificate pinning (mobile + API client docs).

---

## 1. Cloudflare zone settings

The customer-facing edge runs **only** on TLS 1.3. Configure the
production zone (`bilgim.uz`) as follows. Settings live under
`SSL/TLS → Edge Certificates` in the Cloudflare dashboard.

| Setting | Value | Notes |
|---|---|---|
| **Minimum TLS Version** | **TLS 1.3** | Hard reject TLS 1.0 / 1.1 / 1.2 at the edge. Mirrors Req 28.2. |
| **TLS 1.3** | **Enabled (with 0-RTT off)** | 0-RTT replay risk on POST → keep disabled. |
| **Opportunistic Encryption** | **On** | Allows http://… upgrades to TLS where the client supports it. |
| **Automatic HTTPS Rewrites** | **On** | Rewrites mixed-content `http://` references in HTML to `https://`. |
| **Always Use HTTPS** | **On** | 301-redirects every `http://` URL to `https://`. |
| **HSTS** | **On**, `max-age=31536000`, `includeSubDomains`, `preload` | Preload submission via [hstspreload.org](https://hstspreload.org). |
| **Authenticated Origin Pulls** | **On** | mTLS between Cloudflare and the origin so an attacker who learns the origin IP can't bypass the edge. |
| **Cipher Suites** | **Modern (Mozilla recommended)** | Allowlist below. |

### 1.1 Cipher suite allowlist (TLS 1.3)

TLS 1.3 narrows the cipher list dramatically. Allow ONLY these AEAD
suites — every one is forward-secret and uses an AEAD construction
with no padding-oracle / downgrade weaknesses:

```
TLS_AES_256_GCM_SHA384
TLS_CHACHA20_POLY1305_SHA256
TLS_AES_128_GCM_SHA256
```

Drop everything else. **Never** add `TLS_RSA_*`, `TLS_PSK_*`, or any
suite without forward secrecy.

### 1.2 Terraform snippet

```hcl
# infra/cloudflare/terraform/tls.tf (separate ticket — not yet committed).
resource "cloudflare_zone_settings_override" "bilgim" {
  zone_id = var.zone_id
  settings {
    min_tls_version            = "1.3"
    tls_1_3                    = "on"
    automatic_https_rewrites   = "on"
    always_use_https           = "on"
    opportunistic_encryption   = "on"
    universal_ssl              = "on"
    ssl                        = "strict"
  }
}

resource "cloudflare_zone_settings_override" "bilgim_hsts" {
  zone_id = var.zone_id
  settings {
    security_header {
      enabled            = true
      max_age            = 31536000
      include_subdomains = true
      preload            = true
      nosniff            = true
    }
  }
}
```

---

## 2. Origin server (NestJS)

The NestJS API is intended to run **behind a reverse proxy** (Cloudflare
→ ingress / Nginx). The reverse proxy terminates TLS and forwards
plaintext HTTP plus an `X-Forwarded-Proto: https` header. The origin
itself does NOT need to listen on 443 — but the application MUST refuse
any request that arrives without `X-Forwarded-Proto: https` in
production. That refusal is enforced by
`TlsEnforcementMiddleware`
(`apps/api/src/modules/security/tls/tls-enforcement.middleware.ts`).

### 2.1 Behind a reverse proxy (recommended)

| Setting | Value | Notes |
|---|---|---|
| `app.set('trust proxy', 1)` | **Required** | Express must trust the first hop (the ingress / Cloudflare-Tunnel) so `req.ip` and `req.protocol` resolve correctly. Already wired in `main.ts` (Task 24.1). |
| `TLS_ENFORCEMENT_ENABLED` | `true` in production, `false` everywhere else | When on, the middleware rejects requests where `X-Forwarded-Proto !== 'https'` with `403 TLS_REQUIRED`. |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` | Already set by `helmet({ hsts: { maxAge: 31536000, includeSubDomains: true, preload: true } })`. |

### 2.2 Standalone HTTPS (alternative — bare metal / single-VM)

If TLS is terminated at the NestJS process directly (no upstream
proxy), bind an HTTPS server with TLS 1.3 only:

```ts
// apps/api/src/main.ts (alternative bootstrap, NOT enabled by default).
import { readFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import https from 'node:https';

import { AppModule } from './app.module';

async function bootstrapHttps() {
  const server = express();
  await NestFactory.create(AppModule, new ExpressAdapter(server)).then((app) =>
    app.init(),
  );

  https
    .createServer(
      {
        key: readFileSync(process.env.TLS_KEY_PATH!),
        cert: readFileSync(process.env.TLS_CERT_PATH!),
        // Hard-pin TLS 1.3 — no fallback.
        minVersion: 'TLSv1.3',
        maxVersion: 'TLSv1.3',
        // Match Cloudflare's TLS 1.3 cipher allowlist.
        ciphers: [
          'TLS_AES_256_GCM_SHA384',
          'TLS_CHACHA20_POLY1305_SHA256',
          'TLS_AES_128_GCM_SHA256',
        ].join(':'),
        honorCipherOrder: true,
      },
      server,
    )
    .listen(443);
}
```

Operators who pick this path MUST also:

- Generate keys with `openssl ecparam -name prime256v1 -genkey` (P-256)
  or RSA-3072+ — never RSA-2048.
- Rotate certificates on a 90-day cadence (matches Let's Encrypt).
- Disable HTTP listener (`http.createServer`) entirely — the redirect
  is owned by Cloudflare.

### 2.3 HSTS header

Already set via helmet in `apps/api/src/main.ts`:

```ts
helmet({
  hsts: {
    maxAge: 31_536_000,        // 1 year
    includeSubDomains: true,
    preload: true,
  },
});
```

The preload submission lives at <https://hstspreload.org/>. Submit only
once the production zone is ready to enforce HSTS for all subdomains
indefinitely — withdrawing from the preload list takes months.

---

## 3. TLS enforcement middleware

`apps/api/src/modules/security/tls/tls-enforcement.middleware.ts`:

- Active **only** when `TLS_ENFORCEMENT_ENABLED=true`. Default is
  environment-aware: `true` in production, `false` everywhere else.
- Trusts `X-Forwarded-Proto` from the first upstream hop (Cloudflare
  / ingress). Express `trust proxy` is already enabled.
- Rejects with `403 TLS_REQUIRED` + a JSON envelope when the request
  arrives over plaintext HTTP.
- Skips `/health`, `/health/*`, `/metrics`, `/metrics/*` so kubelet /
  Prometheus probes never trip the gate.

The middleware is wired in `app.module.ts` `configure()` after the
existing WAF / SecurityWafMiddleware passes.

---

## 4. Backup encryption

Production database backups are encrypted with **AES-256-GCM** using a
**separate** master key (`BACKUP_ENCRYPTION_KEY`). See:

- `apps/api/src/modules/security/backup/backup-encryption.service.ts`
- `apps/api/scripts/backup-encrypt.ts` / `backup-decrypt.ts`
- `infra/security/backup/run-backup.sh`

The backup key is **never** the same as `MASTER_ENCRYPTION_KEY` /
`ENCRYPTION_KEY` — compromise of either side does not compromise the
other. Backup keys rotate on a 90-day cadence; a short overlap window
during rotation lets the new key encrypt fresh backups while the old
key still decrypts the existing archive.

---

## 5. Certificate pinning

To mitigate MITM via untrusted CA insertion (rooted devices,
intercepting proxies, leaked private CAs), mobile apps and Node-side
API clients pin the SHA-256 fingerprints of the `bilgim.uz`
certificate chain.

- **Mobile (Android)** — `apps/mobile/security/network-security-config.xml`
- **Mobile (iOS)** — `apps/mobile/security/ats-info.plist.snippet`
- **API client (Node)** — `pinnedFingerprints` config option on
  `ApiClient` (`packages/api-client/src/client.ts`).

See `apps/mobile/README.md` for the `expo prebuild` workflow that
applies the configs to the native projects.

### 5.1 Pin lifecycle

Pin two leaf SHA-256 fingerprints at any time:

1. **Active** — the current production leaf certificate.
2. **Backup** — a second cert prepared but not yet served (so an
   emergency rotation has a pre-pinned cert ready).

When the active cert is renewed (every 60 days for Let's Encrypt),
ship a release with the new active + backup pair BEFORE the old cert
expires. Rolling out a new pin without a code release would brick
every existing install.

### 5.2 Generating the SHA-256 pin

```bash
# Active leaf cert pin:
openssl s_client -servername bilgim.uz -connect bilgim.uz:443 \
  </dev/null 2>/dev/null \
  | openssl x509 -pubkey -noout \
  | openssl pkey -pubin -outform DER \
  | openssl dgst -sha256 -binary \
  | openssl enc -base64
```

The output is a base64-encoded 32-byte SHA-256 of the
SubjectPublicKeyInfo (SPKI) — matches the format Android's
`network_security_config.xml` and iOS's TrustKit / NSPinnedDomains
both consume.
