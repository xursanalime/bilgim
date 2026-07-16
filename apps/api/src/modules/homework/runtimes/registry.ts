import { Injectable } from '@nestjs/common';
import { HomeworkModuleType } from '@prisma/client';

import { readingRuntime } from './reading.runtime';
import { HomeworkModuleRuntime } from './types';
import { writingRuntime } from './writing.runtime';

/**
 * HomeworkModuleRuntimeRegistry — central lookup table for every
 * registered HomeworkModuleType runtime (Task 18.3).
 *
 * Module types without a registered runtime return `null` from `get()`.
 * The AssignmentService and SubmissionService treat that as
 * "validate as opaque JSON for forward-compat" — new module types can
 * be plumbed end-to-end (catalog → toggle → assignment builder → student
 * submission) without blocking on a runtime, and the runtime can be
 * added in a follow-up task. This is the same pattern other Phase 6
 * services use to avoid hard-coupling the assignment table to the
 * runtime layer.
 *
 * The registry is provided as a Nest singleton so unit tests can mock
 * it and the AI grading worker (Task 18.2 follow-up) can resolve the
 * right runtime by module type.
 */
@Injectable()
export class HomeworkModuleRuntimeRegistry {
  private readonly runtimes = new Map<
    HomeworkModuleType,
    HomeworkModuleRuntime
  >();

  constructor() {
    // Built-in runtimes — register here as new tasks land them. The
    // map is intentionally small; adding a new runtime is a single
    // line + a constructor call here.
    this.register(writingRuntime);
    this.register(readingRuntime);
  }

  /**
   * Register (or overwrite) a runtime for its declared `type`. Useful in
   * tests when callers want to swap in a stub.
   */
  register(runtime: HomeworkModuleRuntime): void {
    this.runtimes.set(runtime.type, runtime);
  }

  /**
   * Resolve a runtime by HomeworkModuleType. Returns `null` for module
   * types that have not been wired yet — callers MUST treat that as
   * "no shape validation" and accept the JSON as opaque.
   */
  get(type: HomeworkModuleType): HomeworkModuleRuntime | null {
    return this.runtimes.get(type) ?? null;
  }

  /**
   * `true` when a runtime is registered for the given type. Convenience
   * predicate for readability at call sites.
   */
  has(type: HomeworkModuleType): boolean {
    return this.runtimes.has(type);
  }

  /** All registered HomeworkModuleType values. Mostly for diagnostics. */
  registeredTypes(): HomeworkModuleType[] {
    return Array.from(this.runtimes.keys());
  }
}
