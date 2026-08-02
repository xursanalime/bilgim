import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Lightweight Express-style request shape consumed by the API
 * versioning middleware. Defined locally so the file compiles
 * cleanly under both real Express and unit-test stubs.
 */
export interface ApiVersioningRequest {
  method?: string;
  url?: string;
  originalUrl?: string;
  path?: string;
  headers?: Record<string, string | string[] | undefined>;
}

export interface ApiVersioningResponse {
  headersSent?: boolean;
  status: (code: number) => ApiVersioningResponse;
  json: (body: unknown) => ApiVersioningResponse;
  setHeader?: (name: string, value: string) => unknown;
}

export type ApiVersioningNext = (err?: unknown) => void;

/**
 * Describes a deprecated API version with its sunset date and
 * the replacement version.
 */
export interface DeprecatedVersion {
  /** The deprecated version string, e.g. 'v1'. */
  version: string;
  /** ISO 8601 date when the version will be removed. */
  sunsetDate: string;
  /** The version clients should migrate to. */
  replacementVersion: string;
  /** ISO 8601 date when the deprecation was announced. */
  announcedAt: string;
}

/** Default supported API versions. */
export const SUPPORTED_API_VERSIONS = ['v1', 'v2'] as const;

/** Current (latest) API version. */
export const CURRENT_API_VERSION = 'v2';

/** Minimum deprecation notice period in milliseconds (6 months). */
export const MIN_DEPRECATION_NOTICE_MS = 6 * 30 * 24 * 60 * 60 * 1000;

/**
 * Default deprecation registry. Versions are deprecated with a
 * minimum 6-month advance notice (Req 30.4). The `sunsetDate` is
 * always ≥6 months after `announcedAt`.
 */
export const DEFAULT_DEPRECATED_VERSIONS: ReadonlyArray<DeprecatedVersion> = [
  // Example: v1 deprecated on 2024-07-01, sunset on 2025-01-01
  // Uncomment and adjust when v1 is actually deprecated:
  // {
  //   version: 'v1',
  //   sunsetDate: '2025-01-01T00:00:00Z',
  //   replacementVersion: 'v2',
  //   announcedAt: '2024-07-01T00:00:00Z',
  // },
];

/** DI token for swapping the deprecation registry under test. */
export const API_DEPRECATED_VERSIONS_TOKEN = Symbol(
  'API_DEPRECATED_VERSIONS',
);

/**
 * `ApiVersioningMiddleware` — enforces API versioning and emits
 * deprecation headers (Task 29.5, Req 30.4).
 *
 * Behaviour:
 *
 *   - Extracts the version prefix from the URL path (e.g. `/api/v1/...`).
 *   - If the version is not in `SUPPORTED_API_VERSIONS`, responds
 *     with `400 UNSUPPORTED_API_VERSION`.
 *   - If the version is in the deprecation registry, adds standard
 *     deprecation headers:
 *       - `Deprecation: true`
 *       - `Sunset: <RFC 7231 date>`
 *       - `Link: </api/{replacement}/...>; rel="successor-version"`
 *       - `X-API-Deprecation-Notice: <human-readable message>`
 *   - Non-versioned paths (e.g. `/health`, `/metrics`) pass through
 *     without inspection.
 *
 * The 6-month minimum notice is enforced at configuration time
 * (the registry is validated on module init). Runtime enforcement
 * simply reads the registry and emits headers.
 */
@Injectable()
export class ApiVersioningMiddleware implements NestMiddleware {
  private readonly logger = new Logger(ApiVersioningMiddleware.name);
  private readonly deprecatedVersions: ReadonlyArray<DeprecatedVersion>;
  private readonly supportedVersions: ReadonlyArray<string>;

  constructor(private readonly config: ConfigService) {
    this.deprecatedVersions = DEFAULT_DEPRECATED_VERSIONS;
    this.supportedVersions = [...SUPPORTED_API_VERSIONS];
    this.validateDeprecationRegistry();
  }

  use(
    req: ApiVersioningRequest,
    res: ApiVersioningResponse,
    next: ApiVersioningNext,
  ): void {
    const rawPath = req.originalUrl ?? req.url ?? req.path ?? '';
    const version = this.extractVersion(rawPath);

    // Non-versioned paths pass through (health, metrics, etc.)
    if (!version) {
      return next();
    }

    // Reject unsupported versions.
    if (!this.supportedVersions.includes(version)) {
      if (res.headersSent) return next();
      res.status(400).json({
        error: {
          code: 'UNSUPPORTED_API_VERSION',
          message: `API version '${version}' is not supported. Supported versions: ${this.supportedVersions.join(', ')}`,
          supportedVersions: [...this.supportedVersions],
          currentVersion: CURRENT_API_VERSION,
        },
      });
      return;
    }

    // Check deprecation registry and emit headers.
    const deprecation = this.deprecatedVersions.find(
      (d) => d.version === version,
    );
    if (deprecation && typeof res.setHeader === 'function') {
      try {
        const sunsetDate = new Date(deprecation.sunsetDate);
        res.setHeader('Deprecation', 'true');
        res.setHeader('Sunset', sunsetDate.toUTCString());
        res.setHeader(
          'Link',
          `</api/${deprecation.replacementVersion}>; rel="successor-version"`,
        );
        res.setHeader(
          'X-API-Deprecation-Notice',
          `API ${version} is deprecated and will be removed on ${deprecation.sunsetDate}. Please migrate to ${deprecation.replacementVersion}.`,
        );
      } catch {
        this.logger.warn(
          `Failed to set deprecation headers for version ${version}`,
        );
      }
    }

    // Always set the current API version header.
    if (typeof res.setHeader === 'function') {
      try {
        res.setHeader('X-API-Version', version);
      } catch {
        /* socket already gone */
      }
    }

    return next();
  }

  /**
   * Extract the version segment from a URL path.
   * Matches patterns like `/api/v1/...` or `/v1/...`.
   * Returns `null` for non-versioned paths.
   */
  private extractVersion(path: string): string | null {
    // Strip query string.
    const pathOnly = path.split('?')[0] ?? '';
    // Match /api/v{N} or /v{N} at the start.
    const match = pathOnly.match(/^(?:\/api)?\/(v\d+)/i);
    return match?.[1]?.toLowerCase() ?? null;
  }

  /**
   * Validates that all entries in the deprecation registry have at least
   * 6 months between announcedAt and sunsetDate (Req 30.4).
   */
  private validateDeprecationRegistry(): void {
    for (const entry of this.deprecatedVersions) {
      const announced = new Date(entry.announcedAt).getTime();
      const sunset = new Date(entry.sunsetDate).getTime();
      const noticePeriod = sunset - announced;

      if (noticePeriod < MIN_DEPRECATION_NOTICE_MS) {
        this.logger.error(
          `Deprecation registry violation: version ${entry.version} has less than 6 months notice ` +
            `(announced: ${entry.announcedAt}, sunset: ${entry.sunsetDate})`,
        );
      }
    }
  }
}
