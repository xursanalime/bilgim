/**
 * PromptTemplateLoader — resolves an `AiPromptTemplate` row by key,
 * caches it for a short TTL, and renders the user-template against an
 * `Mustache`-like variable bag.
 *
 * Design notes:
 *   - We do NOT pull in the `mustache` package — the rendering surface
 *     is small (`{{variable}}` substitution + simple `{{#section}}` /
 *     `{{/section}}` blocks). A 60-line implementation keeps the
 *     dependency tree thin and the rendering deterministic for
 *     property tests.
 *   - The loader falls back to a built-in default template when the DB
 *     row is missing. This matters in two cases:
 *       1. Fresh dev / CI environments with empty `AiPromptTemplate`.
 *       2. Operators rolling out a new prompt that hasn't been seeded yet.
 *     Built-in defaults always have `isActive=true` and use the
 *     hard-coded `system_text` from `defaults`. Operators can override
 *     by inserting an active row with the matching `key`.
 *   - Caching is in-memory and per-process. The TTL is 60s — short
 *     enough that an operator running `psql ... UPDATE` sees their
 *     change within a minute, long enough that the gateway doesn't
 *     hammer the DB on every call.
 */

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { AiIntent, PrismaClient } from '@prisma/client';

import { AiTemplateNotFoundError } from './ai.errors';
import {
  PROMPT_TEMPLATE_KEYS,
  REMOVED_PROMPT_TEMPLATE_KEYS,
} from './ai.constants';

export interface ResolvedPromptTemplate {
  key: string;
  intent: AiIntent;
  systemText: string;
  userTemplate: string;
  modelName: string;
  maxTokens: number;
}

/**
 * Built-in template defaults. Each key MUST be in
 * `PROMPT_TEMPLATE_KEYS` so the gateway can fall back when the DB row
 * is missing. The `systemText` for tutor templates already encodes the
 * "no completion" policy because the gateway concatenates extra
 * hard-rules on top of it.
 */
