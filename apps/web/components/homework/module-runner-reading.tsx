'use client';

/**
 * Module runner: READING (Task 25.4, Req 11.5, 22.1).
 *
 * Thin re-export of the canonical implementation under
 * `module-runtimes/reading-runtime.tsx`. See module-runner-writing.tsx
 * for the rationale behind the wrapper file.
 */

export {
  ReadingRuntime as ModuleRunnerReading,
  type ReadingQuestion as ModuleRunnerReadingQuestion,
  type ReadingRuntimeAnswer as ModuleRunnerReadingAnswer,
  type ReadingRuntimeConfig as ModuleRunnerReadingConfig,
} from './module-runtimes/reading-runtime';
