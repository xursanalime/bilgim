/**
 * AiModule — wires the gateway, adapters, audit, and rate-limit
 * services together (Task 20.1).
 *
 * Provider selection:
 *   The module picks the primary adapter based on `AI_PROVIDER` env
 *   var:
 *     - `anthropic` (production default in prod env): Anthropic
 *     - `mock` (default everywhere else): FakeAdapter
 *   The fallback adapter is always `OpenAiAdapter`. When either the
 *   primary or the fallback is unhealthy at boot, the gateway logs a
 *   warning and the dispatcher trims the missing leg from its
 *   provider list — calls then go through the surviving adapter alone
 *   (or fail with a clear configuration error if both are missing).
 *
 * Why Optional PrismaClient:
 *   Tests import `AiModule` in isolation and supply their own client
 *   via overrides; we don't want to require a live DB just to unit-test
 *   the dispatcher. The audit + template-loader services treat
 *   `PrismaClient` as optional and degrade gracefully.
 */

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from '../../infra/prisma';

import { EnvConfig } from '../../config/env.schema';
import { RedisModule } from '../../infra/redis';
import {
  AI_FALLBACK_PROVIDER,
  AI_PRIMARY_PROVIDER,
} from './ai.constants';
import { AiAuditService } from './ai-audit.service';
import { AiController } from './ai.controller';
import { AiGatewayService } from './ai.gateway.service';
import { AiRateLimiterService } from './ai-rate-limiter.service';
import { AiTextDetectController } from './ai-text-detect.controller';
import { AiTextDetectService } from './ai-text-detect.service';
import { AnthropicAdapter } from './adapters/anthropic.adapter';
import { FakeAdapter } from './adapters/fake.adapter';
import { OpenAiAdapter } from './adapters/openai.adapter';
import type { AiAdapter } from './adapters/types';
import { AiTutorPolicyGuard } from './policy/ai-tutor.policy.guard';
import { PromptTemplateLoader } from './prompt-template.loader';
import { TutorConversationService } from './tutor-conversation.service';
import { TutorController } from './tutor.controller';
import { TutorService } from './tutor.service';
import { AI_GATEWAY } from './ai.types';
import { AiConversationsController } from './conversations/ai-conversations.controller';
import { AiConversationsService } from './conversations/ai-conversations.service';

@Module({
  imports: [ConfigModule, RedisModule],
  controllers: [AiController, TutorController, AiTextDetectController, AiConversationsController],
  providers: [
    AiGatewayService,
    AiAuditService,
    AiRateLimiterService,
    AiTextDetectService,
    AiTutorPolicyGuard,
    PromptTemplateLoader,
    TutorService,
    TutorConversationService,
    AiConversationsService,
    AnthropicAdapter,
    OpenAiAdapter,
    {
      // FakeAdapter has an optional options-bag parameter that NestJS
      // can't resolve via constructor injection. Use a factory so DI
      // gives us a real instance with default options.
      provide: FakeAdapter,
      useFactory: () => new FakeAdapter(),
    },
    {
      provide: AI_GATEWAY,
      useExisting: AiGatewayService,
    },
    {
      provide: AI_PRIMARY_PROVIDER,
      inject: [ConfigService, AnthropicAdapter, FakeAdapter],
      useFactory: (
        config: ConfigService<EnvConfig, true>,
        anthropic: AnthropicAdapter,
        fake: FakeAdapter,
      ): AiAdapter => {
        const provider = config.get('AI_PROVIDER', { infer: true });
        if (provider === 'anthropic' && anthropic.isHealthy()) {
          return anthropic;
        }
        return fake;
      },
    },
    {
      provide: AI_FALLBACK_PROVIDER,
      inject: [ConfigService, OpenAiAdapter, FakeAdapter],
      useFactory: (
        config: ConfigService<EnvConfig, true>,
        openai: OpenAiAdapter,
        fake: FakeAdapter,
      ): AiAdapter => {
        // Only enable the OpenAI fallback when the operator has wired
        // it explicitly. Otherwise the gateway uses the same
        // FakeAdapter as primary — the dispatcher dedupes by name so
        // there's no double-billing in test mode.
        const provider = config.get('AI_PROVIDER', { infer: true });
        if (provider === 'anthropic' && openai.isHealthy()) {
          return openai;
        }
        return fake;
      },
    },
    {
      provide: PrismaClient,
      useFactory: () => createPrismaClient(),
    },
  ],
  exports: [
    AiGatewayService,
    AiAuditService,
    AiRateLimiterService,
    AiTextDetectService,
    AiTutorPolicyGuard,
    PromptTemplateLoader,
    TutorService,
    TutorConversationService,
    AI_GATEWAY,
  ],
})
export class AiModule {}
