import { HomeworkModuleType } from '@prisma/client';

import { readingRuntime, ReadingRuntime } from './reading.runtime';
import { HomeworkModuleRuntimeRegistry } from './registry';
import { HomeworkModuleRuntime } from './types';
import { writingRuntime, WritingRuntime } from './writing.runtime';

/**
 * Unit tests for HomeworkModuleRuntimeRegistry — Tasks 18.3, 18.4.
 *
 * Coverage:
 *   - Registers the built-in WritingRuntime + ReadingRuntime on
 *     construction.
 *   - `get` returns the right runtime for WRITING and READING.
 *   - `get` returns null for module types without a registered runtime
 *     (forward-compat opaque-JSON path).
 *   - `register` overwrites an existing runtime (used in tests for
 *     stub injection).
 *   - `has` and `registeredTypes` agree with the runtime map.
 */
describe('HomeworkModuleRuntimeRegistry', () => {
  it('registers WritingRuntime under WRITING by default', () => {
    const registry = new HomeworkModuleRuntimeRegistry();
    const runtime = registry.get('WRITING' as HomeworkModuleType);
    expect(runtime).toBe(writingRuntime);
    expect(runtime).toBeInstanceOf(WritingRuntime);
  });

  it('registers ReadingRuntime under READING by default (Task 18.4)', () => {
    const registry = new HomeworkModuleRuntimeRegistry();
    const runtime = registry.get('READING' as HomeworkModuleType);
    expect(runtime).toBe(readingRuntime);
    expect(runtime).toBeInstanceOf(ReadingRuntime);
  });

  it('returns null for module types that have no runtime registered', () => {
    const registry = new HomeworkModuleRuntimeRegistry();
    // GRAMMAR has no runtime in Phase 6 yet.
    expect(registry.get('GRAMMAR' as HomeworkModuleType)).toBeNull();
    expect(registry.has('GRAMMAR' as HomeworkModuleType)).toBe(false);
  });

  it('lists all registered HomeworkModuleType values', () => {
    const registry = new HomeworkModuleRuntimeRegistry();
    const types = registry.registeredTypes();
    expect(types).toEqual(
      expect.arrayContaining([
        'WRITING' as HomeworkModuleType,
        'READING' as HomeworkModuleType,
      ]),
    );
  });

  it('register() overwrites an existing runtime', () => {
    const registry = new HomeworkModuleRuntimeRegistry();
    const stub: HomeworkModuleRuntime = {
      type: 'READING' as HomeworkModuleType,
      validateConfig: () => ({} as unknown as never),
      validateAnswer: () => ({} as unknown as never),
      aiPromptInputs: () => ({
        moduleType: 'READING' as HomeworkModuleType,
        studentText: '',
        rubric: [],
        metadata: {},
      }),
    };
    registry.register(stub);
    expect(registry.get('READING' as HomeworkModuleType)).toBe(stub);
  });
});
