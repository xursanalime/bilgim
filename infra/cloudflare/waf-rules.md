# Cloudflare WAF & DDoS configuration

> Edge-layer Web Application Firewall, rate limiting, and DDoS posture
> for the bilgim platform.
>
> **Scope:** Cloudflare zone `bilgim.uz` (and any `*.bilgim.uz`
> subzones). Applies in front of the NestJS API hosted on the origin
> network, the Next.js web app, and the public R2 distribution.
>
> **Defence-in-depth note.** This document covers the **edge** layer
> only. The application layer in `apps/api/src/modules/security/waf/`
> (Task 27.1, Req 27.1) provides a second, severity-tiered pass that
> runs after Cloudflare and is the source of truth for SOC log lines
> tagged `event=waf.detected`. The two layers are intentionally
> redundant — Cloudflare drops the obvious flood at the network edge
> and the application layer adds the SIEM-friendly interpretation
> (BLOCK / LOG / CHALLENGE). The application middleware also takes
> over completely on dev / staging environments where Cloudflare is
> not in front of the API.

---

## 1. Managed Rulesets — OWASP Top 10

We enable the **Cloudflare Managed Ruleset** and the **OWASP Core
Ruleset** on every plan-eligible zone with the following posture.

| Ruleset | Mode | Why |
|---|---|---|
| Cloudflare Managed Ruleset | **Block** (sensitivity: High) | Vendor-curated payload signatures; covers the bulk of CVE-driven probes. |
| OWASP Core Ruleset | **Block** (paranoia: PL2) | OWASP CRS — broader coverage of the OWASP Top 10. PL3+ produces too many false positives on rich-text editor traffic (e.g. discussion threads). |
| Cloudflare Exposed Credentials Check | **Challenge** | Triggers managed challenge when a leaked-credential combo is submitted. Pairs with the application-layer brute-force lockout (Task 27.2). |

The four OWASP Top 10 categories the spec calls out (Req 27.1) are
covered by the following CRS tags, all enabled:

- **A03 — Injection (SQLi):** `OWASP_CRS_id_942100` … `942999`
  (SQL Injection rule family).
- **A03 — Injection (XSS):** `OWASP_CRS_id_941100` … `941999`
  (Cross-Site Scripting rule family).
- **A01 — Broken Access Control / Path Traversal:**
  `OWASP_CRS_id_930100` … `930999` (LFI / Path Traversal).
- **A03 — Injection (RCE / Command Injection):**
  `OWASP_CRS_id_932100` … `932999` (Remote Command Execution).

> **Tuning policy.** No CRS rule is disabled globally. False positives
> are suppressed per-route via Page Rules / WAF Custom Rules with an
> explicit `description` field that names the suppression owner and
> the ticket number.

---

## 2. Custom WAF rules

Custom rules complement the managed rulesets and target patterns
specific to our threat model. Each rule is named with a stable id so
the SOC dashboard can correlate edge blocks with the
`event=waf.detected` lines emitted by `SecurityWafMiddleware`.

### 2.1 Honeypot endpoint trap

Block (and tag) any request to known scanner-bait paths. The
application layer also has a honeypot at `/admin-backup`,
`/wp-login.php`, `/.env` (Task 27.5) — Cloudflare drops the noise
upstream so the application logs stay clean.

```
(http.request.uri.path eq "/wp-login.php") or
(http.request.uri.path eq "/wp-admin") or
(http.request.uri.path eq "/.env") or
(http.request.uri.path eq "/.git/config") or
(http.request.uri.path eq "/admin-backup") or
(http.request.uri.path eq "/phpmyadmin") or
(http.request.uri.path matches "^/(wp-content|xmlrpc\\.php)") 

→ Block (action=block, log=on)
```

### 2.2 Method whitelist

Reject any HTTP verb outside the API's accepted set. Mirrors the
8 KiB header / method check in
`apps/api/src/common/security/waf/waf.middleware.ts`.

```
not (http.request.method in {"GET" "POST" "PUT" "PATCH" "DELETE"
                             "OPTIONS" "HEAD"})

→ Block
```

### 2.3 Suspicious User-Agent challenge

`sqlmap`, `nikto`, `nmap`, `masscan`, `acunetix`, `w3af`, `burpsuite`
and friends. Issue a managed challenge so a human attacker still has
to solve it; an automated scanner will simply bail.

```
(lower(http.user_agent) contains "sqlmap") or
(lower(http.user_agent) contains "nikto") or
(lower(http.user_agent) contains "nmap") or
(lower(http.user_agent) contains "masscan") or
(lower(http.user_agent) contains "acunetix") or
(lower(http.user_agent) contains "w3af") or
(lower(http.user_agent) contains "burpsuite") or
(lower(http.user_agent) contains "fimap") or
(lower(http.user_agent) contains "shodan") or
(http.user_agent eq "")

→ Managed Challenge
```

### 2.4 Country / ASN posture

Default posture: **allow worldwide**, but apply **Managed Challenge**
on traffic from ASN ranges historically associated with hosting /
abuse (Tor exits, known-bad VPS networks). Two rules:

