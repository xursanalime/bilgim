# Security Headers Checklist — A+ Rating

> **Validates: Requirement 32.8**
>
> securityheaders.com da A+ ball olish uchun zarur barcha HTTP xavfsizlik headerlari.
> NestJS (API) va Next.js (Web) uchun alohida konfiguratsiya.

---

## 1. Required Headers Summary

| Header | Value | Priority | Status |
|---|---|---|---|
| Strict-Transport-Security | `max-age=63072000; includeSubDomains; preload` | Critical | ☐ |
| Content-Security-Policy | See detailed config below | Critical | ☐ |
| X-Content-Type-Options | `nosniff` | High | ☐ |
| X-Frame-Options | `DENY` | High | ☐ |
| Referrer-Policy | `strict-origin-when-cross-origin` | High | ☐ |
| Permissions-Policy | See detailed config below | High | ☐ |
| Cross-Origin-Opener-Policy | `same-origin` | Medium | ☐ |
| Cross-Origin-Embedder-Policy | `require-corp` | Medium | ☐ |
| Cross-Origin-Resource-Policy | `same-origin` | Medium | ☐ |
| X-XSS-Protection | `0` (CSP bilan almashtirilgan) | Low | ☐ |
| X-DNS-Prefetch-Control | `off` | Low | ☐ |
| X-Permitted-Cross-Domain-Policies | `none` | Low | ☐ |

---

## 2. NestJS API Configuration

### 2.1 Helmet Middleware (apps/api/src/main.ts)

```typescript
import helmet from 'helmet';

// main.ts da bootstrap() ichida:
app.use(
  helmet({
    // Strict-Transport-Security
    hsts: {
      maxAge: 63072000, // 2 yil
      includeSubDomains: true,
      preload: true,
    },

    // Content-Security-Policy
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // NestJS Swagger UI uchun
        imgSrc: ["'self'", 'data:', 'https:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        mediaSrc: ["'self'", 'https://*.r2.cloudflarestorage.com'],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: [],
      },
    },

    // X-Frame-Options
    frameguard: { action: 'deny' },

    // X-Content-Type-Options
    noSniff: true,

    // Referrer-Policy
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },

    // X-DNS-Prefetch-Control
    dnsPrefetchControl: { allow: false },

    // X-Permitted-Cross-Domain-Policies
    permittedCrossDomainPolicies: { permittedPolicies: 'none' },

    // X-XSS-Protection (0 — CSP bilan almashtirilgan)
    xssFilter: false,

    // Cross-Origin-Opener-Policy
    crossOriginOpenerPolicy: { policy: 'same-origin' },

    // Cross-Origin-Embedder-Policy
    crossOriginEmbedderPolicy: { policy: 'require-corp' },

    // Cross-Origin-Resource-Policy
    crossOriginResourcePolicy: { policy: 'same-origin' },
  }),
);

// Permissions-Policy (helmet qo'llab-quvvatlamaydi, manual qo'shish)
app.use((req, res, next) => {
  res.setHeader(
    'Permissions-Policy',
    [
      'accelerometer=()',
      'camera=()',
      'geolocation=()',
      'gyroscope=()',
      'magnetometer=()',
      'microphone=()',
      'payment=()',
      'usb=()',
      'interest-cohort=()',
      'browsing-topics=()',
    ].join(', '),
  );
  next();
});
```

### 2.2 CORS Configuration

```typescript
app.enableCors({
  origin: [
    process.env.WEB_URL, // https://edubridge.uz
    process.env.ADMIN_URL, // https://admin.edubridge.uz
  ],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-CSRF-Token'],
  credentials: true,
  maxAge: 86400, // 24 soat preflight cache
});
```

---

## 3. Next.js Web Configuration

### 3.1 next.config.mjs Security Headers

