import { z } from 'zod';

/**
 * Zod schemas for Payme JSON-RPC envelope and method-specific params.
 *
 * Payme JSON-RPC 2.0 envelope:
 *   { jsonrpc?: "2.0", id: number|string|null, method: string, params: object }
 *
 * Note: Payme historically omits the `jsonrpc` field in some flows, so we
 * accept it as optional rather than rejecting on missing.
 */

/** JSON-RPC 2.0 id field — number, string, or null. */
const JsonRpcId = z.union([z.number(), z.string(), z.null()]);

export const PaymeMethodEnum = z.enum([
  'CheckPerformTransaction',
  'CreateTransaction',
  'PerformTransaction',
  'CancelTransaction',
  'CheckTransaction',
  'GetStatement',
  'ChangePassword',
]);
export type PaymeMethod = z.infer<typeof PaymeMethodEnum>;

/**
 * Top-level envelope. We do NOT validate `params` shape here — each method
 * handler validates its own params with a method-specific schema.
 */
export const PaymeRequestEnvelopeSchema = z.object({
  jsonrpc: z.literal('2.0').optional(),
  id: JsonRpcId.optional().default(null),
  method: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional().default({}),
});
export type PaymeRequestEnvelope = z.infer<typeof PaymeRequestEnvelopeSchema>;

// ---------------------------------------------------------------
// Per-method params (Payme's documented shapes)
// ---------------------------------------------------------------

/**
 * `account` is a free-form object whose shape is defined by the merchant —
 * EduBridge uses `{ invoiceId: uuid }` (see design.md §"Payment + Enrollment
 * atomicity"). We validate the shape here so downstream code can rely on it.
 */
export const PaymeAccountSchema = z.object({
  invoiceId: z.string().uuid(),
});
export type PaymeAccount = z.infer<typeof PaymeAccountSchema>;

/** CheckPerformTransaction — no transaction id yet, just amount + account. */
export const CheckPerformTransactionParamsSchema = z.object({
  amount: z.number().int().nonnegative(),
  account: PaymeAccountSchema,
});

/** CreateTransaction — first time the Payme tx id is seen. */
export const CreateTransactionParamsSchema = z.object({
  id: z.string().min(1),
  time: z.number().int().nonnegative(),
  amount: z.number().int().nonnegative(),
  account: PaymeAccountSchema,
});

/** PerformTransaction — confirm a previously created tx. */
export const PerformTransactionParamsSchema = z.object({
  id: z.string().min(1),
});

/**
 * CancelTransaction — `reason` is a Payme-defined integer code (1=customer,
 * 2=merchant, etc). We accept any non-negative integer.
 */
export const CancelTransactionParamsSchema = z.object({
  id: z.string().min(1),
  reason: z.number().int().nonnegative(),
});

/** CheckTransaction — read-only state lookup. */
export const CheckTransactionParamsSchema = z.object({
  id: z.string().min(1),
});

/**
 * GetStatement — date range in ms since epoch. `from` / `to` are inclusive
 * upper bounds in Payme's convention.
 */
export const GetStatementParamsSchema = z.object({
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
});
