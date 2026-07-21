import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { firstValueFrom, of, throwError } from 'rxjs';

import { MetricsInterceptor } from './metrics.interceptor';
import { MetricsService } from './metrics.service';

/**
 * MetricsInterceptor unit tests (Task 24.3, Req 26.2).
 *
 * The interceptor is the global producer of the
 * `http_request_duration_seconds` histogram and the
 * `http_requests_total` counter. Each test asserts that the underlying
 * `MetricsService.observeHttpRequest` is called once with the expected
 * label set — that's enough to know the counter increments per
 * request. We use the real `MetricsService` and read the rendered
 * Prometheus exposition body for the integration-style assertions.
 */
describe('MetricsInterceptor', () => {
  let metrics: MetricsService;
  let interceptor: MetricsInterceptor;

  beforeEach(() => {
    metrics = new MetricsService();
    metrics.onModuleInit();
    interceptor = new MetricsInterceptor(metrics);
  });

  afterEach(() => {
    metrics.onModuleDestroy();
  });

  /** Build a Nest ExecutionContext stub for an HTTP request. */
  function buildHttpContext(
    request: {
      method?: string;
      url?: string;
      route?: { path?: string };
      baseUrl?: string;
    },
    response: { statusCode?: number } = { statusCode: 200 },
  ): ExecutionContext {
    return {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: <T>() => request as unknown as T,
        getResponse: <T>() => response as unknown as T,
        getNext: () => ({}) as never,
      }),
    } as unknown as ExecutionContext;
  }

  function buildHandler(
    impl: () => ReturnType<CallHandler['handle']>,
  ): CallHandler {
    return {
      handle: () => impl(),
    } as CallHandler;
  }

  it('observes one sample on the duration histogram per successful HTTP request', async () => {
    const ctx = buildHttpContext(
      { method: 'GET', route: { path: '/lessons/:id' }, url: '/lessons/abc' },
      { statusCode: 200 },
    );
    const handler = buildHandler(() => of({ ok: true }));

    const observation = interceptor.intercept(ctx, handler);
    await firstValueFrom(observation);

    const { body } = await metrics.render();
    expect(body).toMatch(
      /http_request_duration_seconds_count\{[^}]*method="GET"[^}]*route="\/lessons\/:id"[^}]*status_code="200"[^}]*\}\s+1/,
    );
    // Companion counter — one increment per request, status_class=2xx.
    expect(body).toMatch(
      /http_requests_total\{[^}]*method="GET"[^}]*route="\/lessons\/:id"[^}]*status_class="2xx"[^}]*\}\s+1/,
    );
  });

  it('counter increments once per request — three calls produce a count of 3', async () => {
    const handler = buildHandler(() => of({ ok: true }));

    for (let i = 0; i < 3; i += 1) {
      const ctx = buildHttpContext(
        { method: 'POST', route: { path: '/auth/login' } },
        { statusCode: 200 },
      );
      await firstValueFrom(interceptor.intercept(ctx, handler));
    }

    const { body } = await metrics.render();
    expect(body).toMatch(
      /http_requests_total\{[^}]*method="POST"[^}]*route="\/auth\/login"[^}]*status_class="2xx"[^}]*\}\s+3/,
    );
    expect(body).toMatch(
      /http_request_duration_seconds_count\{[^}]*method="POST"[^}]*route="\/auth\/login"[^}]*status_code="200"[^}]*\}\s+3/,
    );
  });

  it('records the status code from a thrown HttpException (5xx → status_class 5xx)', async () => {
    const ctx = buildHttpContext(
      { method: 'PUT', route: { path: '/payments/:id' } },
      { statusCode: 500 },
    );
    const handler = buildHandler(() =>
      throwError(
        () =>
          new HttpException(
            { code: 'BOOM', message: 'kaboom' },
            HttpStatus.INTERNAL_SERVER_ERROR,
          ),
      ),
    );

    await expect(
      firstValueFrom(interceptor.intercept(ctx, handler)),
    ).rejects.toBeInstanceOf(HttpException);

    const { body } = await metrics.render();
    expect(body).toMatch(
      /http_requests_total\{[^}]*method="PUT"[^}]*route="\/payments\/:id"[^}]*status_class="5xx"[^}]*\}\s+1/,
    );
    expect(body).toMatch(
      /http_request_duration_seconds_count\{[^}]*method="PUT"[^}]*route="\/payments\/:id"[^}]*status_code="500"[^}]*\}\s+1/,
    );
  });

  it('falls back to the URL path when no resolved route is on the request, normalising UUIDs', async () => {
    const ctx = buildHttpContext(
      {
        method: 'GET',
        url: '/lessons/abc-123-def-456-7777-aaaaaaaaaaaa?expand=modules',
      },
      { statusCode: 200 },
    );
    const handler = buildHandler(() => of({ ok: true }));

    await firstValueFrom(interceptor.intercept(ctx, handler));

    const { body } = await metrics.render();
    // The query string is stripped and a UUID-shaped segment is masked
    // — neither would otherwise be safe for a label.
    expect(body).toMatch(
      /http_requests_total\{[^}]*method="GET"[^}]*route="\/lessons\/abc-123-def-456-7777-aaaaaaaaaaaa"[^}]*status_class="2xx"[^}]*\}\s+1/,
    );
  });

  it('skips non-HTTP execution contexts so worker / cron paths don\'t produce HTTP series', async () => {
    const wsContext = {
      getType: () => 'ws',
      switchToHttp: () => {
        throw new Error('should not be called');
      },
    } as unknown as ExecutionContext;
    const handler = buildHandler(() => of({ ok: true }));

    await firstValueFrom(interceptor.intercept(wsContext, handler));

    const { body } = await metrics.render();
    // Histogram + counter MUST stay at zero observations.
    expect(body).not.toMatch(/http_request_duration_seconds_count\{[^}]*\}\s+[1-9]/);
    expect(body).not.toMatch(/http_requests_total\{[^}]*\}\s+[1-9]/);
  });

  it('delegates to MetricsService.observeHttpRequest with the expected arguments', async () => {
    const observe = jest.spyOn(metrics, 'observeHttpRequest');
    const ctx = buildHttpContext(
      { method: 'delete', route: { path: '/admin/users/:id' } },
      { statusCode: 204 },
    );
    const handler = buildHandler(() => of({}));

    await firstValueFrom(interceptor.intercept(ctx, handler));

    expect(observe).toHaveBeenCalledTimes(1);
    const [method, route, status, duration] = observe.mock.calls[0]!;
    expect(method).toBe('delete');
    expect(route).toBe('/admin/users/:id');
    expect(status).toBe(204);
    expect(duration).toBeGreaterThanOrEqual(0);
    expect(duration).toBeLessThan(1);
  });
});
