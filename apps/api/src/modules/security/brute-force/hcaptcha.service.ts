import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Result of an hCaptcha siteverify round-trip. */
export interface HCaptchaVerificationResult {
  success: boolean;
  /** Hostname the challenge was rendered on (for logging). */
  hostname?: string;
  /** Score-style risk for enterprise plans, otherwise undefined. */
  score?: number;
  /** Raw error codes returned by hCaptcha (`invalid-input-response`, …). */
  errorCodes: string[];
}

/**
 * `HCaptchaService` — Task 27.2 hCaptcha verification helper.
 *
 * Used by the auth flow to validate an `hCaptchaToken` posted alongside
 * the login DTO when `BruteForceService.checkAccountStatus()` reports
 * `captchaRequired === true` (after a TEMP_LOCKED is applied —
 * Req 27.4).
 *
 * The service performs a server-side POST against the official hCaptcha
 * `siteverify` endpoint:
 *
 *   https://hcaptcha.com/siteverify
 *
 * with form-encoded `secret` + `response` (and optionally `remoteip`).
 *
 * ## Dev / test bypass
 *
 * When `HCAPTCHA_SECRET` is not set, verification is skipped entirely
 * and a single WARN line is logged at startup so this is never silently
 * left open in production. The fail-open is intentional: locking down
 * dev / test is the role of the env var, not of this service.
 *
 * ## Custom fetch
 *
 * The constructor accepts an optional `fetchImpl` so unit tests can
 * inject a stub without monkey-patching `globalThis.fetch`. In
 * production we default to the platform `fetch` (Node 18+).
 */
@Injectable()
export class HCaptchaService {
  private readonly logger = new Logger(HCaptchaService.name);

  /** hCaptcha public siteverify endpoint. */
  static readonly VERIFY_URL = 'https://hcaptcha.com/siteverify';

  /** Time budget for the upstream POST (ms). */
  static readonly VERIFY_TIMEOUT_MS = 5_000;

  /** Error code surfaced to API clients on a failed verification. */
  static readonly ERROR_CODE = 'CAPTCHA_REQUIRED';

  /** Resolved secret — empty string means dev-mode bypass. */
  private readonly secret: string;

  /**
   * Pluggable `fetch` reference. Defaults to the platform global so
   * tests can swap in a stub without touching `globalThis`.
   */
  private readonly fetchImpl: typeof fetch;

  constructor(
    @Optional() configService?: ConfigService,
    @Optional() fetchImpl?: typeof fetch,
  ) {
    const raw = configService?.get<string>('HCAPTCHA_SECRET') ?? '';
    this.secret = raw.trim();
    if (!this.secret) {
      this.logger.warn(
        'HCAPTCHA_SECRET is not set — hCaptcha verification is in DEV-MODE BYPASS. Set HCAPTCHA_SECRET in production.',
      );
    }
    this.fetchImpl = fetchImpl ?? fetch;
  }

  // =====================================================================
  // Public API
  // =====================================================================

  /**
   * `true` when the env var is wired and verification will actually
   * call out to hCaptcha. Useful for tests and observability.
   */
  isEnabled(): boolean {
    return this.secret.length > 0;
  }

  /**
   * Verify an hCaptcha token. Returns a structured result so the
   * caller can decide how to surface the failure (e.g. attach the
   * error codes to a 403 response). When the secret is unset this
   * always returns `{ success: true, errorCodes: [] }`.
   */
  async verify(
    token: string,
    remoteIp?: string,
  ): Promise<HCaptchaVerificationResult> {
    if (!this.isEnabled()) {
      // Dev-mode bypass — caller should still gate on
      // `BruteForceService.checkAccountStatus().captchaRequired` so
      // production flows stay enforced when the secret is added.
      return { success: true, errorCodes: [] };
    }

    const trimmed = (token ?? '').trim();
    if (!trimmed) {
      return { success: false, errorCodes: ['missing-input-response'] };
    }

    const params = new URLSearchParams();
    params.set('secret', this.secret);
    params.set('response', trimmed);
    if (remoteIp) params.set('remoteip', remoteIp);

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      HCaptchaService.VERIFY_TIMEOUT_MS,
    );

    try {
      const res = await this.fetchImpl(HCaptchaService.VERIFY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        signal: controller.signal,
      });
      if (!res.ok) {
        this.logger.warn(
          `hCaptcha siteverify returned HTTP ${res.status}`,
        );
        return {
          success: false,
          errorCodes: [`upstream-${res.status}`],
        };
      }
      const data = (await res.json()) as {
        success?: boolean;
        hostname?: string;
        score?: number;
        'error-codes'?: string[];
      };
      const result: HCaptchaVerificationResult = {
        success: Boolean(data.success),
        errorCodes: data['error-codes'] ?? [],
      };
      if (typeof data.hostname === 'string') {
        result.hostname = data.hostname;
      }
      if (typeof data.score === 'number') {
        result.score = data.score;
      }
      return result;
    } catch (err) {
      this.logger.warn(
        `hCaptcha siteverify call failed: ${(err as Error).message}`,
      );
      // Fail closed on transport errors when verification is
      // enabled — better to ask the user to retry than to silently
      // accept a possibly-bogus token.
      return { success: false, errorCodes: ['network-error'] };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Convenience wrapper that throws `403 CAPTCHA_REQUIRED` when the
   * token is missing or invalid. Callers that prefer a structured
   * result should use `verify()` directly.
   */
  async assertValid(token: string | undefined, remoteIp?: string): Promise<void> {
    const result = await this.verify(token ?? '', remoteIp);
    if (!result.success) {
      throw new HttpException(
        {
          code: HCaptchaService.ERROR_CODE,
          message: 'A valid hCaptcha solution is required to continue.',
          details: { errorCodes: result.errorCodes },
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }
}
