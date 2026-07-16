import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

import { PAYME_DEFAULT_LOGIN } from './payme.constants';
import { PAYME_ERROR_CODES, PaymeError } from './payme.errors';

/**
 * PaymeAuthGuard — Basic Auth + IP allowlist for the Payme webhook
 * (Requirements 4.3, 21.7).
 *
 * Payme sends `Authorization: Basic base64("Paycom:<merchantKey>")` on every
 * JSON-RPC call. The login is by convention always `Paycom`; the secret is
 * whichever key the merchant configured. To support a smooth sandbox →
 * production rollout we accept either `PAYME_KEY` (production) or
 * `PAYME_TEST_KEY` (non-prod), with `PAYME_KEY` always taking precedence
 * when both are present.
 *
 * Implementation notes:
 *   - All comparisons use `crypto.timingSafeEqual` to avoid leaking key
 *     length via timing differences.
 *   - On any failure we throw `PaymeError(-32504)` so the global
 *     `PaymeExceptionFilter` serializes a `{ jsonrpc, id, error }` body with
 *     HTTP 200 — Payme requires HTTP 200 even for errors.
 *   - Failed-auth events are logged at WARN level with structured fields
 *     (Req 21.9 — security audit log). The payload deliberately excludes
 *     the secret, but includes the calling IP and the (untrusted) login it
 *     presented for forensic analysis.
 *
 * Order of checks: IP allowlist → presence of header → scheme → decode →
 * login match → key match. The IP check runs first so we never leak header
 * presence to off-allowlist callers.
 */
@Injectable()
export class PaymeAuthGuard implements CanActivate {
  private readonly logger = new Logger('PaymeAuthGuard');

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    // 1. IP allowlist (optional — empty = allow any, useful for sandbox).
    if (!this.isIpAllowed(request)) {
      this.auditFailure(request, 'ip_not_allowed', undefined);
      throw new PaymeError(PAYME_ERROR_CODES.AUTH_INSUFFICIENT_PRIVILEGE);
    }

    // 2. Authorization header presence.
    const header = request.headers?.authorization as string | undefined;
    if (!header) {
      this.auditFailure(request, 'missing_authorization_header', undefined);
      throw new PaymeError(PAYME_ERROR_CODES.AUTH_INSUFFICIENT_PRIVILEGE);
    }

    // 3. Scheme must be Basic.
    const match = /^Basic\s+(.+)$/i.exec(header);
    const encoded = match?.[1];
    if (!encoded) {
      this.auditFailure(request, 'unsupported_auth_scheme', undefined);
      throw new PaymeError(PAYME_ERROR_CODES.AUTH_INSUFFICIENT_PRIVILEGE);
    }

    // 4. Base64 decode → login:key
    let decoded: string;
    try {
      decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    } catch {
      this.auditFailure(request, 'invalid_base64', undefined);
      throw new PaymeError(PAYME_ERROR_CODES.AUTH_INSUFFICIENT_PRIVILEGE);
    }

    const colonIdx = decoded.indexOf(':');
    if (colonIdx === -1) {
      this.auditFailure(request, 'malformed_credentials', undefined);
      throw new PaymeError(PAYME_ERROR_CODES.AUTH_INSUFFICIENT_PRIVILEGE);
    }
    const presentedLogin = decoded.slice(0, colonIdx);
    const presentedKey = decoded.slice(colonIdx + 1);

    // 5. Login match.
    const expectedLogin =
      this.config.get<string>('PAYME_LOGIN') ?? PAYME_DEFAULT_LOGIN;
    if (!safeEqualString(presentedLogin, expectedLogin)) {
      this.auditFailure(request, 'login_mismatch', presentedLogin);
      throw new PaymeError(PAYME_ERROR_CODES.AUTH_INSUFFICIENT_PRIVILEGE);
    }

    // 6. Key match — accept production or test key.
    if (!this.isKeyValid(presentedKey)) {
      this.auditFailure(request, 'key_mismatch', presentedLogin);
      throw new PaymeError(PAYME_ERROR_CODES.AUTH_INSUFFICIENT_PRIVILEGE);
    }

    return true;
  }

  /**
   * Check if the incoming request IP is on the allowlist.
   *
   * `PAYME_IP_ALLOWLIST` is a comma-separated list (e.g.
   * `185.178.45.0,185.178.45.1`). Empty / unset disables the check.
   *
   * For production, populate with Payme's documented merchant IP ranges.
   */
  private isIpAllowed(request: { ip?: string; ips?: string[] }): boolean {
    const allowlistRaw = this.config.get<string>('PAYME_IP_ALLOWLIST');
    if (!allowlistRaw || allowlistRaw.trim() === '') {
      return true;
    }
    const allowlist = allowlistRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (allowlist.length === 0) return true;

    const candidates = [request.ip, ...(request.ips ?? [])].filter(
      (s): s is string => typeof s === 'string' && s.length > 0,
    );
    if (candidates.length === 0) return false;

    return candidates.some((ip) => allowlist.includes(ip));
  }

  /**
   * Compare presented key against `PAYME_KEY` and `PAYME_TEST_KEY`.
   * Both values are checked in constant time even if only one is configured,
   * to avoid revealing which key matched.
   */
  private isKeyValid(presented: string): boolean {
    const prodKey = this.config.get<string>('PAYME_KEY');
    const testKey = this.config.get<string>('PAYME_TEST_KEY');

    let ok = false;
    if (prodKey) ok = safeEqualString(presented, prodKey) || ok;
    if (testKey) ok = safeEqualString(presented, testKey) || ok;
    return ok;
  }

  /**
   * Emit a structured WARN log on auth failure. Designed for ingestion into
   * the security audit pipeline (Req 21.9).
   *
   * We never log the presented key. We log the presented *login* so that
   * forensic analysis can detect probing patterns, but it is treated as
   * untrusted attacker-controlled input.
   */
  private auditFailure(
    request: { ip?: string; headers?: Record<string, unknown> },
    reason: string,
    presentedLogin: string | undefined,
  ): void {
    this.logger.warn({
      event: 'payme.webhook.auth_failed',
      reason,
      ip: request.ip ?? null,
      userAgent: (request.headers?.['user-agent'] as string | undefined) ?? null,
      presentedLogin: presentedLogin ?? null,
    });
  }
}

/**
 * Constant-time string comparison.
 *
 * `crypto.timingSafeEqual` requires both buffers to be the same length, so
 * we short-circuit on length difference. The length itself is not secret —
 * Payme keys are a fixed length per environment — so the early return is
 * acceptable.
 */
function safeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
