'use client';

/**
 * Module runner: WRITING (Task 25.4, Req 12.1, 23.1, 23.2, 23.4).
 *
 * Thin re-export of the canonical implementation under
 * `module-runtimes/writing-runtime.tsx`. The submission editor
 * imports the runner from this file because the spec lists it as
 * `module-runner-writing.tsx`; keeping the underlying component in
 * one place avoids divergence.
 */

export {
  WritingRuntime as ModuleRunnerWriting,
  type WritingRuntimeAnswer as ModuleRunnerWritingAnswer,
  type WritingRuntimeConfig as ModuleRunnerWritingConfig,
} from './module-runtimes/writing-runtime';
