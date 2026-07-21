import {
  CallHandler,
  ConflictException,
  ExecutionContext,
} from '@nestjs/common';
import * as fc from 'fast-check';
import { lastValueFrom, of } from 'rxjs';

import { IdempotencyInterceptor } from './idempotency.interceptor';

/**
 * Property 14 — Idempotency-Key produces same response
 * (Task 9.3 from .kiro/specs/edubridge-platform/tasks.md)
 *
 * Spec (design.md):
 *   ∀ request r with Idempotency-Key k:
 *     response(r, k, attempt=1) = response(r, k, attempt=N)        — Req 19.1
 *     ∧ sideEffects(r, k, attempt=1) = sideEffects(r, k, attempt=N) — Req 18.6
 *   ∀ request r' with the same k but a different payload:
 *     response = 409 IDEMPOTENCY_CONFLICT                           — Req 19.2
 *
 * fast-check generates random valid mutating requests scoped to
 * (userId, method, path, key, payload), replays each one N times
 * (3 ≤ N ≤ 10), and asserts:
 *
 *   • the cached response (status + body) is byte-identical on every replay
 *   • the underlying handler runs exactly once (no duplicate side effects)
 *   • a follow-up request with the SAME key but a DIFFERENT payload
 *     surfaces a 409 IDEMPOTENCY_CONFLICT
 *
 * Validates: Requirements 19.1, 19.2, 19.3
 */

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

type FakeRequest = {
  method: string;
  url: string;
  originalUrl: string;
  headers: Record<string, string | undefined>;
  body: unknown;
  user?: { sub?: string };
};

type FakeResponse = {
  statusCode: number;
  headers: Record<string, string>;
  setHeader: (name: string, value: string) => void;
  status: (code: number) => FakeResponse;
};

function makeResponse(initialStatus: number): FakeResponse {
  const res: FakeResponse = {
    statusCode: initialStatus,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
  };
  return res;
}

function makeContext(request: FakeRequest, response: FakeResponse): ExecutionContext {
  return {
    getType: () => 'http' as any,
    switchToHttp: () => ({
      getRequest: <T>() => request as unknown as T,
      getResponse: <T>() => response as unknown as T,
      getNext: () => ({}) as any,
    }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as any;
}

function makeNext(handler: () => any): CallHandler {
  return { handle: () => handler() } as CallHandler;
}

/**
 * In-memory Redis double whose `get`/`set` mirror the production
 * `RedisService` surface used by the interceptor.
 */
function makeFakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string): Promise<string | null> {
      return store.get(key) ?? null;
    },
    async set(key: string, value: string, _ttlSeconds?: number): Promise<void> {
      store.set(key, value);
    },
  };
}

/**
 * In-memory IdempotencyRecord double exposing the subset of Prisma the
 * interceptor uses (`upsert` / `deleteMany`).
 */
function makeFakePrisma() {
  const rows = new Map<string, any>();
  return {
    rows,
    idempotencyRecord: {
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const existing = rows.get(where.key);
        if (existing) {
          rows.set(where.key, { ...existing, ...update });
        } else {
          rows.set(where.key, { key: where.key, ...create });
        }
        return rows.get(where.key);
      }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const methodArb = fc.constantFrom('POST', 'PUT', 'PATCH', 'DELETE');

const pathArb = fc.constantFrom(
  '/api/v1/payments',
  '/api/v1/enrollments',
  '/api/v1/users',
  '/api/v1/notifications',
  '/api/v1/billing/checkout',
);

const userIdArb = fc.constantFrom('user-1', 'user-2', 'user-3');

/**
 * Idempotency-Key matching the interceptor's `^[A-Za-z0-9_-]{8,128}$`
 * validation. We generate UUID-shaped strings so shrinking still produces
 * accepted keys.
 */
const idempotencyKeyArb = fc
  .uuid({ version: 4 })
  .map((u) => u.replace(/-/g, '_').slice(0, 32))
  .filter((s) => s.length >= 8);

/** JSON-safe payload values — keeps the stableStringify hash deterministic. */
const jsonValueArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.string({ maxLength: 16 }),
  fc.integer({ min: -1000, max: 1000 }),
  fc.boolean(),
  fc.constant(null),
);

const payloadArb: fc.Arbitrary<Record<string, unknown>> = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 8 }),
  jsonValueArb,
  { maxKeys: 4 },
);

