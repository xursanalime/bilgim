import * as fc from 'fast-check';
import { AiGatewayService } from './ai.gateway.service';
import { FakeAdapter } from './adapters/fake.adapter';
import { AiAuditService } from './ai-audit.service';
import { AiRateLimiterService } from './ai-rate-limiter.service';
import { PromptTemplateLoader } from './prompt-template.loader';
import { RedisService } from '../../infra/redis/redis.service';

/**
 * Property test 15 — Translation cache round-trip.
 * (Task 18.5 from .kiro/specs/bilgim-platform/tasks.md)
 *
 * This test asserts that when calling `tutorTranslate` on the same
 * input multiple times, the first call reaches the AI adapter, and
 * subsequent calls are served from the cache without querying the API.
 */

function buildAuditMock() {
  const records: any[] = [];
  const audit = {
    record: jest.fn(async (row) => {
      records.push(row);
    }),
  } as unknown as AiAuditService;
  return { audit, records };
}

function buildRedisMock() {
  const store = new Map<string, string>();
  return {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    store,
  } as unknown as jest.Mocked<RedisService> & { store: Map<string, string> };
}

describe('Property 15 — Translation cache round-trip', () => {
  it('subsequent tutorTranslate calls for the same request are served from cache without calling Claude', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 2, maxLength: 50 }),
        fc.constantFrom('uz', 'ru', 'en') as fc.Arbitrary<'uz' | 'ru' | 'en'>,
        fc.constantFrom('uz', 'ru', 'en') as fc.Arbitrary<'uz' | 'ru' | 'en'>,
        fc.string({ minLength: 2, maxLength: 200 }).filter(s => s.trim().length > 0),
        fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
        async (userId, sourceLocaleRaw, targetLocaleRaw, text, mockTranslationRaw) => {
          const mockTranslation = mockTranslationRaw.trim();
          let sourceLocale = sourceLocaleRaw;
          let targetLocale = targetLocaleRaw;
          // ensure locales differ
          if (sourceLocale === targetLocale) {
            targetLocale = sourceLocale === 'uz' ? 'en' : 'uz';
          }

          const primary = new FakeAdapter({
            providerName: 'fake-primary',
            responder: async () => ({
              text: mockTranslation,
              inputTokens: 10,
              outputTokens: 5,
              latencyMs: 10,
              modelName: 'fake-primary',
            }),
          });
          const fallback = new FakeAdapter({ providerName: 'fake-fallback' });
          const loader = new PromptTemplateLoader();
          const rateLimiter = new AiRateLimiterService(undefined as any, undefined as any);
          rateLimiter.resetForTesting();
          const { audit, records } = buildAuditMock();
          const redisMock = buildRedisMock();

          const service = new AiGatewayService(
            loader,
            rateLimiter,
            audit,
            primary,
            fallback,
            redisMock,
          );

          // First call: should hit the adapter
          const result1 = await service.tutorTranslate({
            userId,
            sourceLocale,
            targetLocale,
            text,
          });

          expect(result1.translation).toBe(mockTranslation);
          expect(result1.cached).toBe(false);
          expect(primary.callCount).toBe(1);

          // The audit record should show the primary model was used
          expect(records).toHaveLength(1);
          expect(records[0]).toMatchObject({
            userId,
            intent: 'TUTOR_TRANSLATE',
            modelName: 'fake-primary',
            status: 'OK',
          });

          // Second call: should hit the cache
          const result2 = await service.tutorTranslate({
            userId,
            sourceLocale,
            targetLocale,
            text,
          });

          expect(result2.translation).toBe(mockTranslation);
          expect(result2.cached).toBe(true);
          // Crucial assertion: the adapter was not called a second time
          expect(primary.callCount).toBe(1);

          // The audit record count remains 1 because cache hits skip auditing
          expect(records).toHaveLength(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});
