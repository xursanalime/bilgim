/**
 * Public surface of the AI module — what other modules and the
 * top-level `AppModule` import. Keep the export list narrow: the
 * gateway is the only piece other contexts should depend on.
 */

export { AiModule } from './ai.module';
export { AiGatewayService } from './ai.gateway.service';
export { AiAuditService } from './ai-audit.service';
export { AiRateLimiterService } from './ai-rate-limiter.service';
export {
  AiTextDetectService,
  type AiTextDetectInput as AiTextDetectServiceInput,
  type AiTextDetectResult,
} from './ai-text-detect.service';
export { PromptTemplateLoader } from './prompt-template.loader';
export { TutorService } from './tutor.service';
export type {
  TutorServiceExplainInput,
  TutorServiceTranslateInput,
  TutorServiceExampleInput,
} from './tutor.service';
export { TutorController } from './tutor.controller';
export { AiTextDetectController } from './ai-text-detect.controller';
export {
  AI_GATEWAY,
} from './ai.types';
export type {
  AiGateway,
  TutorInput,
  TutorOutput,
  TutorIntent,
  TranslateWordInput,
  TranslateWordOutput,
  TranslateSentenceInput,
  TranslateSentenceOutput,
  PrecheckInput,
  PrecheckOutput,
  AiTextDetectInput,
  AiTextDetectOutput,
  SpecialtyClassifyInput,
  SpecialtyClassifyOutput,
  SuggestRubricInput,
  SuggestRubricOutput,
  SuggestedRubricEntry,
  RubricSubmissionModule,
  AiCallAuditRow,
} from './ai.types';
export {
  AI_CALL_STATUS,
  AI_FALLBACK_PROVIDER,
  AI_PRIMARY_PROVIDER,
  AI_LIKELIHOOD_FLAG_THRESHOLD,
  AI_LIKELIHOOD_REQ_138_THRESHOLD,
  PROMPT_TEMPLATE_KEYS,
  TUTOR_SIMILARITY_THRESHOLD,
} from './ai.constants';
export type {
  AiCallStatus,
  PromptTemplateKey,
} from './ai.constants';
export {
  AiRateLimitedError,
  AiTemplateNotFoundError,
  AiUpstreamError,
  TutorRefusedAnswerError,
} from './ai.errors';
export {
  AnthropicAdapter,
  type AnthropicAdapter as AnthropicAdapterType,
} from './adapters/anthropic.adapter';
export { OpenAiAdapter } from './adapters/openai.adapter';
export { FakeAdapter } from './adapters/fake.adapter';
export type {
  FakeAdapterOptions,
} from './adapters/fake.adapter';
export type {
  AiAdapter,
  AiAdapterRequest,
  AiAdapterResponse,
} from './adapters/types';
export {
  cosineSimilarity,
  longestCommonSubstringRatio,
  tokenize,
  termFrequency,
} from './policy/similarity';
export { computeCostUsd } from './cost-calculator';