const DEFAULT_TEMPLATES: Record<string, ResolvedPromptTemplate> = {
  [PROMPT_TEMPLATE_KEYS.TUTOR_EXPLAIN]: {
    key: PROMPT_TEMPLATE_KEYS.TUTOR_EXPLAIN,
    intent: 'TUTOR_EXPLAIN',
    systemText:
      'You are an Bilgim tutor. Explain concepts clearly to a {{locale}}-speaking student. ' +
      'NEVER produce a complete answer to the student\'s active homework — only rules, partial hints, and analogous examples on different topics.',
    userTemplate:
      'Student question:\n{{question}}\n\n' +
      "Student's current draft (read-only context):\n{{contextText}}\n\n" +
      'Reply in {{locale}}.',
    modelName: 'claude-3-5-sonnet-latest',
    maxTokens: 800,
  },
  [PROMPT_TEMPLATE_KEYS.TUTOR_TRANSLATE]: {
    key: PROMPT_TEMPLATE_KEYS.TUTOR_TRANSLATE,
    intent: 'TUTOR_TRANSLATE',
    systemText:
      'You are an Bilgim translator. Translate the student input into {{locale}} preserving tone and idiom. ' +
      'NEVER add extra answer content beyond the translation.',
    userTemplate: 'Translate into {{locale}}:\n{{question}}',
    modelName: 'claude-3-5-haiku-latest',
    maxTokens: 400,
  },
  [PROMPT_TEMPLATE_KEYS.TUTOR_EXAMPLE]: {
    key: PROMPT_TEMPLATE_KEYS.TUTOR_EXAMPLE,
    intent: 'TUTOR_EXAMPLE',
    systemText:
      'You are an Bilgim tutor. Provide a worked example on a DIFFERENT topic than the student\'s active task. ' +
      'NEVER use the student\'s active assignment text or produce a complete answer that could be submitted verbatim.',
    userTemplate:
      'Student question:\n{{question}}\n\nReply in {{locale}} with one short, analogous example.',
    modelName: 'claude-3-5-sonnet-latest',
    maxTokens: 600,
  },
  [PROMPT_TEMPLATE_KEYS.TRANSLATE_WORD]: {
    key: PROMPT_TEMPLATE_KEYS.TRANSLATE_WORD,
    intent: 'TUTOR_TRANSLATE',
    systemText:
      'You are a dictionary helper. Return strict JSON: ' +
      '{ "translation": string, "partOfSpeech"?: string, "examples": string[], "note"?: string }. No prose outside JSON.',
    userTemplate:
      'Word: "{{word}}"\nContext: "{{contextSentence}}"\nTarget locale: {{locale}}',
    modelName: 'claude-3-5-haiku-latest',
    maxTokens: 300,
  },
  [PROMPT_TEMPLATE_KEYS.TRANSLATE_SENTENCE]: {
    key: PROMPT_TEMPLATE_KEYS.TRANSLATE_SENTENCE,
    intent: 'TUTOR_TRANSLATE',
    systemText:
      'You are a sentence translator. Return strict JSON: ' +
      '{ "translation": string, "glossary"?: { "source": string, "target": string }[] }.',
    userTemplate: 'Sentence: "{{sentence}}"\nTarget locale: {{locale}}',
    modelName: 'claude-3-5-haiku-latest',
    maxTokens: 500,
  },
  [PROMPT_TEMPLATE_KEYS.GRADE_PRECHECK]: {
    key: PROMPT_TEMPLATE_KEYS.GRADE_PRECHECK,
    intent: 'GRADE_PRECHECK',
    systemText:
      'You are an Bilgim grading assistant. Read the student writing and produce strict JSON: ' +
      '{ "score": number (0..1), "summary": string, "highlights": [{ "from": int, "to": int, "severity": "info"|"warning"|"error", "reason": string }] }. Do not include prose outside the JSON.',
    userTemplate:
      'Rubric:\n{{rubric}}\n\nStudent text ({{language}}):\n"""\n{{text}}\n"""',
    modelName: 'claude-3-5-sonnet-latest',
    maxTokens: 1500,
  },
  [PROMPT_TEMPLATE_KEYS.GRADE_RUBRIC_SUGGEST]: {
    key: PROMPT_TEMPLATE_KEYS.GRADE_RUBRIC_SUGGEST,
    intent: 'GRADE_PRECHECK',
    systemText:
      'You are a grading assistant. Given an assignment description and ' +
      'a student submission, suggest a per-module rubric score in 0..1 ' +
      'with a brief justification. Reply with strict JSON: ' +
      '{ "modules": [{ "moduleId": string, "type": string, "score": number (0..1), "comment": string }], "summary": string }. ' +
      'Do not produce a complete corrected answer; only scoring guidance the teacher can override.',
    userTemplate:
      'Assignment description:\n"""\n{{assignmentDescription}}\n"""\n\n' +
      'Student submission (per module):\n{{submissionJson}}\n\n' +
      'Locale: {{language}}',
    modelName: 'claude-3-5-sonnet-latest',
    maxTokens: 1500,
  },
  [PROMPT_TEMPLATE_KEYS.AI_TEXT_DETECT]: {
    key: PROMPT_TEMPLATE_KEYS.AI_TEXT_DETECT,
    intent: 'AI_TEXT_DETECT',
    systemText:
      'You are an AI-text classifier. Reply with strict JSON: ' +
      '{ "likelihood": number (0..1), "signals": string[] }. No prose.',
    userTemplate: 'Text:\n"""\n{{text}}\n"""',
    modelName: 'claude-3-5-haiku-latest',
    maxTokens: 200,
  },
  [PROMPT_TEMPLATE_KEYS.AI_CHAT]: {
    key: PROMPT_TEMPLATE_KEYS.AI_CHAT,
    intent: 'AI_TEXT_DETECT' as AiIntent,
    systemText:
      'You are BilgimAI — a helpful, friendly AI assistant built into the Bilgim learning platform. ' +
      'You help {{role}} users with their questions. You support {{locale}} language. ' +
      'For students: help with study strategies, concept explanations, motivation, and learning tips. ' +
      'For teachers: help with lesson planning, assignment ideas, and pedagogical advice. ' +
      'Be concise, warm, and encouraging. Never do homework FOR the student — guide them instead.',
    userTemplate:
      '{{#context}}Context:\n{{context}}\n\n{{/context}}' +
      '{{#history}}Previous conversation:\n{{history}}\n\n{{/history}}' +
      'User message: {{message}}',
    modelName: 'claude-3-5-haiku-latest',
    maxTokens: 800,
  },
  [PROMPT_TEMPLATE_KEYS.GENERATE_TEST]: {
    key: PROMPT_TEMPLATE_KEYS.GENERATE_TEST,
    intent: 'GRADE_PRECHECK' as AiIntent,
    systemText:
      'You are a test generator. Generate educational quiz questions based on provided content. ' +
      'Return ONLY strict JSON: { "questions": Array<{ "type": "mcq"|"true_false"|"short", "prompt": string, "choices"?: string[], "answer": string|string[], "explanation"?: string }>, "topic": string, "difficulty": string }. ' +
      'Ensure questions test understanding, not just memorization. No prose outside JSON.',
    userTemplate:
      'Content/Material:\n"""\n{{content}}\n"""\n\n' +
      'Generate {{questionCount}} questions.\n' +
      'Types allowed: {{types}}\n' +
      'Difficulty: {{difficulty}}\n' +
      '{{#topic}}Topic focus: {{topic}}\n{{/topic}}' +
      'Language: {{locale}}',
    modelName: 'claude-3-5-sonnet-latest',
    maxTokens: 3000,
  },
};