```
# Tor exits — challenge, never outright block (academic users
# legitimately use Tor).
ip.geoip.country in {"T1"} → Managed Challenge

# Known-abuse ASNs (curated, refreshed weekly via the threat
# intelligence feed described in Task 27.5).
ip.geoip.asnum in {<list>} → Managed Challenge
```

### 2.5 Admin path lockdown

`/admin/*` and `/api/v1/admin/*` are challenged for any non-Uz IP.
This is a defence-in-depth complement to the
`AdminIpAllowlistMiddleware` at the application layer (which enforces
a hard allowlist when `ADMIN_IP_ALLOWLIST` is set).

```
(starts_with(http.request.uri.path, "/admin/") or
 starts_with(http.request.uri.path, "/api/v1/admin/"))
and not ip.geoip.country eq "UZ"

→ Managed Challenge
```

---

## 3. Rate limiting at the edge

Cloudflare's rate-limiting rules run **before** any origin request.
The thresholds here are deliberately **looser** than the
application-layer guard (`SecurityRateLimitGuard`, 1000 req/min/IP +
300 req/min/user, see `apps/api/src/modules/security/waf/rate-limit.guard.ts`).
Edge rate limiting catches obvious distributed floods; the
application layer enforces the tighter per-user budget.

| Rule | Threshold | Action | Notes |
|---|---|---|---|
| `global_per_ip` | **5000 req / 60s / IP** | Block 60s | Catches cheap floods. ~5× the application limit so legitimate browser tabs / mobile retry storms aren't tripped. |
| `auth_per_ip` | **30 req / 60s / IP** on `/api/v1/auth/*` | Block 60s + log | Brute-force probing — pairs with the application-layer brute-force service (Task 27.2). |
| `payment_per_ip` | **20 req / 60s / IP** on `/api/v1/billing/*` | Block 60s + log | Card-stuffing / payment probing. |
| `register_per_ip` | **5 req / 60s / IP** on `POST /api/v1/auth/register` | Block 600s | Bot account creation. |
| `password_reset_per_ip` | **3 req / 60s / IP` on `POST /api/v1/auth/password-reset` | Block 600s | Reset enumeration. |

Rate-limit responses always include a `Retry-After` header so the
client SDK can back off; on block, the response is the standard
Cloudflare 1015 / 429 page (no leakage of origin internals).

---

## 4. DDoS protection

### 4.1 Layer 3 / 4 (network)

Always-on. Cloudflare's network-level protection absorbs SYN floods,
UDP amplification, ICMP floods, etc. **No configuration required.**

### 4.2 Layer 7 (HTTP)

| Setting | Value | Notes |
|---|---|---|
| **Bot Fight Mode** | **On** | Free-tier bot mitigation: blocks definitely-bad bots, challenges suspicious ones. Combine with Managed Challenge for verified bots so search-engine crawlers continue to work. |
| **Super Bot Fight Mode** | **On** for paid plans | Adds verified-bot allowlist + JS challenges for ambiguous traffic. |
| **HTTP DDoS Attack Protection** | Sensitivity: **High** | The default sensitivity is sufficient most days; bump to High before predictable peak windows (start of school year, exam day). |
| **Under Attack Mode (UAM)** | **Manual trigger** | Operator runbook: enable when sustained 5xx rate at the origin > 5% for 3 consecutive minutes AND the application-layer DdosGuard reports >10× normal block rate. UAM forces every visitor through a 5-second JavaScript challenge — disruptive UX, only for active incidents. |
| **TLS 1.3** | **Required** | Mirrors Req 28.2 — TLS 1.2 fallback is permitted but TLS 1.0 / 1.1 are disabled at the zone level. |

### 4.3 Triggers for promoting to Under Attack Mode

The on-call runbook:

1. Origin 5xx rate > 5% for 3 consecutive minutes (Grafana
   `http_request_errors_total{status=~"5.."}` panel).
2. Application-layer `ddos.blocked` events > 10× the 7-day p95
   (Loki query, `event="ddos.blocked"` count).
3. Cloudflare DDoS analytics dashboard shows a sustained anomaly.
4. SOC pages on-call → on-call enables UAM via the dashboard or via
   `wrangler` (see `infra/cloudflare/wrangler-uam.md`, ticket `OPS-XX`).

UAM stays on for ≤ 30 minutes by default; longer windows require
incident commander sign-off.

---

## 5. Terraform (`cloudflare_ruleset`) snippets

Production zones are managed via Terraform under
`infra/cloudflare/terraform/` (separate ticket — not yet committed).
The ruleset structure looks like:

```hcl
# Custom WAF — Honeypot + UA challenge + admin-path challenge.
resource "cloudflare_ruleset" "bilgim_waf_custom" {
  zone_id     = var.zone_id
  name        = "bilgim-waf-custom"
  description = "bilgim custom WAF rules"
  kind        = "zone"
  phase       = "http_request_firewall_custom"

  rules {
    description = "Honeypot endpoint trap"
    expression  = <<-EOT
      (http.request.uri.path eq "/wp-login.php") or
      (http.request.uri.path eq "/.env") or
      (http.request.uri.path eq "/admin-backup") or
      (http.request.uri.path eq "/phpmyadmin")
    EOT
    action = "block"
    enabled = true
  }

  rules {
    description = "Suspicious User-Agent challenge"
    expression  = <<-EOT
      (lower(http.user_agent) contains "sqlmap") or
      (lower(http.user_agent) contains "nikto") or
      (lower(http.user_agent) contains "nmap") or
      (lower(http.user_agent) contains "burpsuite") or
      (http.user_agent eq "")
    EOT
    action  = "managed_challenge"
    enabled = true
  }

  rules {
    description = "Method whitelist"
    expression  = <<-EOT
      not (http.request.method in {"GET" "POST" "PUT" "PATCH"
                                    "DELETE" "OPTIONS" "HEAD"})
    EOT
    action  = "block"
    enabled = true
  }
}

