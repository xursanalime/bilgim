import { z } from 'zod';

/**
 * The full enum of `HomeworkModuleType` values, mirrored from
 * `packages/db/prisma/schema.prisma`. Spelled out here so a Zod schema
 * change is a single-file edit (no runtime coupling to the Prisma client).
 *
 * Mirrors `HomeworkModuleTypeSchema` exported from the homework module DTO,
 * intentionally duplicated to keep the catalog module's request validation
 * decoupled from the homework bounded context.
 */
export const HomeworkModuleTypeSchema = z.enum([
  // Language-learning modules
  'WRITING',
  'READING',
  'LISTENING',
  'GRAMMAR',
  'SPELLING',
  'VOCABULARY',
  'SPEAKING',
  'PRONUNCIATION',
  // Generic interactive question types
  'MULTIPLE_CHOICE',
  'GAP_FILL',
  'MATCHING',
  'DRAG_DROP',
  // Project / case-based modules
  'PROJECT_SUBMISSION',
  'CASE_STUDY',
  'MARKETING_COPY',
  'AUDIENCE_ANALYSIS',
  'CONTENT_CALENDAR',
  // Math modules
  'MATH_WORD_PROBLEM',
  'MATH_EQUATION_SOLVER',
  'MATH_GEOMETRY_PROOF',
  // Code modules
  'CODE_REVIEW',
  'CODE_UNIT_TEST',
]);

export type HomeworkModuleTypeLiteral = z.infer<
  typeof HomeworkModuleTypeSchema
>;

/**
 * Body schema for `PATCH /catalog/groups/:groupId/modules/:moduleType` —
 * single-toggle endpoint (Task 17.2, Req 11.3).
 *
 * The `moduleType` is taken from the URL path; the body only carries the
 * desired `isEnabled` state. The service additionally validates that the
 * `moduleType` is in the group's specialty catalog (Req 11.6) and that the
 * per-Group active cap of 10 is respected.
 */
export const ToggleGroupModuleBodySchema = z.object({
  isEnabled: z.boolean(),
});

export type ToggleGroupModuleBodyDto = z.infer<
  typeof ToggleGroupModuleBodySchema
>;

/**
 * Body schema for `PUT /catalog/groups/:groupId/modules` — bulk upsert.
 *
 * The admin sends the desired state for each module type they want to write.
 * Modules not present in `modules` keep their existing row state — sparse
 * partial update, not a full replacement. The service rejects any
 * `moduleType` not in the group's specialty catalog with
 * `MODULE_NOT_IN_SPECIALTY_CATALOG`.
 */
export const BulkUpsertGroupModulesSchema = z.object({
  modules: z
    .array(
      z.object({
        moduleType: HomeworkModuleTypeSchema,
        isEnabled: z.boolean(),
      }),
    )
    // Cap the array length defensively so a malicious payload cannot force
    // the server to walk through every enum value plus garbage. 22 enum
    // values × 1 row each = 22 entries max in the worst case.
    .max(22),
});

export type BulkUpsertGroupModulesDto = z.infer<
  typeof BulkUpsertGroupModulesSchema
>;
