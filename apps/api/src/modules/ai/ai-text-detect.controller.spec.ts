/**
 * Unit tests for AiTextDetectController (Task 20.3).
 *
 * The controller is intentionally thin — every behaviour we care about
 * (cache, threshold, gateway dispatch) lives in `AiTextDetectService`.
 * These tests verify the wiring contract:
 *   - the `userId` is forwarded from the JWT,
 *   - the response shape matches the spec
 *     (`{ likelihood, signals }`, NOT `flagged`).
 */

import { AiTextDetectController } from './ai-text-detect.controller';
import { AiTextDetectService } from './ai-text-detect.service';

function buildJwtPayload(role: 'TEACHER' | 'ADMIN' = 'TEACHER') {
  return {
    sub: 'user-1',
    role,
    email: 'test@example.com',
    sessionId: 'session-1',
  } as any;
}

function buildServiceStub(): jest.Mocked<AiTextDetectService> {
  return {
    detect: jest.fn(),
  } as unknown as jest.Mocked<AiTextDetectService>;
}

describe('AiTextDetectController.detect', () => {
  it('forwards the request to AiTextDetectService and returns { likelihood, signals }', async () => {
    const service = buildServiceStub();
    service.detect.mockResolvedValue({
      likelihood: 0.78,
      signals: ['perplexity-low', 'classifier-high'],
      flagged: true,
      threshold: 0.7,
      cached: false,
    });
    const controller = new AiTextDetectController(service);

    const result = await controller.detect(buildJwtPayload(), {
      text: 'A long suspicious essay about AI.',
    });

    expect(service.detect).toHaveBeenCalledWith({
      userId: 'user-1',
      text: 'A long suspicious essay about AI.',
    });
    expect(result).toEqual({
      likelihood: 0.78,
      signals: ['perplexity-low', 'classifier-high'],
    });
  });

  it('does NOT expose the `flagged` boolean in the response', async () => {
    const service = buildServiceStub();
    service.detect.mockResolvedValue({
      likelihood: 0.95,
      signals: ['signal-a'],
      flagged: true,
      threshold: 0.7,
      cached: true,
    });
    const controller = new AiTextDetectController(service);

    const result = (await controller.detect(buildJwtPayload(), {
      text: 'sample',
    })) as Record<string, unknown>;

    expect(result.flagged).toBeUndefined();
    expect(result.cached).toBeUndefined();
    expect(result.threshold).toBeUndefined();
  });

  it('still works for ADMIN callers', async () => {
    const service = buildServiceStub();
    service.detect.mockResolvedValue({
      likelihood: 0.1,
      signals: [],
      flagged: false,
      threshold: 0.7,
      cached: false,
    });
    const controller = new AiTextDetectController(service);

    const result = await controller.detect(buildJwtPayload('ADMIN'), {
      text: 'some text',
    });

    expect(result.likelihood).toBeCloseTo(0.1);
  });

  it('propagates service errors so global filters can surface them', async () => {
    const service = buildServiceStub();
    service.detect.mockRejectedValue(new Error('rate-limited'));
    const controller = new AiTextDetectController(service);

    await expect(
      controller.detect(buildJwtPayload(), { text: 'x' }),
    ).rejects.toThrow(/rate-limited/);
  });
});