# Managed OWASP Core Ruleset (override only — overrides + exclusions).
resource "cloudflare_ruleset" "bilgim_waf_managed_owasp" {
  zone_id     = var.zone_id
  name        = "bilgim-waf-managed-owasp"
  description = "Cloudflare-managed OWASP CRS with bilgim tuning"
  kind        = "zone"
  phase       = "http_request_firewall_managed"

  rules {
    description = "Execute OWASP managed ruleset (PL2)"
    expression  = "true"
    action      = "execute"
    action_parameters {
      id = "4814384a9e5d4991b9815dcfc25d2f1f" # OWASP CRS ruleset id
      overrides {
        sensitivity_level = "high"
      }
    }
    enabled = true
  }
}

# Edge rate limiting — applied via the rate-limit phase ruleset.
resource "cloudflare_ruleset" "bilgim_rate_limit" {
  zone_id     = var.zone_id
  name        = "bilgim-rate-limit"
  description = "Edge rate limits — looser than the application layer"
  kind        = "zone"
  phase       = "http_ratelimit"

  rules {
    description = "Global per-IP — 5000 req / 60s"
    expression  = "true"
    action      = "block"
    ratelimit {
      characteristics      = ["ip.src"]
      requests_per_period  = 5000
      period               = 60
      mitigation_timeout   = 60
    }
    enabled = true
  }

  rules {
    description = "Auth per-IP — 30 req / 60s on /api/v1/auth/*"
    expression  = "starts_with(http.request.uri.path, \"/api/v1/auth/\")"
    action      = "block"
    ratelimit {
      characteristics     = ["ip.src"]
      requests_per_period = 30
      period              = 60
      mitigation_timeout  = 60
    }
    enabled = true
  }
}
```

> **Source-of-truth.** When the Terraform module diverges from this
> document, **Terraform wins**. Update this doc to match.

---

## 6. Observability & integration with the application layer

- **Cloudflare → Loki:** the SIEM exporter (Task 27.5) ingests
  Cloudflare Firewall Events and tags them `source=cloudflare`. The
  `event=waf.detected` lines from the application layer get
  `source=app`. Side-by-side dashboards make it easy to tell whether
  an attacker is getting filtered upstream or only at the API.
- **Trace correlation:** Cloudflare's Ray ID is forwarded to the
  origin as `Cf-Ray`. The application's `LoggingInterceptor` already
  records this header on every request, so an SOC analyst can pivot
  from a Cloudflare event → ray id → application trace id in one
  query.
- **Manual block list:** the application's threat-intelligence
  service (Task 27.5) periodically syncs known-bad IPs from
  AbuseIPDB / Spamhaus into a Cloudflare IP list named
  `app_threat_feed`. The list is referenced from a Custom Rule:
  ```
  ip.src in $app_threat_feed → Block
  ```
  This closes the loop: a single application detection (e.g. a
  honeypot hit) can result in the IP being blocked at the edge for
  every subsequent zone in the account.

---

## 7. Change management

- Every WAF rule change goes through the standard PR flow on the
  Terraform module. Ad-hoc dashboard edits are reviewed and codified
  within 24 hours.
- Bot Fight Mode / UAM / sensitivity flips are logged in the SOC
  channel with a short reason and an expiry.
- The `cloudflare_ruleset` resources have `lifecycle { create_before_destroy = true }`
  so rule deletions never leave the zone unprotected during apply.

---

## 8. Reference

- [Cloudflare Managed Rules — OWASP Core Ruleset](https://developers.cloudflare.com/waf/managed-rules/reference/owasp-core-ruleset/)
- [Cloudflare Rate Limiting](https://developers.cloudflare.com/waf/rate-limiting-rules/)
- [Bot Fight Mode](https://developers.cloudflare.com/bots/get-started/free/)
- [Under Attack Mode](https://developers.cloudflare.com/fundamentals/reference/under-attack-mode/)
- Application-layer counterpart: `apps/api/src/modules/security/waf/`
  (Task 27.1, Req 27.1 / 27.2).
