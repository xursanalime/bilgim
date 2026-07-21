import { CallHandler, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';

import { ErrorSanitizerInterceptor } from './error-sanitizer.interceptor';

/**
 * Unit tests for `ErrorSanitizerInterceptor` (Task 29.5, Req 30.9).
 *
 * Covers:
 *   - Stack traces stripped in production.
 *   - Internal paths stripped in production.
 *   - DB schema info stripped in production.
 *   - 5xx errors get generic message in production.
 *   - 4xx errors preserve code but sanitize message.
 *   - Development mode passes through full details.
 */

function makeConfigService(env: string): ConfigService {
  return {
    get: jest.fn((key: string) => {
      if (key === 'NODE_ENV') return env;
      return undefined;
    }),
  } as unknown as ConfigService;
}

function makeContext(): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({}),
      getResponse: () => ({}),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

function makeCallHandler(error: Error): CallHandler {
  return {
    handle: () => throwError(() => error),
  };
}

function makeSuccessHandler(): CallHandler {
  return {
    handle: () => of({ data: 'success' }),
  };
}

describe('ErrorSanitizerInterceptor — production mode', () => {
  let interceptor: ErrorSanitizerInterceptor;

  beforeEach(() => {
    interceptor = new ErrorSanitizerInterceptor(makeConfigService('production'));
  });

  it('strips stack traces from error responses', (done) => {
    const error = new HttpException(
      {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Invalid input',
          stack: 'Error: Invalid input\n    at Object.<anonymous> (/app/src/users/users.service.ts:42:11)',
        },
      },
      HttpStatus.BAD_REQUEST,
    );

    const result$ = interceptor.intercept(makeContext(), makeCallHandler(error));

    result$.subscribe({
      error: (err: HttpException) => {
        const response = err.getResponse() as any;
        expect(response.error?.stack).toBeUndefined();
        expect(response.stack).toBeUndefined();
        done();
      },
    });
  });

  it('strips internal file paths from error messages', (done) => {
    const error = new HttpException(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Error at /home/deploy/app/src/modules/auth/auth.service.ts:55',
        },
      },
      HttpStatus.BAD_REQUEST,
    );

    const result$ = interceptor.intercept(makeContext(), makeCallHandler(error));

    result$.subscribe({
      error: (err: HttpException) => {
        const response = err.getResponse() as any;
        const msg = response.error?.message ?? '';
        expect(msg).not.toContain('/home/');
        expect(msg).not.toContain('/app/src/');
        done();
      },
    });
  });

  it('strips database schema information from error messages', (done) => {
    const error = new HttpException(
      {
        error: {
          code: 'DB_ERROR',
          message: 'relation "User" does not exist. SELECT * FROM "User" WHERE id = $1',
        },
      },
      HttpStatus.BAD_REQUEST,
    );

    const result$ = interceptor.intercept(makeContext(), makeCallHandler(error));

    result$.subscribe({
      error: (err: HttpException) => {
        const response = err.getResponse() as any;
        const msg = response.error?.message ?? '';
        expect(msg).not.toContain('SELECT');
        expect(msg).not.toContain('"User"');
        done();
      },
    });
  });

  it('returns generic message for 5xx errors', (done) => {
    const error = new HttpException(
      {
        error: {
          code: 'PRISMA_ERROR',
          message: 'P2002: Unique constraint failed on table "User" column "email"',
          stack: 'at PrismaClient._request (/app/node_modules/@prisma/client/runtime/library.js:123)',
        },
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );

    const result$ = interceptor.intercept(makeContext(), makeCallHandler(error));

    result$.subscribe({
      error: (err: HttpException) => {
        const response = err.getResponse() as any;
        expect(response.error.code).toBe('INTERNAL_ERROR');
        expect(response.error.message).toBe(
          'An unexpected error occurred. Please try again later.',
        );
        expect(response.error.stack).toBeUndefined();
        expect(err.getStatus()).toBe(500);
        done();
      },
    });
  });

  it('preserves error code for 4xx errors but sanitizes message', (done) => {
    const error = new HttpException(
      {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Email is required',
        },
      },
      HttpStatus.BAD_REQUEST,
    );

    const result$ = interceptor.intercept(makeContext(), makeCallHandler(error));

    result$.subscribe({
      error: (err: HttpException) => {
        const response = err.getResponse() as any;
        expect(response.error.code).toBe('VALIDATION_FAILED');
        expect(response.error.message).toBe('Email is required');
        expect(err.getStatus()).toBe(400);
        done();
      },
    });
  });

  it('converts unknown errors to generic 500', (done) => {
    const error = new Error('Something broke internally at /home/user/project/src/main.ts');

    const result$ = interceptor.intercept(makeContext(), makeCallHandler(error));

    result$.subscribe({
      error: (err: HttpException) => {
        const response = err.getResponse() as any;
        expect(response.error.code).toBe('INTERNAL_ERROR');
        expect(response.error.message).toBe(
          'An unexpected error occurred. Please try again later.',
        );
        expect(err.getStatus()).toBe(500);
        done();
      },
    });
  });

  it('removes Prisma error codes from messages', (done) => {
    const error = new HttpException(
      {
        error: {
          code: 'CONFLICT',
          message: 'P2002 unique constraint violation on table users',
        },
      },
      HttpStatus.CONFLICT,
    );

    const result$ = interceptor.intercept(makeContext(), makeCallHandler(error));

    result$.subscribe({
      error: (err: HttpException) => {
        const response = err.getResponse() as any;
        const msg = response.error?.message ?? '';
        expect(msg).not.toContain('P2002');
        done();
      },
    });
  });

  it('does not modify successful responses', (done) => {
    const result$ = interceptor.intercept(makeContext(), makeSuccessHandler());

    result$.subscribe({
      next: (value) => {
        expect(value).toEqual({ data: 'success' });
        done();
      },
    });
  });
});

