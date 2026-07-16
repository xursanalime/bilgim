import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';

import { Public } from '../../../common/decorators/public.decorator';
import { PaymeAuthGuard } from './payme-auth.guard';
import { PaymeRequestEnvelopeSchema } from './payme.dto';
import { PAYME_ERROR_CODES, PaymeError } from './payme.errors';
import { PaymeService } from './payme.service';

/**
 * JSON-RPC 2.0 envelope returned to Payme. Either `result` xor `error`
 * is present, never both. `id` echoes the request id (or `null` if the
 * request was unparseable).
 */
interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: Record<string, unknown>;
  error?: {
    code: number;
    message: { uz: string; ru: string; en: string };
    data?: unknown;
  };
}

/**
 * PaymeController — single endpoint that hosts every Payme JSON-RPC method.
 *
 * Contract details:
 *   - Always returns HTTP 200, even on auth failure or business error
 *     (Payme requires 200; errors travel inside the response body).
 *   - Marked `@Public()` so the global JwtAuthGuard skips it; Basic Auth is
 *     enforced by `PaymeAuthGuard`.
 *   - Errors thrown by the guard or service are caught here and serialized
 *     into a JSON-RPC `error` body. We deliberately do NOT lean on the
 *     global `AllExceptionsFilter` because Payme expects the JSON-RPC
 *     envelope rather than the standard `{ error: { code, message, ... } }`
 *     shape.
 *   - The global `IdempotencyInterceptor` is intentionally not bypassed
 *     because Payme does not send an `Idempotency-Key` header — it relies
 *     on its own `paymeId`-based deduplication, which the service handles
 *     directly. The interceptor is therefore a no-op for this route.
 */
@Public()
@UseGuards(PaymeAuthGuard)
@Controller('billing/payme')
export class PaymeController {
  private readonly logger = new Logger(PaymeController.name);

  constructor(private readonly paymeService: PaymeService) {}

  /**
   * POST /billing/payme/webhook — single JSON-RPC entry point.
   * Always returns 200 OK with the JSON-RPC envelope in the body.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(@Body() body: unknown): Promise<JsonRpcResponse> {
    // Step 1: parse the JSON-RPC envelope. Failure → -32600 with id=null.
    const envelopeResult = PaymeRequestEnvelopeSchema.safeParse(body);
    if (!envelopeResult.success) {
      const err = new PaymeError(PAYME_ERROR_CODES.TRANSPORT_INVALID_REQUEST, {
        issues: envelopeResult.error.issues,
      });
      return this.buildErrorResponse(this.extractRequestId(body), err);
    }

    const envelope = envelopeResult.data;

    try {
      const result = await this.paymeService.dispatch(
        envelope.method,
        envelope.params,
      );
      return {
        jsonrpc: '2.0',
        id: envelope.id ?? null,
        result,
      };
    } catch (error) {
      if (error instanceof PaymeError) {
        return this.buildErrorResponse(envelope.id ?? null, error);
      }

      // Unexpected error — log full trace, return generic JSON-RPC error.
      // We map it to -32600 so Payme treats it as a transient failure and
      // retries; -32504 would suggest auth, which would be misleading.
      this.logger.error({
        event: 'payme.webhook.unhandled_error',
        method: envelope.method,
        message: (error as Error).message,
        stack: (error as Error).stack,
      });
      return this.buildErrorResponse(
        envelope.id ?? null,
        new PaymeError(PAYME_ERROR_CODES.TRANSPORT_INVALID_REQUEST),
      );
    }
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private buildErrorResponse(
    id: number | string | null,
    error: PaymeError,
  ): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      id,
      error: error.toJsonRpcError(),
    };
  }

  /**
   * Best-effort extraction of `id` from a malformed envelope so the error
   * response can echo it back. Falls back to `null` per JSON-RPC 2.0.
   */
  private extractRequestId(body: unknown): number | string | null {
    if (body && typeof body === 'object' && 'id' in body) {
      const id = (body as { id?: unknown }).id;
      if (
        typeof id === 'number' ||
        typeof id === 'string' ||
        id === null
      ) {
        return id;
      }
    }
    return null;
  }
}
