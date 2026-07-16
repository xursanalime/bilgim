import { ConsoleLogger, LoggerService } from '@nestjs/common';

/**
 * StructuredLogger (Task 24.3, Req 26.1).
 *
 * In **production** every log call is emitted as a single-line JSON
 * record so the Loki / log-pipeline ingestor can index fields like
 * `traceId`, `userId`, `route`, `durationMs` without per-line regex
 * parsing.
 *
 * In **development / test** we delegate to NestJS's default
 * `ConsoleLogger` so the human-friendly coloured output is preserved.
 * Tests assert against logger calls (not stdout) so the behaviour is
 * stable either way.
 *
 * The structured payload merges three sources, in order:
 *   1. Top-level fields injected by `LoggingInterceptor` (e.g.
 *      `{ message, traceId, requestId, method, url, status, … }`).
 *   2. The Nest-supplied `context` (controller / service name).
 *   3. The current `level`, `pid`, and ISO `time` set by this logger.
 *
 * The output schema is intentionally narrow — adding fields is fine,
 * but renaming `traceId`, `userId`, `level`, `time`, or `message` is
 * a breaking change for the log pipeline.
 */
export class StructuredLogger
  extends ConsoleLogger
  implements LoggerService
{
  private readonly jsonMode: boolean;

  constructor(context?: string, options?: { jsonMode?: boolean }) {
    super(context ?? 'Bilgim');
    this.jsonMode =
      options?.jsonMode ??
      (process.env.NODE_ENV === 'production' ||
        process.env.LOG_FORMAT === 'json');
  }

  override log(message: unknown, context?: string): void {
    if (!this.jsonMode) return super.log(message as string, context);
    this.write('info', message, context);
  }

  override error(
    message: unknown,
    stackOrContext?: string,
    context?: string,
  ): void {
    if (!this.jsonMode) {
      return super.error(message as string, stackOrContext, context);
    }
    this.write('error', message, context, { stack: stackOrContext });
  }

  override warn(message: unknown, context?: string): void {
    if (!this.jsonMode) return super.warn(message as string, context);
    this.write('warn', message, context);
  }

  override debug(message: unknown, context?: string): void {
    if (!this.jsonMode) return super.debug?.(message as string, context);
    this.write('debug', message, context);
  }

  override verbose(message: unknown, context?: string): void {
    if (!this.jsonMode) return super.verbose?.(message as string, context);
    this.write('verbose', message, context);
  }

  /**
   * Write the structured envelope to stdout. We use `process.stdout.write`
   * directly so the JSON line is not split or re-coloured by an
   * upstream stream (e.g. when a parent process pipes through tty).
   */
  private write(
    level: string,
    message: unknown,
    context: string | undefined,
    extra?: Record<string, unknown>,
  ): void {
    const payload: Record<string, unknown> = {
      level,
      time: new Date().toISOString(),
      pid: process.pid,
      service: 'bilgim-api',
      context: context ?? this['context' as keyof this] ?? null,
      ...this.normaliseMessage(message),
      ...(extra ?? {}),
    };
    try {
      process.stdout.write(`${JSON.stringify(payload)}\n`);
    } catch (error) {
      // Last-resort fallback: if JSON.stringify chokes on a circular
      // structure, drop down to console so the log line is not lost.
      // The pipeline will index it as a generic raw line.
      // eslint-disable-next-line no-console
      console.error('StructuredLogger: failed to serialise payload', error);
    }
  }

  private normaliseMessage(message: unknown): Record<string, unknown> {
    if (message === null || message === undefined) return { message: null };
    if (typeof message === 'string') return { message };
    if (typeof message === 'object') {
      // Preserve the structured shape — `LoggingInterceptor` already
      // emits fielded objects (`{ message, traceId, ... }`).
      return message as Record<string, unknown>;
    }
    return { message: String(message) };
  }
}

/**
 * Detect whether structured JSON output should be enabled at boot.
 * Exposed so `bootstrap()` can build the logger before NestFactory.
 */
export function shouldUseJsonLogger(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.LOG_FORMAT === 'json') return true;
  if (env.LOG_FORMAT === 'pretty' || env.LOG_FORMAT === 'text') return false;
  return env.NODE_ENV === 'production';
}
