# ADR 001: Dual WAF (Web Application Firewall) Strategy

## Status
Accepted

## Context
The Bilgim platform requires robust protection against common web attacks (OWASP Top 10) such as SQL Injection, Cross-Site Scripting (XSS), and Path Traversal. We operate in an environment where we need both edge-level protection and application-level fine-grained control.

## Decision
We implement a **Dual WAF Strategy**:

1.  **Edge WAF (Cloudflare):**
    *   **Purpose:** Bulk traffic filtering, DDoS protection, and blocking known malicious IPs/botnets before they reach our infrastructure.
    *   **Configuration:** Managed via `infra/cloudflare/waf-rules.md`.
2.  **Application WAF (NestJS Middleware):**
    *   **Purpose:** Deep packet inspection of request bodies, application-specific rule enforcement, and SIEM integration.
    *   **Implementation:** `apps/api/src/modules/security/waf/`.
    *   **Behavior:**
        *   `BLOCK`: Returns 403 Forbidden for high-confidence attacks.
        *   `LOG`: Permits the request but records a security event in the SIEM for analysis.
        *   `CHALLENGE`: Marks the request with a flag for downstream guards to potentially require MFA or additional verification.

## Consequences
*   **Defense in Depth:** Even if edge protections are bypassed or misconfigured, the application remains protected.
*   **Observability:** Application-level detections are logged directly into our `SiemService`, providing better context for incident response.
*   **Performance:** There is a minor latency overhead for regex matching in the middleware, mitigated by optimized patterns and skipping internal/health-check routes.
*   **Maintenance:** WAF rules must be kept in sync between the edge and the application. Application-level rules should focus on business-logic specific threats.
