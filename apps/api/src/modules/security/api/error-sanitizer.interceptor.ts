import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

/**
 * Patterns that indicate internal information leakage.
 * These are stripped from error responses in production (Req 30.9).
 */
const INTERNAL_PATH_PATTERNS = [
  /\/home\/\w+/gi,
  /\/usr\/\w+/gi,
  /\/var\/\w+/gi,
  /\/opt\/\w+/gi,
  /\/app\/\w+/gi,
  /\/src\/\w+/gi,
  /\/node_modules\//gi,
  /[A-Z]:\\[\w\\]+/gi, // Windows paths
  /\/dist\/\w+/gi,
];

const STACK_TRACE_PATTERNS = [
  /at\s+\S+\s+\(.*:\d+:\d+\)/g,
  /at\s+.*:\d+:\d+/g,
  /^\s+at\s+/gm,
];

const DB_SCHEMA_PATTERNS = [
  /\b(SELECT|INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b[^]*?\b(FROM|INTO|TABLE|SET)\b[^;]*/gi,
  /\b(pg_\w+|information_schema)\b/gi,
  /\btable\s+"?\w+"?\."?\w+"?/gi,
  /\bcolumn\s+"?\w+"?/gi,
  /\brelation\s+"?\w+"?\s+does\s+not\s+exist/gi,
  /\bprisma\b.*\berror\b/gi,
  /\bP\d{4}\b/g, // Prisma error codes like P2002
  /"\w+"\s+WHERE\b[^;]*/gi, // table references with WHERE clause
];

/**
 * Sanitized error response shape (Req 25.6 + Req 30.9).
 */
export interface SanitizedErrorResponse {
  error: {
    code: string;
    message: string;
    traceId?: string;
    details?: unknown;
  };
}

/**
 * `ErrorSanitizerInterceptor` — strips sensitive information from
 * error responses in production (Task 29.5, Req 30.9).
 *
 * In production mode:
 *   - Removes stack traces from error responses.
 *   - Removes internal file paths (e.g. /home/user/app/src/...).
 *   - Removes database schema information (table names, column names, SQL).
 *   - Replaces detailed error messages with generic ones for 5xx errors.
 *   - Preserves error codes and traceIds for debugging.
 *
 * In development mode:
 *   - Passes through full error details for debugging convenience.
 */
@Injectable()
export class ErrorSanitizerInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ErrorSanitizerInterceptor.name);
  private readonly isProduction: boolean;

  constructor(private readonly config: ConfigService) {
    const env = this.config.get<string>('NODE_ENV') ?? process.env.NODE_ENV;
    this.isProduction = env === 'production';
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((error) => {
        const sanitized = this.sanitizeError(error);
        return throwError(() => sanitized);
      }),
    );
  }

  /**
   * Sanitize an error for safe external exposure.
   */
  private sanitizeError(error: unknown): HttpException {
    if (!this.isProduction) {
      // In development, pass through as-is
      if (error instanceof HttpException) return error;
      return new HttpException(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
          },
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // Production mode: sanitize everything
    if (error instanceof HttpException) {
      return this.sanitizeHttpException(error);
    }

    // Unknown errors become generic 500s
    this.logger.error(
      'Unhandled error (sanitized for response)',
      error instanceof Error ? error.stack : String(error),
    );

    return new HttpException(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred. Please try again later.',
        },
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  /**
   * Sanitize an HttpException response body.
   */
  private sanitizeHttpException(exception: HttpException): HttpException {
    const status = exception.getResponse();
    const statusCode = exception.getStatus();

    // For 5xx errors, always return generic message
    if (statusCode >= 500) {
      this.logger.error(
        'Server error (sanitized for response)',
        exception.stack,
      );
      return new HttpException(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred. Please try again later.',
          },
        },
        statusCode,
      );
    }

    // For 4xx errors, sanitize the response body but keep the code
    if (typeof status === 'string') {
      return new HttpException(
        {
          error: {
            code: this.extractErrorCode(status),
            message: this.sanitizeMessage(status),
          },
        },
        statusCode,
      );
    }

    if (typeof status === 'object' && status !== null) {
      const sanitized = this.sanitizeObject(status) as Record<string, unknown>;
      return new HttpException(sanitized, statusCode);
    }

    return exception;
  }

  /**
   * Recursively sanitize an object, removing sensitive fields
   * and cleaning string values.
   */
  sanitizeObject(obj: unknown): unknown {
    if (obj === null || obj === undefined) return obj;

    if (typeof obj === 'string') {
      return this.sanitizeMessage(obj);
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.sanitizeObject(item));
    }

    if (typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        // Remove sensitive fields entirely
        if (this.isSensitiveField(key)) continue;
        result[key] = this.sanitizeObject(value);
      }
      return result;
    }

    return obj;
  }

  /**
   * Check if a field name indicates sensitive internal information.
   */
  private isSensitiveField(key: string): boolean {
    const sensitiveFields = [
      'stack',
      'stackTrace',
      'stack_trace',
      'internalPath',
      'internal_path',
      'query',
      'sql',
      'sqlMessage',
      'sqlState',
      'meta', // Prisma meta often contains internal details
    ];
    return sensitiveFields.includes(key.toLowerCase());
  }

  /**
   * Sanitize a string message by removing internal paths,
   * stack traces, and DB schema information.
   */
  sanitizeMessage(message: string): string {
    let sanitized = message;

    // Remove stack traces
    for (const pattern of STACK_TRACE_PATTERNS) {
      sanitized = sanitized.replace(pattern, '');
    }

    // Remove internal paths
    for (const pattern of INTERNAL_PATH_PATTERNS) {
      sanitized = sanitized.replace(pattern, '[redacted]');
    }

    // Remove DB schema information
    for (const pattern of DB_SCHEMA_PATTERNS) {
      sanitized = sanitized.replace(pattern, '[redacted]');
    }

    // Clean up multiple whitespace/newlines left after redaction
    sanitized = sanitized.replace(/\n\s*\n/g, '\n').trim();

    return sanitized;
  }

  /**
   * Extract a machine-readable error code from a message string.
   */
  private extractErrorCode(message: string): string {
    // Try to find an existing code pattern
    const codeMatch = message.match(/^[A-Z][A-Z_]+$/);
    if (codeMatch) return codeMatch[0]!;
    return 'REQUEST_ERROR';
  }
}
