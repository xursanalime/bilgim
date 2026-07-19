import {
  TRACE_LEGACY_HEADER,
  TRACE_REQUEST_HEADER,
  applyTraceResponseHeaders,
  attachTraceIdToRequest,
  resolveTraceId,
} from './trace-context';

/**
 * Trace-context helpers (Task 24.3, Req 26.1).
 *
 * Coverage:
 *   - `resolveTraceId` honours `X-Request-Id` first, falls back to
 *     `X-Trace-Id`, then mints a fresh UUIDv4.
 *   - `applyTraceResponseHeaders` sets BOTH headers on the response,
 *     and is a no-op when `setHeader` is unavailable.
 *   - `attachTraceIdToRequest` is idempotent and stamps the request.
 */
describe('resolveTraceId', () => {
  it('returns the X-Request-Id header when present', () => {
    const id = resolveTraceId({ [TRACE_REQUEST_HEADER]: 'req-1' });
    expect(id).toBe('req-1');
  });

  it('falls back to X-Trace-Id when X-Request-Id is missing', () => {
    const id = resolveTraceId({ [TRACE_LEGACY_HEADER]: 'legacy-2' });
    expect(id).toBe('legacy-2');
  });

  it('prefers X-Request-Id over X-Trace-Id when both are present', () => {
    const id = resolveTraceId({
      [TRACE_REQUEST_HEADER]: 'req-1',
      [TRACE_LEGACY_HEADER]: 'legacy-2',
    });
    expect(id).toBe('req-1');
  });

  it('mints a fresh UUIDv4 when neither header is present', () => {
    const id = resolveTraceId({});
    // RFC 4122 UUIDv4: 8-4-4-4-12 hex with the 13th nibble = 4.
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('returns a different UUID on each call when no header is provided', () => {
    const a = resolveTraceId({});
    const b = resolveTraceId({});
    expect(a).not.toBe(b);
  });

  it('handles array-valued headers by picking the first non-empty string', () => {
    const id = resolveTraceId({
      [TRACE_REQUEST_HEADER]: ['', 'req-3', 'req-4'],
    });
    expect(id).toBe('req-3');
  });

  it('falls back through the header chain when the value is empty', () => {
    const id = resolveTraceId({
      [TRACE_REQUEST_HEADER]: '',
      [TRACE_LEGACY_HEADER]: 'legacy-5',
    });
    expect(id).toBe('legacy-5');
  });
});

describe('applyTraceResponseHeaders', () => {
  it('sets both X-Request-Id and X-Trace-Id', () => {
    const calls: Array<[string, string]> = [];
    const response = { setHeader: (name: string, value: string) => calls.push([name, value]) };
    applyTraceResponseHeaders(response, 'trace-1');
    expect(calls).toEqual([
      ['X-Request-Id', 'trace-1'],
      ['X-Trace-Id', 'trace-1'],
    ]);
  });

  it('is a no-op when the response does not expose setHeader', () => {
    expect(() => applyTraceResponseHeaders({}, 'trace-1')).not.toThrow();
    expect(() => applyTraceResponseHeaders(null, 'trace-1')).not.toThrow();
    expect(() => applyTraceResponseHeaders(undefined, 'trace-1')).not.toThrow();
  });
});

describe('attachTraceIdToRequest', () => {
  it('stamps both traceId and requestId onto the request', () => {
    const req: { headers: Record<string, unknown>; traceId?: string; requestId?: string } = {
      headers: { [TRACE_REQUEST_HEADER]: 'req-1' },
    };
    const id = attachTraceIdToRequest(req);
    expect(id).toBe('req-1');
    expect(req.traceId).toBe('req-1');
    expect(req.requestId).toBe('req-1');
  });

  it('mints a UUID when no headers are present and stamps it consistently', () => {
    const req: { headers: Record<string, unknown>; traceId?: string; requestId?: string } = {
      headers: {},
    };
    const id = attachTraceIdToRequest(req);
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(req.traceId).toBe(id);
    expect(req.requestId).toBe(id);
  });
});
