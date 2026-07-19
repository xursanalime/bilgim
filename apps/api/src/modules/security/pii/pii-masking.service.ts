import { Injectable, Logger } from '@nestjs/common';

/**
 * Supported PII types that the masking service can detect and redact.
 */
export type PiiType = 'email' | 'phone' | 'ip' | 'card';

/**
 * Result of a PII detection scan — the original value, its type,
 * and the masked replacement.
 */
export interface PiiMatch {
  original: string;
  type: PiiType;
  masked: string;
}

/**
 * Configuration for the PII masking service. Allows callers to
 * selectively enable/disable detection of specific PII types.
 */
export interface PiiMaskingConfig {
  /** Which PII types to detect. Defaults to all. */
  enabledTypes?: PiiType[];
}

/**
 * Regex patterns for PII detection.
 *
 * These are intentionally broad — false positives in log masking are
 * acceptable (better to over-mask than leak PII). The patterns are
 * designed for English/international formats commonly seen in
 * Uzbekistan and global contexts.
 */
const PII_PATTERNS: Record<PiiType, RegExp> = {
  /** Matches standard email addresses. */
  email: /[a-zA-Z0-9!#$%&'*+/=?^_`{|}~.-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  /**
   * Matches phone numbers in various formats:
   * +998901234567, +998 90 123 45 67, 998901234567,
   * +1-555-123-4567, (555) 123-4567
   */
  phone: /(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{2,4}[-.\s]?\d{2,4}/g,
  /**
   * Matches IPv4 addresses (e.g. 192.168.1.1) and IPv6 addresses
   * (simplified — full coloned hex groups).
   */
  ip: /(?:\d{1,3}\.){3}\d{1,3}|(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}/g,
  /**
   * Matches credit/debit card numbers (13-19 digits, optionally
   * separated by spaces or dashes).
   */
  card: /\b(?:\d[ -]*?){13,19}\b/g,
};

/**
 * `PiiMaskingService` — Task 28.3, Requirement 28.6.
 *
 * Detects and masks PII in arbitrary text strings. Used by:
 *   - The Pino custom serializer to redact PII from log output.
 *   - Error handlers to sanitize exception messages before they
 *     reach external consumers (Sentry, client responses, etc.).
 *   - Any service that needs to produce a "safe" version of a
 *     string containing user data.
 *
 * Masking rules:
 *   - Email: "user@example.com" → "u***@e***.com"
 *   - Phone: "+998901234567" → "***4567"
 *   - IP: "192.168.1.100" → "192.168.*.*"
 *   - Card: "4111 1111 1111 1111" → "****1111"
 */
@Injectable()
export class PiiMaskingService {
  private readonly logger = new Logger(PiiMaskingService.name);
  private readonly enabledTypes: Set<PiiType>;

  constructor(config?: PiiMaskingConfig) {
    this.enabledTypes = new Set(
      config?.enabledTypes ?? ['email', 'phone', 'ip', 'card'],
    );
  }

  /**
   * Mask all detected PII in the input text. Returns the sanitized
   * string with all PII replaced by masked versions.
   */
  mask(input: string): string {
    if (!input || typeof input !== 'string') return input;

    let result = input;

    // Process in order: card first (longest patterns), then email,
    // phone, IP — avoids partial matches interfering.
    const orderedTypes: PiiType[] = ['card', 'email', 'phone', 'ip'];

    for (const type of orderedTypes) {
      if (!this.enabledTypes.has(type)) continue;
      result = this.maskType(result, type);
    }

    return result;
  }

  /**
   * Detect all PII occurrences in the input text without masking.
   * Useful for audit logging or compliance checks.
   */
  detect(input: string): PiiMatch[] {
    if (!input || typeof input !== 'string') return [];

    const matches: PiiMatch[] = [];

    for (const type of this.enabledTypes) {
      const pattern = new RegExp(PII_PATTERNS[type].source, 'g');
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(input)) !== null) {
        // Skip very short matches for phone (likely false positives)
        if (type === 'phone' && match[0].replace(/\D/g, '').length < 7) {
          continue;
        }
        matches.push({
          original: match[0],
          type,
          masked: this.maskValue(match[0], type),
        });
      }
    }

    return matches;
  }

  /**
   * Mask a single known PII value by type.
   */
  maskValue(value: string, type: PiiType): string {
    switch (type) {
      case 'email':
        return this.maskEmail(value);
      case 'phone':
        return this.maskPhone(value);
      case 'ip':
        return this.maskIp(value);
      case 'card':
        return this.maskCard(value);
      default:
        return '***REDACTED***';
    }
  }

  // -------------------------------------------------------------------------
  // Private masking implementations
  // -------------------------------------------------------------------------

  private maskType(text: string, type: PiiType): string {
    const pattern = new RegExp(PII_PATTERNS[type].source, 'g');

    return text.replace(pattern, (match) => {
      // Skip very short phone matches (likely false positives like port numbers)
      if (type === 'phone' && match.replace(/\D/g, '').length < 7) {
        return match;
      }
      return this.maskValue(match, type);
    });
  }

  /**
   * Email masking: "user@example.com" → "u***@e***.com"
   */
  private maskEmail(email: string): string {
    const atIndex = email.indexOf('@');
    if (atIndex < 0) return '***@***';

    const local = email.slice(0, atIndex);
    const domain = email.slice(atIndex + 1);

    const domainParts = domain.split('.');
    const tld = domainParts.pop() ?? '';
    const domainName = domainParts.join('.');

    const maskedLocal = local.length > 0 ? `${local[0]}***` : '***';
    const maskedDomain =
      domainName.length > 0 ? `${domainName[0]}***` : '***';

    return `${maskedLocal}@${maskedDomain}.${tld}`;
  }

  /**
   * Phone masking: "+998901234567" → "***4567"
   * Shows only the last 4 digits.
   */
  private maskPhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 4) return '***';
    return `***${digits.slice(-4)}`;
  }

  /**
   * IP masking: "192.168.1.100" → "192.168.*.*"
   * Preserves the first two octets for IPv4, masks the rest.
   * For IPv6, shows first two groups and masks the rest.
   */
  private maskIp(ip: string): string {
    if (ip.includes(':')) {
      // IPv6: show first two groups
      const groups = ip.split(':');
      if (groups.length >= 2) {
        return `${groups[0]}:${groups[1]}:****`;
      }
      return '****:****';
    }

    // IPv4: show first two octets
    const octets = ip.split('.');
    if (octets.length === 4) {
      return `${octets[0]}.${octets[1]}.*.*`;
    }
    return '*.*.*.*';
  }

  /**
   * Card masking: "4111111111111111" → "****1111"
   * Shows only the last 4 digits.
   */
  private maskCard(card: string): string {
    const digits = card.replace(/\D/g, '');
    if (digits.length < 4) return '****';
    return `****${digits.slice(-4)}`;
  }
}