describe('ErrorSanitizerInterceptor — development mode', () => {
  let interceptor: ErrorSanitizerInterceptor;

  beforeEach(() => {
    interceptor = new ErrorSanitizerInterceptor(makeConfigService('development'));
  });

  it('passes through HttpException with full details', (done) => {
    const error = new HttpException(
      {
        error: {
          code: 'DB_ERROR',
          message: 'P2002: Unique constraint failed on "User"."email"',
          stack: 'at PrismaClient (/app/node_modules/@prisma/client/runtime.js:1)',
        },
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );

    const result$ = interceptor.intercept(makeContext(), makeCallHandler(error));

    result$.subscribe({
      error: (err: HttpException) => {
        const response = err.getResponse() as any;
        // In dev mode, the original exception is passed through
        expect(response.error.message).toContain('P2002');
        expect(err.getStatus()).toBe(500);
        done();
      },
    });
  });

  it('wraps unknown errors with stack trace in development', (done) => {
    const error = new Error('Something broke');
    error.stack = 'Error: Something broke\n    at /app/src/main.ts:10:5';

    const result$ = interceptor.intercept(makeContext(), makeCallHandler(error));

    result$.subscribe({
      error: (err: HttpException) => {
        const response = err.getResponse() as any;
        expect(response.error.message).toBe('Something broke');
        expect(response.error.stack).toContain('/app/src/main.ts');
        done();
      },
    });
  });
});

describe('ErrorSanitizerInterceptor — sanitizeMessage', () => {
  let interceptor: ErrorSanitizerInterceptor;

  beforeEach(() => {
    interceptor = new ErrorSanitizerInterceptor(makeConfigService('production'));
  });

  it('removes Windows-style paths', () => {
    const msg = 'Error at C:\\Users\\dev\\project\\src\\main.ts';
    const result = interceptor.sanitizeMessage(msg);
    expect(result).not.toContain('C:\\Users');
  });

  it('removes Linux-style paths', () => {
    const msg = 'Error at /home/ubuntu/app/src/service.ts:42';
    const result = interceptor.sanitizeMessage(msg);
    expect(result).not.toContain('/home/ubuntu');
  });

  it('removes node_modules paths', () => {
    const msg = 'Error in /node_modules/@prisma/client/runtime.js';
    const result = interceptor.sanitizeMessage(msg);
    expect(result).not.toContain('/node_modules/');
  });

  it('removes SQL statements', () => {
    const msg = 'Failed: SELECT id, email FROM "User" WHERE status = $1';
    const result = interceptor.sanitizeMessage(msg);
    expect(result).not.toContain('SELECT');
    expect(result).not.toContain('FROM');
  });

  it('removes pg_* references', () => {
    const msg = 'Error querying pg_catalog.pg_tables';
    const result = interceptor.sanitizeMessage(msg);
    expect(result).not.toContain('pg_catalog');
  });

  it('preserves safe messages unchanged', () => {
    const msg = 'Email is required';
    const result = interceptor.sanitizeMessage(msg);
    expect(result).toBe('Email is required');
  });
});
