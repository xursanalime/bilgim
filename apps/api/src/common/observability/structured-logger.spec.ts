import {
  StructuredLogger,
  shouldUseJsonLogger,
} from './structured-logger';

/**
 * StructuredLogger (Task 24.3, Req 26.1).
 *
 * Coverage:
 *   - JSON mode emits one-line JSON envelopes containing the required
 *     log fields.
 *   - JSON mode preserves structured payloads (objects passed in as
 *     the message) verbatim under their original keys.
 *   - shouldUseJsonLogger respects LOG_FORMAT and falls back to
 *     NODE_ENV.
 */
describe('StructuredLogger (JSON mode)', () => {
  let writes: string[];
  let writeSpy: jest.SpyInstance;

  beforeEach(() => {
    writes = [];
    writeSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: unknown) => {
        writes.push(String(chunk));
        return true;
      });
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  function lastEnvelope(): Record<string, unknown> {
    expect(writes.length).toBeGreaterThan(0);
    return JSON.parse(writes[writes.length - 1]!.trim());
  }

  it('emits a JSON line containing level/time/service/pid/message for log()', () => {
    const logger = new StructuredLogger('Test', { jsonMode: true });
    logger.log('hello world');

    const env = lastEnvelope();
    expect(env.level).toBe('info');
    expect(env.service).toBe('edubridge-api');
    expect(env.pid).toBe(process.pid);
    expect(typeof env.time).toBe('string');
    expect(env.message).toBe('hello world');
  });

  it('preserves structured payload fields verbatim when message is an object', () => {
    const logger = new StructuredLogger('HTTP', { jsonMode: true });
    logger.log({
      message: 'Request completed',
      traceId: 't-1',
      requestId: 't-1',
      method: 'GET',
      url: '/lessons/abc',
      statusCode: 200,
      durationMs: 12,
    });

    const env = lastEnvelope();
    expect(env).toMatchObject({
      level: 'info',
      message: 'Request completed',
      traceId: 't-1',
      requestId: 't-1',
      method: 'GET',
      url: '/lessons/abc',
      statusCode: 200,
      durationMs: 12,
    });
  });

  it('records error level + stack on error()', () => {
    const logger = new StructuredLogger(undefined, { jsonMode: true });
    logger.error('boom', 'Error: boom\n  at foo');

    const env = lastEnvelope();
    expect(env.level).toBe('error');
    expect(env.message).toBe('boom');
    expect(env.stack).toContain('boom');
  });

  it('handles null / undefined / non-string messages without crashing', () => {
    const logger = new StructuredLogger(undefined, { jsonMode: true });
    expect(() => logger.log(null)).not.toThrow();
    expect(() => logger.log(undefined)).not.toThrow();
    expect(() => logger.log(123)).not.toThrow();
    expect(writes.length).toBe(3);
  });
});

describe('shouldUseJsonLogger', () => {
  it('returns true when LOG_FORMAT=json', () => {
    expect(shouldUseJsonLogger({ LOG_FORMAT: 'json' } as never)).toBe(true);
  });

  it('returns false when LOG_FORMAT=pretty', () => {
    expect(shouldUseJsonLogger({ LOG_FORMAT: 'pretty' } as never)).toBe(false);
  });

  it('returns false when LOG_FORMAT=text', () => {
    expect(shouldUseJsonLogger({ LOG_FORMAT: 'text' } as never)).toBe(false);
  });

  it('falls back to NODE_ENV=production', () => {
    expect(shouldUseJsonLogger({ NODE_ENV: 'production' } as never)).toBe(true);
  });

  it('returns false in dev / test by default', () => {
    expect(shouldUseJsonLogger({ NODE_ENV: 'development' } as never)).toBe(
      false,
    );
    expect(shouldUseJsonLogger({ NODE_ENV: 'test' } as never)).toBe(false);
    expect(shouldUseJsonLogger({} as never)).toBe(false);
  });
});
