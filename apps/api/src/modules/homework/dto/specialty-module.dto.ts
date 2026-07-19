import { z } from 'zod';

/**
 * The full enum of `HomeworkModuleType` values, mirrored from
 * `packages/db/prisma/schema.prisma`. Spelled out here so a Zod schema
 * change is a single-file edit (no runtime coupling to the Prisma client).
 *
 * If a future migration adds a new variant, this list must be kept in sync —
 * the homework service has a unit test that asserts the array length matches
 * Prisma's enum so the drift is caught immediately.
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

export type HomeworkModuleTypeLiteral = z.infer<typeof HomeworkModuleTypeSchema>;

/**
 * Body schema for `PUT /admin/specialties/:id/modules` — bulk upsert of the
 * specialty catalog (Req 11.1, 11.7).
 *
 * The admin sends the desired state for each module type they want to write.
 * Modules not present in `modules` keep their existing row state — this is
 * a partial / sparse update, not a full replacement.
 *
 * `defaultEnabled` is optional on update so an admin can flip `isActive`
 * without touching the seed default; when absent on a fresh insert the row
 * is created with `defaultEnabled = false`.
 *
 * The hard cap of 10 active rows per specialty is enforced at two layers
 * (service-layer guard before write + DB constraint trigger). Submitting
 * more than 10 entries with `isActive=true` is fine at the schema level —
 * the cap check fires in the service and produces a 409 error mapped from
 * `SPECIALTY_MODULE_CAP_EXCEEDED`.
 */
export const BulkUpsertSpecialtyModulesSchema = z.object({
  modules: z
    .array(
      z.object({
        moduleType: HomeworkModuleTypeSchema,
        isActive: z.boolean(),
        defaultEnabled: z.boolean().optional(),
      }),
    )
    // Cap the array length defensively so a malicious payload cannot
    // force the server to walk through every enum value plus garbage.
    // 22 enum values × 1 row each = 22 entries max in the worst case.
    .max(22),
});

export type BulkUpsertSpecialtyModulesDto = z.infer<
  typeof BulkUpsertSpecialtyModulesSchema
>;

/**
 * Query schema for `GET /homework/available-modules` (teacher-facing).
 *
 * Phase 6 / Task 17.1: returns the caller's own specialty catalog when no
 * `groupId` is provided. Task 17.2 will extend this endpoint to accept a
 * `groupId` and return only the modules currently enabled for that group.
 *
 * Both query params are optional today; admin/staff callers may pass an
 * explicit `specialtyId` to inspect a different specialty (RBAC is
 * enforced at the controller level).
 */
export const ListAvailableModulesQuerySchema = z.object({
  groupId: z.string().uuid().optional(),
  specialtyId: z.string().uuid().optional(),
});

export type ListAvailableModulesQueryDto = z.infer<
  typeof ListAvailableModulesQuerySchema
>;