/** Two payloads that are guaranteed to produce different SHA-256 hashes. */
const distinctPayloadPairArb = fc
  .tuple(payloadArb, payloadArb)
  .filter(([a, b]) => JSON.stringify(sortKeys(a)) !== JSON.stringify(sortKeys(b)));

function sortKeys(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.keys(obj)
    .sort()
    .reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = obj[k];
      return acc;
    }, {});
}

const scenarioArb = fc.record({
  method: methodArb,
  path: pathArb,
  userId: userIdArb,
  key: idempotencyKeyArb,
  // Number of duplicate replays of the FIRST request. 3..10 per task brief.
  replays: fc.integer({ min: 3, max: 10 }),
  payloads: distinctPayloadPairArb,
  // Status code the handler returns on the original (non-cached) call.
  initialStatus: fc.constantFrom(200, 201, 202),
  // Response body the handler returns on the original call.
  responseBody: fc.record({
    id: fc.string({ minLength: 1, maxLength: 8 }),
    ok: fc.boolean(),
    nested: fc.option(
      fc.record({
        count: fc.integer({ min: 0, max: 100 }),
        tag: fc.string({ maxLength: 8 }),
      }),
    ),
  }),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildRequest(
  scenario: { method: string; path: string; userId: string; key: string },
  body: unknown,
): FakeRequest {
  return {
    method: scenario.method,
    url: scenario.path,
    originalUrl: scenario.path,
    headers: { 'idempotency-key': scenario.key },
    body,
    user: { sub: scenario.userId },
  };
}

async function runOnce(
  interceptor: IdempotencyInterceptor,
  request: FakeRequest,
  initialStatus: number,
  handler: () => any,
): Promise<{ status: number; body: unknown; headers: Record<string, string> }> {
  const response = makeResponse(initialStatus);
  const obs$ = (await interceptor.intercept(
    makeContext(request, response),
    makeNext(handler),
  )) as any;
  const body = await lastValueFrom(obs$);
  return { status: response.statusCode, body, headers: response.headers };
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('IdempotencyInterceptor — Property 14: Idempotency-Key produces same response', () => {
  it(
    'N replays of (user, method, path, key, payload) return identical responses and run the handler once; ' +
      'a different payload with the same key → 409 IDEMPOTENCY_CONFLICT ' +
      '[Validates: Requirements 19.1, 19.2, 19.3]',
    async () => {
      await fc.assert(
        fc.asyncProperty(scenarioArb, async (scenario) => {
          const redis = makeFakeRedis();
          const prisma = makeFakePrisma();
          const interceptor = new IdempotencyInterceptor(
            redis as any,
            prisma as any,
          );

          const [originalPayload, conflictPayload] = scenario.payloads;
          const request = buildRequest(scenario, originalPayload);

          // Track every time the underlying handler executes — this lets us
          // assert "no duplicate side effects" (Req 19.3).
          let handlerCalls = 0;
          const handler = () => {
            handlerCalls += 1;
            return of(scenario.responseBody);
          };

          // ---- attempt #1: cache miss ---------------------------------
          const first = await runOnce(
            interceptor,
            request,
            scenario.initialStatus,
            handler,
          );

          if (handlerCalls !== 1) {
            throw new Error(
              `Expected handler to run once on first attempt, ran ${handlerCalls}x`,
            );
          }
          if (first.headers['X-Idempotency-Key-Status'] !== 'miss') {
            throw new Error(
              `Expected 'miss' header on first attempt, got '${first.headers['X-Idempotency-Key-Status']}'`,
            );
          }
          if (JSON.stringify(first.body) !== JSON.stringify(scenario.responseBody)) {
            throw new Error(
              `First-attempt body mismatch: ${JSON.stringify(first.body)} vs ${JSON.stringify(scenario.responseBody)}`,
            );
          }
          if (first.status !== scenario.initialStatus) {
            throw new Error(
              `First-attempt status mismatch: ${first.status} vs ${scenario.initialStatus}`,
            );
          }

          // ---- attempts #2..N: cache hits -----------------------------
          for (let attempt = 2; attempt <= scenario.replays; attempt += 1) {
            // Use a different fresh handler that would BLOW UP if it ran —
            // proves the cached path bypasses the underlying handler.
            const exploding = () => {
              handlerCalls += 1;
              throw new Error('handler must not run on cache hit');
            };
            // The interceptor is allowed to set its own status code on
            // replays, so seed the response with a deliberately-different
            // initial code (500) to confirm the cached statusCode wins.
            const replay = await runOnce(
              interceptor,
              request,
              500,
              exploding,
            );

            if (replay.headers['X-Idempotency-Key-Status'] !== 'hit') {
              throw new Error(
                `Attempt ${attempt}: expected 'hit' header, got '${replay.headers['X-Idempotency-Key-Status']}'`,
              );
            }
            if (replay.status !== first.status) {
              throw new Error(
                `Attempt ${attempt}: status drifted ${replay.status} vs ${first.status}`,
              );
            }
            if (JSON.stringify(replay.body) !== JSON.stringify(first.body)) {
              throw new Error(
                `Attempt ${attempt}: body drifted ${JSON.stringify(replay.body)} vs ${JSON.stringify(first.body)}`,
              );
            }
          }

          // No additional handler invocations across replays.
          if (handlerCalls !== 1) {
            throw new Error(
              `Side-effect leak: handler ran ${handlerCalls}x across ${scenario.replays} replays (expected 1)`,
            );
          }

          // Persistence side-effects must also be exactly-once: one Redis
          // entry, one IdempotencyRecord row.
          if (redis.store.size !== 1) {
            throw new Error(
              `Expected 1 Redis cache entry, got ${redis.store.size}`,
            );
          }
          if (prisma.rows.size !== 1) {
            throw new Error(
              `Expected 1 IdempotencyRecord row, got ${prisma.rows.size}`,
            );
          }

          // ---- conflict: same key, different payload (Req 19.2) -------
          const conflictRequest = buildRequest(scenario, conflictPayload);
          const conflictResponse = makeResponse(scenario.initialStatus);
          let thrown: unknown;
          try {
            const obs$ = (await interceptor.intercept(
              makeContext(conflictRequest, conflictResponse),
              makeNext(() => {
                handlerCalls += 1;
                return of({ should: 'not-run' });
              }),
            )) as any;
            await lastValueFrom(obs$);
          } catch (err) {
            thrown = err;
          }

          if (!(thrown instanceof ConflictException)) {
            throw new Error(
              `Expected ConflictException for differing payload, got ${
                thrown === undefined ? 'no error' : String(thrown)
              }`,
            );
          }
          const conflictBody = (thrown as ConflictException).getResponse() as {
            code?: string;
          };
          if (conflictBody?.code !== 'IDEMPOTENCY_CONFLICT') {
            throw new Error(
              `Expected code IDEMPOTENCY_CONFLICT, got ${conflictBody?.code}`,
            );
          }
          if (handlerCalls !== 1) {
            throw new Error(
              `Conflict path must not run the handler — total runs ${handlerCalls}`,
            );
          }
          if (
            conflictResponse.headers['X-Idempotency-Key-Status'] !== 'conflict'
          ) {
            throw new Error(
              `Expected 'conflict' header on payload mismatch, got '${conflictResponse.headers['X-Idempotency-Key-Status']}'`,
            );
          }
        }),
        { numRuns: 100 },
      );
    },
  );
});