```javascript
// apps/web/next.config.mjs

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '0',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=(), browsing-topics=()',
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'require-corp',
          },
          {
            key: 'Cross-Origin-Resource-Policy',
            value: 'same-origin',
          },
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'off',
          },
          {
            key: 'X-Permitted-Cross-Domain-Policies',
            value: 'none',
          },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline'", // Next.js dev uchun; production da qattiqroq
              "style-src 'self' 'unsafe-inline'", // Tailwind inline styles
              "img-src 'self' data: https: blob:",
              "font-src 'self' data:",
              "connect-src 'self' https://api.edubridge.uz wss://api.edubridge.uz",
              "media-src 'self' https://*.r2.cloudflarestorage.com blob:",
              "object-src 'none'",
              "frame-src 'none'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "upgrade-insecure-requests",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
```

### 3.2 Production CSP (qattiqroq)

```javascript
// Production uchun script-src ni qattiqlashtirish:
// 'unsafe-eval' va 'unsafe-inline' o'rniga nonce ishlatish

const cspHeader = {
  key: 'Content-Security-Policy',
  value: [
    "default-src 'self'",
    `script-src 'self' 'nonce-{{nonce}}'`, // Next.js nonce support
    "style-src 'self' 'unsafe-inline'", // Tailwind uchun zarur
    "img-src 'self' data: https: blob:",
    "font-src 'self' data:",
    "connect-src 'self' https://api.edubridge.uz wss://api.edubridge.uz",
    "media-src 'self' https://*.r2.cloudflarestorage.com blob:",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join('; '),
};
```

---

## 4. Cloudflare Configuration (CDN/Proxy Level)

### 4.1 Cloudflare Dashboard Settings

```yaml
# Cloudflare SSL/TLS settings
ssl_mode: full_strict
min_tls_version: "1.2"
tls_1_3: "on"
automatic_https_rewrites: "on"
always_use_https: "on"
opportunistic_encryption: "on"

# HSTS via Cloudflare (backup — app-level ham o'rnatilgan)
hsts:
  enabled: true
  max_age: 63072000
  include_subdomains: true
  preload: true
  no_sniff: true

# Security headers via Cloudflare Transform Rules (fallback)
transform_rules:
  - name: "Security Headers"
    expression: "true"
    action: "set"
    headers:
      X-Content-Type-Options: "nosniff"
      X-Frame-Options: "DENY"
      Referrer-Policy: "strict-origin-when-cross-origin"
      Permissions-Policy: "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()"
```

### 4.2 Cloudflare WAF Rules

```yaml
# Custom WAF rules
waf_rules:
  - name: "Block known bad bots"
    expression: "(cf.client.bot) and not (cf.bot_management.verified_bot)"
    action: "challenge"

  - name: "Rate limit API"
    expression: '(http.request.uri.path matches "^/api/")'
    action: "rate_limit"
    threshold: 100
    period: 60

  - name: "Block SQL injection attempts"
    expression: '(http.request.uri.query contains "UNION" or http.request.uri.query contains "SELECT")'
    action: "block"
```

---

## 5. Headers Removed (Information Leakage Prevention)

| Header | Action | Reason |
|---|---|---|
| `X-Powered-By` | Remove | Server technology disclosure |
| `Server` | Remove/Generic | Server software disclosure |
| `X-AspNet-Version` | Remove | Framework disclosure |
| `X-Runtime` | Remove | Timing attack vector |

### NestJS Implementation

```typescript
// main.ts
app.getHttpAdapter().getInstance().disable('x-powered-by');
```

### Nginx/Cloudflare

```nginx
# nginx.conf (agar ishlatilsa)
server_tokens off;
proxy_hide_header X-Powered-By;
proxy_hide_header Server;
```

---

## 6. Testing & Validation

### 6.1 Local Testing

