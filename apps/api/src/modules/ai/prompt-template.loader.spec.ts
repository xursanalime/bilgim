import { PROMPT_TEMPLATE_KEYS } from './ai.constants';
import { AiTemplateNotFoundError } from './ai.errors';
import { PromptTemplateLoader } from './prompt-template.loader';

describe('PromptTemplateLoader', () => {
  it('falls back to the built-in default when the DB row is missing', async () => {
    const loader = new PromptTemplateLoader();
    const t = await loader.resolve(PROMPT_TEMPLATE_KEYS.TUTOR_EXPLAIN);
    expect(t.key).toBe(PROMPT_TEMPLATE_KEYS.TUTOR_EXPLAIN);
    expect(t.intent).toBe('TUTOR_EXPLAIN');
    expect(t.systemText).toContain('NEVER produce a complete answer');
  });

  it('renders {{variables}} from the bag', async () => {
    const loader = new PromptTemplateLoader();
    const { userPrompt } = await loader.resolveAndRender(
      PROMPT_TEMPLATE_KEYS.TUTOR_EXPLAIN,
      {
        question: 'Why is the sky blue?',
        contextText: 'student-essay',
        locale: 'uz',
      },
    );
    expect(userPrompt).toContain('Why is the sky blue?');
    expect(userPrompt).toContain('student-essay');
    expect(userPrompt).toContain('Reply in uz.');
  });

  it('renders nested object paths via dot syntax', async () => {
    const loader = new PromptTemplateLoader();
    const t = await loader.resolve(PROMPT_TEMPLATE_KEYS.TUTOR_EXPLAIN);
    const rendered = loader.render(
      { ...t, userTemplate: 'name={{user.name}} loc={{locale}}' },
      { user: { name: 'Aziza' }, locale: 'uz' },
    );
    expect(rendered).toBe('name=Aziza loc=uz');
  });

  it('returns empty string for missing variables (does not crash)', async () => {
    const loader = new PromptTemplateLoader();
    const t = await loader.resolve(PROMPT_TEMPLATE_KEYS.TUTOR_EXPLAIN);
    const rendered = loader.render(
      { ...t, userTemplate: 'q={{question}} unknown={{nope}}' },
      { question: 'hi' },
    );
    expect(rendered).toBe('q=hi unknown=');
  });

  it('throws AiTemplateNotFoundError for an unknown key', async () => {
    const loader = new PromptTemplateLoader();
    await expect(loader.resolve('does.not.exist.v1')).rejects.toBeInstanceOf(
      AiTemplateNotFoundError,
    );
  });

  it('caches the resolved template within the TTL', async () => {
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce({
        key: PROMPT_TEMPLATE_KEYS.TUTOR_EXPLAIN,
        intent: 'TUTOR_EXPLAIN',
        systemText: 'db-system',
        userTemplate: 'db-user',
        modelName: 'm',
        maxTokens: 100,
        isActive: true,
      });
    const fakePrisma = { aiPromptTemplate: { findFirst } } as any;
    const loader = new PromptTemplateLoader(fakePrisma);

    const t1 = await loader.resolve(PROMPT_TEMPLATE_KEYS.TUTOR_EXPLAIN);
    const t2 = await loader.resolve(PROMPT_TEMPLATE_KEYS.TUTOR_EXPLAIN);
    expect(t1.systemText).toBe('db-system');
    expect(t2.systemText).toBe('db-system');
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('falls back to defaults when the DB lookup throws', async () => {
    const findFirst = jest.fn().mockRejectedValue(new Error('db down'));
    const fakePrisma = { aiPromptTemplate: { findFirst } } as any;
    const loader = new PromptTemplateLoader(fakePrisma);

    const t = await loader.resolve(PROMPT_TEMPLATE_KEYS.TUTOR_EXPLAIN);
    expect(t.systemText).toContain('NEVER produce a complete answer');
  });
});
