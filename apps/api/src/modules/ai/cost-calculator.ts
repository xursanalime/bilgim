/**
 * Cost calculator — converts adapter token usage into a USD value the
 * gateway writes to `AiCall.costUsd` (Req 13.4).
 *
 * The calculator is intentionally pure (no DI, no env reads): the
 * gateway constructs it once from the static pricing map. Operators
 * tweak prices by editing `MODEL_PRICING_USD_PER_1K`.
 *
 * Pricing units: `MODEL_PRICING_USD_PER_1K` stores USD per 1000 tokens
 * for input and output respectively. We therefore divide each side by
 * 1000 before summing.
 */

import {
  DEFAULT_PRICING,
  MODEL_PRICING_USD_PER_1K,
} from './ai.constants';

export interface UsageInput {
  modelName: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Compute USD cost for a single completion. Returns 0 for any
 * non-positive token count so the audit path never writes negative
 * values, even on adapter bugs.
 */
export function computeCostUsd(input: UsageInput): number {
  const pricing =
    MODEL_PRICING_USD_PER_1K[input.modelName] ?? DEFAULT_PRICING;
  const inputCost = (Math.max(0, input.inputTokens) / 1000) * pricing.input;
  const outputCost =
    (Math.max(0, input.outputTokens) / 1000) * pricing.output;
  // Round to 6 decimal places to match the Decimal(10,6) column.
  return roundTo6(inputCost + outputCost);
}

function roundTo6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