```bash
# API headerlarini tekshirish
curl -I https://api.edubridge.uz/health

# Expected output:
# strict-transport-security: max-age=63072000; includeSubDomains; preload
# content-security-policy: default-src 'self'; ...
# x-content-type-options: nosniff
# x-frame-options: DENY
# referrer-policy: strict-origin-when-cross-origin
# permissions-policy: accelerometer=(), camera=(), ...
# cross-origin-opener-policy: same-origin
# cross-origin-embedder-policy: require-corp
# cross-origin-resource-policy: same-origin
```

### 6.2 Online Validation Tools

| Tool | URL | Target Score |
|---|---|---|
| SecurityHeaders.com | https://securityheaders.com | A+ |
| Mozilla Observatory | https://observatory.mozilla.org | A+ |
| SSL Labs | https://www.ssllabs.com/ssltest/ | A+ |
| CSP Evaluator | https://csp-evaluator.withgoogle.com | No findings |

### 6.3 Automated CI Check

```bash
# CI pipeline da headerlarni tekshirish (sast-dast.yml da ishlatiladi)
#!/bin/bash
REQUIRED_HEADERS=(
  "strict-transport-security"
  "content-security-policy"
  "x-content-type-options"
  "x-frame-options"
  "referrer-policy"
  "permissions-policy"
  "cross-origin-opener-policy"
  "cross-origin-embedder-policy"
  "cross-origin-resource-policy"
)

URL="${1:-https://api.edubridge.uz/health}"
HEADERS=$(curl -sI "$URL")
MISSING=0

for header in "${REQUIRED_HEADERS[@]}"; do
  if echo "$HEADERS" | grep -qi "$header"; then
    echo "✅ $header"
  else
    echo "❌ MISSING: $header"
    MISSING=$((MISSING + 1))
  fi
done

if [ $MISSING -gt 0 ]; then
  echo ""
  echo "❌ $MISSING required header(s) missing!"
  exit 1
fi

echo ""
echo "✅ All required security headers present"
```

---

## 7. Common Issues & Solutions

### 7.1 CSP Violations

| Issue | Solution |
|---|---|
| Next.js inline scripts | Use `nonce` attribute with `next/script` |
| Tailwind inline styles | Allow `'unsafe-inline'` for `style-src` |
| External fonts (Google) | Add `fonts.googleapis.com` to `font-src` |
| WebSocket connections | Add `wss://` to `connect-src` |
| R2 media files | Add `*.r2.cloudflarestorage.com` to `media-src` |
| HLS video playback | Add `blob:` to `media-src` |

### 7.2 COOP/COEP Issues

| Issue | Solution |
|---|---|
| Cross-origin images | Add `crossorigin` attribute to `<img>` |
| Third-party embeds | Use `credentialless` instead of `require-corp` |
| SharedArrayBuffer needed | Keep `require-corp` (needed for video workers) |

### 7.3 HSTS Preload Requirements

1. Valid HTTPS certificate
2. Redirect HTTP → HTTPS (301)
3. All subdomains must support HTTPS
4. HSTS header with `max-age >= 31536000` (1 year minimum)
5. `includeSubDomains` directive present
6. `preload` directive present
7. Submit to https://hstspreload.org

---

## 8. Deployment Checklist

### Pre-deployment

- [ ] Helmet middleware configured in NestJS
- [ ] Security headers in next.config.mjs
- [ ] Permissions-Policy middleware added
- [ ] X-Powered-By disabled
- [ ] CORS properly configured
- [ ] CSP tested with report-only mode first

### Post-deployment

- [ ] securityheaders.com scan → A+ confirmed
- [ ] Mozilla Observatory scan → A+ confirmed
- [ ] SSL Labs scan → A+ confirmed
- [ ] No CSP violations in browser console
- [ ] All application features working (no header conflicts)
- [ ] HSTS preload submitted (after 1 week stable)

### Monitoring

- [ ] CSP violation reporting endpoint configured (`report-uri` / `report-to`)
- [ ] Alert on new CSP violations
- [ ] Weekly security headers scan in CI
- [ ] Monthly manual review of header configuration
