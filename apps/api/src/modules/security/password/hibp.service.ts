import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';

/**
 * HibpService — HaveIBeenPwned Passwords API integration using the
 * k-anonymity model (Requirement 29.5).
 *
 * How k-anonymity works:
 *   1. SHA-1 hash the password
 *   2. Send only the first 5 characters (prefix) to the HIBP API
 *   3. API returns all hash suffixes matching that prefix
 *   4. Check locally if the full hash suffix appears in the response
 *
 * This ensures the full password hash is never sent over the network.
 *
 * @see https://haveibeenpwned.com/API/v3#SearchingPwnedPasswordsByRange
 */
@Injectable()
export class HibpService {
  private readonly logger = new Logger(HibpService.name);

  /** HIBP API base URL for range queries. */
  static readonly API_BASE = 'https://api.pwnedpasswords.com/range';

  /** Request timeout in milliseconds. */
  static readonly TIMEOUT_MS = 5_000;

  /** SHA-1 prefix length sent to the API. */
  static readonly PREFIX_LENGTH = 5;

  /**
   * Get the number of times a password has appeared in known data breaches.
   *
   * @param password - The plaintext password to check
   * @returns Number of times the password appears in breaches (0 = not found)
   * @throws Error if the API request fails (caller should handle fail-open)
   */
  async getBreachCount(password: string): Promise<number> {
    const sha1 = this.sha1(password).toUpperCase();
    const prefix = sha1.substring(0, HibpService.PREFIX_LENGTH);
    const suffix = sha1.substring(HibpService.PREFIX_LENGTH);

    const response = await this.fetchRange(prefix);
    return this.parseResponse(response, suffix);
  }

  /**
   * Compute SHA-1 hash of a password.
   * Note: SHA-1 is used here only because the HIBP API requires it.
   * Actual password storage uses Argon2id.
   */
  sha1(password: string): string {
    return createHash('sha1').update(password, 'utf8').digest('hex');
  }

  /**
   * Fetch hash suffixes from the HIBP range API.
   *
   * @param prefix - First 5 characters of the SHA-1 hash
   * @returns Raw response text (lines of "SUFFIX:COUNT")
   */
  private async fetchRange(prefix: string): Promise<string> {
    const url = `${HibpService.API_BASE}/${prefix}`;

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      HibpService.TIMEOUT_MS,
    );

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Bilgim-PasswordPolicy/1.0',
          'Add-Padding': 'true', // Request padded responses for privacy
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `HIBP API returned ${response.status}: ${response.statusText}`,
        );
      }

      return await response.text();
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Parse the HIBP range response and find the breach count for a suffix.
   *
   * Response format (one per line):
   *   SUFFIX:COUNT
   *
   * Padded entries (privacy enhancement) have count = 0 and should be ignored.
   *
   * @param responseText - Raw API response
   * @param suffix - The hash suffix to look for (chars 5..40 of SHA-1)
   * @returns Breach count (0 if not found)
   */
  parseResponse(responseText: string, suffix: string): number {
    const upperSuffix = suffix.toUpperCase();
    const lines = responseText.split(/\r?\n/);

    for (const line of lines) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;

      const lineSuffix = line.substring(0, colonIdx).trim();
      const countStr = line.substring(colonIdx + 1).trim();

      if (lineSuffix === upperSuffix) {
        const count = parseInt(countStr, 10);
        // Padded entries have count 0 — treat as not found
        return isNaN(count) || count <= 0 ? 0 : count;
      }
    }

    return 0;
  }
}
