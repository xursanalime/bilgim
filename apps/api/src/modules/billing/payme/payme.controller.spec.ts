import { PaymeController } from './payme.controller';
import { PAYME_ERROR_CODES, PaymeError } from './payme.errors';
import { PaymeService } from './payme.service';

/**
 * PaymeController unit tests.
 *
 * Covers JSON-RPC envelope handling at the HTTP boundary:
 *   - Valid request → wraps service result in `{ jsonrpc, id, result }`.
 *   - PaymeError thrown by the service → serialized as `{ jsonrpc, id,
 *     error: { code, message, data? } }`.
 *   - Malformed request body → `-32600` with `id=null`.
 *   - Unhandled errors → `-32600` (transient) without leaking details.
 *
 * Auth concerns are exercised by `payme-auth.guard.spec.ts`; here we mount
 * the controller directly so the guard does not run.
 */
describe('PaymeController', () => {
  let controller: PaymeController;
  let service: jest.Mocked<PaymeService>;

  beforeEach(() => {
    service = {
      dispatch: jest.fn(),
    } as any;
    controller = new PaymeController(service);
  });

  it('wraps a successful dispatch in a JSON-RPC result envelope', async () => {
    service.dispatch.mockResolvedValue({ allow: true });

    const response = await controller.webhook({
      jsonrpc: '2.0',
      id: 42,
      method: 'CheckPerformTransaction',
      params: {
        amount: 1000,
        account: { invoiceId: '00000000-0000-0000-0000-000000000001' },
      },
    });

    expect(response).toEqual({
      jsonrpc: '2.0',
      id: 42,
      result: { allow: true },
    });
    expect(service.dispatch).toHaveBeenCalledWith(
      'CheckPerformTransaction',
      expect.any(Object),
    );
  });

  it('serializes a PaymeError thrown by the service into a JSON-RPC error envelope', async () => {
    service.dispatch.mockRejectedValue(
      new PaymeError(PAYME_ERROR_CODES.TRANSACTION_NOT_FOUND),
    );

    const response = await controller.webhook({
      jsonrpc: '2.0',
      id: 'req-1',
      method: 'CheckTransaction',
      params: { id: 'missing' },
    });

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-1',
      error: {
        code: PAYME_ERROR_CODES.TRANSACTION_NOT_FOUND,
        message: expect.objectContaining({ uz: expect.any(String) }),
      },
    });
    expect((response as any).result).toBeUndefined();
  });

  it('returns -32600 with id=null when the body fails envelope validation', async () => {
    // missing `method` field — not a valid JSON-RPC envelope
    const response = await controller.webhook({ id: 7 });

    expect(response).toEqual({
      jsonrpc: '2.0',
      id: 7,
      error: expect.objectContaining({
        code: PAYME_ERROR_CODES.TRANSPORT_INVALID_REQUEST,
      }),
    });
    expect(service.dispatch).not.toHaveBeenCalled();
  });

  it('falls back to id=null when the malformed body lacks an id field', async () => {
    const response = await controller.webhook(null);

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: null,
      error: expect.objectContaining({
        code: PAYME_ERROR_CODES.TRANSPORT_INVALID_REQUEST,
      }),
    });
  });

  it('catches unexpected (non-PaymeError) exceptions as -32600 without leaking details', async () => {
    service.dispatch.mockRejectedValue(
      new Error('database disk full — internal detail'),
    );

    const response = await controller.webhook({
      jsonrpc: '2.0',
      id: 99,
      method: 'PerformTransaction',
      params: { id: 'tx-1' },
    });

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 99,
      error: expect.objectContaining({
        code: PAYME_ERROR_CODES.TRANSPORT_INVALID_REQUEST,
      }),
    });
    // The internal error message must not appear in the response.
    expect(JSON.stringify(response)).not.toContain('database disk full');
  });

  it('echoes a string id and accepts an envelope without the optional jsonrpc field', async () => {
    service.dispatch.mockResolvedValue({ ok: true });

    const response = await controller.webhook({
      id: 'rpc-string-id',
      method: 'ChangePassword',
      params: {},
    });

    expect(response).toEqual({
      jsonrpc: '2.0',
      id: 'rpc-string-id',
      result: { ok: true },
    });
  });
});