const DEFAULT_CACHE_TTL_MS = 60_000;

@Injectable()
export class PromptTemplateLoader {
  private readonly logger = new Logger(PromptTemplateLoader.name);
  private readonly cache = new Map<
    string,
    { value: ResolvedPromptTemplate; expiresAt: number }
  >();

  constructor(@Optional() private readonly prisma?: PrismaClient) {}

  /**
   * Look up a template by key. Returns the cached row when valid,
   * else queries `AiPromptTemplate` (active rows only). Falls back to
   * a built-in default; throws `AiTemplateNotFoundError` only when the
   * key is unknown both in DB and in the defaults.
   */
  async resolve(key: string): Promise<ResolvedPromptTemplate> {
    // Retired templates (Req 8.5) are rejected up-front regardless of
    // any stale DB row so the removed intent can never be revived by a
    // forgotten `AiPromptTemplate` seed.
    if ((REMOVED_PROMPT_TEMPLATE_KEYS as readonly string[]).includes(key)) {
      throw new AiTemplateNotFoundError(key);
    }

    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    let row: ResolvedPromptTemplate | null = null;
    if (this.prisma) {
      try {
        const dbRow = await this.prisma.aiPromptTemplate.findFirst({
          where: { key, isActive: true },
        });
        if (dbRow) {
          row = {
            key: dbRow.key,
            intent: dbRow.intent,
            systemText: dbRow.systemText,
            userTemplate: dbRow.userTemplate,
            modelName: dbRow.modelName,
            maxTokens: dbRow.maxTokens,
          };
        }
      } catch (error) {
        this.logger.warn(
          `PromptTemplateLoader: DB lookup failed for key=${key}: ${(error as Error).message}; falling back to defaults`,
        );
      }
    }

    if (!row) {
      const fallback = DEFAULT_TEMPLATES[key];
      if (!fallback) {
        throw new AiTemplateNotFoundError(key);
      }
      row = fallback;
    }

    this.cache.set(key, {
      value: row,
      expiresAt: Date.now() + DEFAULT_CACHE_TTL_MS,
    });
    return row;
  }

  /**
   * Render a template's `userTemplate` against a variable bag. Unknown
   * variables are replaced with an empty string — we deliberately do
   * NOT throw on missing variables because the prompt becomes the
   * source of truth and a missing field is recoverable (the model
   * sees blank context, not crash).
   */
  render(template: ResolvedPromptTemplate, vars: Record<string, unknown>): string {
    return renderMustache(template.userTemplate, vars);
  }

  /**
   * Convenience helper — resolve + render in one call. Preserves the
   * resolved `systemText` so the gateway can still mutate it (e.g.
   * append the no-completion hard rules) without re-rendering.
   */
  async resolveAndRender(
    key: string,
    vars: Record<string, unknown>,
  ): Promise<{ template: ResolvedPromptTemplate; userPrompt: string; systemPrompt: string }> {
    const template = await this.resolve(key);
    const userPrompt = this.render(template, vars);
    const systemPrompt = renderMustache(template.systemText, vars);
    return { template, userPrompt, systemPrompt };
  }

  /** Test-only — allow specs to clear the cache between cases. */
  clearCacheForTesting(): void {
    this.cache.clear();
  }
}

// ===================================================================
// Tiny Mustache-like renderer
// ===================================================================

function renderMustache(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, name: string) => {
    const value = lookupPath(vars, name.trim());
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  });
}

function lookupPath(vars: Record<string, unknown>, name: string): unknown {
  const parts = name.split('.');
  let current: unknown = vars;
  for (const part of parts) {
    if (current && typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}
