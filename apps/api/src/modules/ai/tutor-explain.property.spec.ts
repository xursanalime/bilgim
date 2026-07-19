import * as fc from 'fast-check';
import { AiGatewayService } from './ai.gateway.service';
import { FakeAdapter } from './adapters/fake.adapter';
import { AiAuditService } from './ai-audit.service';
import { AiRateLimiterService } from './ai-rate-limiter.service';
import { PromptTemplateLoader } from './prompt-template.loader';
import { cosineSimilarity } from './policy/similarity';

// A local re-implementation of the underlying longestCommonSubstring
// so we can test the explicit ratio LCS / |finalAnswer| as required by Task 20.4
function getLCS(a: string, b: string): number {
  if (!a || !b) return 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  let curr = new Array<number>(b.length + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = (prev[j - 1] ?? 0) + 1;
        if ((curr[j] ?? 0) > best) best = curr[j] ?? 0;
      } else {
        curr[j] = 0;
      }
    }
    const temp = prev;
    prev = curr;
    curr = temp;
    curr.fill(0);
  }
  return best;
}

function buildAuditMock() {
  return {
    record: jest.fn(async () => {}),
  } as unknown as AiAuditService;
}

describe('Property 4: AI tutor never produces complete answer', () => {
  it('rewritten outputs always meet similarity < 0.7 and lcs/|finalAnswer| < 0.5', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 10, maxLength: 1000 }),
        fc.string({ minLength: 10, maxLength: 1000 }),
        async (mockAiResponse, mockSubmission) => {
          const primary = new FakeAdapter({
            providerName: 'fake-primary',
            responder: async () => ({
              text: mockAiResponse,
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
          const audit = buildAuditMock();

          const service = new AiGatewayService(
            loader,
            rateLimiter,
            audit,
            primary,
            fallback,
            undefined, // No redis needed
          );

          const result = await service.tutorExplain({
            userId: 'user1',
            question: 'explain',
            submissionText: mockSubmission,
            locale: 'en',
          });

          // Compute exact metrics on the returned reply against the mockSubmission
          const finalAnswer = result.reply;
          const similarity = cosineSimilarity(finalAnswer, mockSubmission);
          
          const lcs = getLCS(finalAnswer, mockSubmission);
          const ratio = finalAnswer.length === 0 ? 0 : lcs / finalAnswer.length;

          // Property assertions
          expect(similarity).toBeLessThan(0.7);
          expect(ratio).toBeLessThan(0.5);
        },
      ),
      { numRuns: 100 },
    );
  });
});
