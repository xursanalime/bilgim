/**
 * API error envelope helpers.
 *
 * The NestJS backend wraps every non-2xx response in:
 *
 *   { error: { code, message, details?, traceId? } }
 *
 * (see `apps/api/src/common/filters/all-exceptions.filter.ts`). This
 * module exposes the matching TypeScript shape and an `ApiClientError`
 * class that callers can `instanceof`-check to read `code` / `details`.
 */

export interface ApiErrorEnvelope {
  /** Machine-readable code (e.g. `VALIDATION_FAILED`, `UNAUTHENTICATED`). */
  code?: string;
  /** Human-readable message — already localized by the backend. */
  message?: string;
  /** Arbitrary per-error context (e.g. zod field issues). */
  details?: unknown;
  /** Trace identifier for support / log correlation. */
  traceId?: string;
}

/**
 * Error thrown by `apiClient` for any non-2xx response.
 *
 * `code` and `details` come from the `error` envelope when present, so
 * UI code can branch on backend codes without re-parsing the body:
 *
 *   try {
 *     await apiClient.post('/auth/login', dto);
 *   } catch (err) {
 *     if (err instanceof ApiClientError && err.code === 'INVALID_CREDENTIALS') {
 *       …
 *     }
 *   }
 */
export class ApiClientError extends Error {
  public readonly statusCode: number;
  public readonly code: string | undefined;
  public readonly details: unknown;
  public readonly traceId: string | undefined;

  constructor(
    statusCode: number,
    message: string,
    code?: string | undefined,
    details?: unknown,
    traceId?: string | undefined,
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.traceId = traceId;
  }
}

/**
 * Parse a Response body into the canonical `{ message, code, details,
 * traceId }` shape. Tolerates non-JSON bodies (returned as a generic
 * "Request failed" message) and bodies without the `error` envelope
 * (legacy NestJS responses).
 */
export async function parseErrorBody(
  response: Response,
): Promise<{
  message: string;
  code?: string | undefined;
  details?: unknown;
  traceId?: string | undefined;
}> {
  const body = await response.json().catch(() => null);
  if (body && typeof body === 'object' && 'error' in body) {
    const env = (body as { error: ApiErrorEnvelope }).error ?? {};
    return {
      message: env.message ?? `Request failed with status ${response.status}`,
      ...(env.code !== undefined ? { code: env.code } : {}),
      details: env.details,
      ...(env.traceId !== undefined ? { traceId: env.traceId } : {}),
    };
  }
  if (body && typeof body === 'object' && 'message' in body) {
    const flat = body as Record<string, unknown>;
    const message =
      typeof flat.message === 'string'
        ? flat.message
        : `Request failed with status ${response.status}`;
    const code =
      typeof flat.code === 'string'
        ? flat.code
        : typeof flat.error === 'string'
          ? flat.error
          : undefined;
    return {
      message,
      ...(code !== undefined ? { code } : {}),
      details: flat.details,
    };
  }
  return { message: `Request failed with status ${response.status}` };
}

/**
 * Network / parsing errors are surfaced under a stable code so callers
 * can render a "check your connection" hint without sniffing the
 * underlying `TypeError: Network request failed`.
 */
export const NETWORK_ERROR_CODE = 'NETWORK_ERROR';

export function isNetworkError(err: unknown): boolean {
  if (err instanceof ApiClientError) return err.code === NETWORK_ERROR_CODE;
  if (err instanceof Error) {
    return /network|fetch|failed to fetch/i.test(err.message);
  }
  return false;
}
