import {
  ArgumentsHost,
  BadRequestException,
  HttpStatus,
  InternalServerErrorException,
} from '@nestjs/common';

import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { NoopSentryAdapter } from './noop-sentry.adapter';
import { RealSentryAdapter } from './real-sentry.adapter';
import type { SentryAdapter } from './sentry.port';

/**
 * Sentry adapter + AllExceptionsFilter integration (Task 24.3).
 *
 *   - NoopSentryAdapter always returns ok=true and never throws.
 *   - RealSentryAdapter assigns an event id and logs a structured
 *     payload — no real network call.
 *   - AllExceptionsFilter calls captureException on 5xx but NOT on 4xx.
 */
function makeHostStub(request: Record<string, unknown> = {}): {
  host: ArgumentsHost;
  status: jest.Mock;
  json: jest.Mock;
} {
  const status = jest.fn().mockReturnThis();
  const json = jest.fn().mockReturnThis();
  const host: ArgumentsHost = {
    switchToHttp: () => ({
      getRequest: <T>() =>
        ({ traceId: 't-1', method: 'GET', url: '/x', ...request }) as unknown as T,
      getResponse: <T>() => ({ status, json }) as unknown as T,
      getNext: () => ({}) as any,
    }),
  } as any;
  return { host, status, json };
}

describe('NoopSentryAdapter', () => {
  it('returns ok=true on every captureException call', async () => {
    const adapter = new NoopSentryAdapter();
    const out = await adapter.captureException(new Error('boom'), {
      traceId: 't-1',
    });
    expect(out.ok).toBe(true);
  });
});

describe('RealSentryAdapter', () => {
  it('returns ok=true with a generated event id', async () => {
    const adapter = new RealSentryAdapter();
    const out = await adapter.captureException(new Error('boom'), {
      traceId: 't-1',
      route: '/lessons/:id',
      method: 'GET',
      statusCode: 500,
    });
    expect(out.ok).toBe(true);
    expect(out.eventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

describe('AllExceptionsFilter ↔ SentryAdapter', () => {
  it('calls SentryAdapter.captureException for 500 unhandled errors', () => {
    const sentry: SentryAdapter = {
      captureException: jest.fn().mockResolvedValue({ ok: true }),
    };
    const filter = new AllExceptionsFilter(sentry);
    // Suppress the structured error log so the test output stays clean.
    jest
      .spyOn((filter as unknown as { logger: { error: jest.Mock } }).logger, 'error')
      .mockImplementation(() => undefined);

    const { host } = makeHostStub();
    filter.catch(new Error('boom'), host);

    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        traceId: 't-1',
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      }),
    );
  });

  it('calls SentryAdapter for explicit 5xx HttpExceptions', () => {
    const sentry: SentryAdapter = {
      captureException: jest.fn().mockResolvedValue({ ok: true }),
    };
    const filter = new AllExceptionsFilter(sentry);
    const { host } = makeHostStub();

    filter.catch(new InternalServerErrorException('explicit 500'), host);

    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(sentry.captureException).toHaveBeenCalledWith(
      expect.any(InternalServerErrorException),
      expect.objectContaining({ statusCode: 500 }),
    );
  });

  it('does NOT call SentryAdapter for 4xx errors', () => {
    const sentry: SentryAdapter = {
      captureException: jest.fn().mockResolvedValue({ ok: true }),
    };
    const filter = new AllExceptionsFilter(sentry);
    const { host } = makeHostStub();

    filter.catch(new BadRequestException('invalid input'), host);

    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('survives a SentryAdapter that throws — never fails the response', () => {
    const sentry: SentryAdapter = {
      captureException: jest.fn().mockRejectedValue(new Error('sentry down')),
    };
    const filter = new AllExceptionsFilter(sentry);
    jest
      .spyOn((filter as unknown as { logger: { error: jest.Mock } }).logger, 'error')
      .mockImplementation(() => undefined);
    const warnSpy = jest
      .spyOn((filter as unknown as { logger: { warn: jest.Mock } }).logger, 'warn')
      .mockImplementation(() => undefined);

    const { host, status, json } = makeHostStub();
    expect(() => filter.catch(new Error('boom'), host)).not.toThrow();
    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalled();

    // Wait a tick so the .catch handler runs.
    return new Promise<void>((resolve) =>
      setImmediate(() => {
        expect(warnSpy).toHaveBeenCalled();
        resolve();
      }),
    );
  });
});
