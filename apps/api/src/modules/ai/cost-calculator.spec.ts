import { computeCostUsd } from './cost-calculator';

describe('computeCostUsd', () => {
  it('returns the per-1k pricing for a known model', () => {
    const cost = computeCostUsd({
      modelName: 'claude-3-5-sonnet-latest',
      inputTokens: 1000,
      outputTokens: 1000,
    });
    // 1k * 0.003 + 1k * 0.015 = 0.018
    expect(cost).toBeCloseTo(0.018, 6);
  });

  it('falls back to a conservative default for unknown models', () => {
    const cost = computeCostUsd({
      modelName: 'unknown-model-9000',
      inputTokens: 1000,
      outputTokens: 1000,
    });
    // 0.005 + 0.02
    expect(cost).toBeCloseTo(0.025, 6);
  });

  it('clamps negative token counts to zero', () => {
    const cost = computeCostUsd({
      modelName: 'gpt-4o-mini',
      inputTokens: -100,
      outputTokens: -50,
    });
    expect(cost).toBe(0);
  });

  it('returns zero for the fake providers used in tests', () => {
    expect(
      computeCostUsd({
        modelName: 'fake-primary',
        inputTokens: 5000,
        outputTokens: 5000,
      }),
    ).toBe(0);
  });

  it('rounds to 6 decimal places to fit the Decimal(10,6) column', () => {
    const cost = computeCostUsd({
      modelName: 'gpt-4o-mini',
      inputTokens: 1234,
      outputTokens: 5678,
    });
    // 1234 * 0.00015 / 1000 + 5678 * 0.0006 / 1000
    // = 0.0001851 + 0.0034068 = 0.0035919
    expect(cost).toBeCloseTo(0.003592, 6);
    // Verify the fractional precision matches what Prisma will accept.
    expect(Number.isFinite(cost)).toBe(true);
    expect(cost.toString().split('.')[1]?.length ?? 0).toBeLessThanOrEqual(6);
  });
});
