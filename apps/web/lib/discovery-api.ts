/**
 * Public re-export of the Discovery API client (Task 25.5).
 *
 * The original client lives at `lib/api/discovery.ts` and is paired with
 * a server-side counterpart at `lib/server-discovery.ts`. The task
 * checklist asks for a `discovery-api.ts` entry point — this module
 * forwards both surfaces under a single import so callers don't have to
 * choose the right submodule.
 *
 * Usage:
 *
 *   // Server Components (no auth, opaque cursors):
 *   import { serverDiscovery } from '@/lib/discovery-api';
 *
 *   // Client islands (filters, search input):
 *   import { discoveryApi } from '@/lib/discovery-api';
 *
 *   // Shared types:
 *   import type {
 *     DiscoveryTeacherSummary,
 *     DiscoveryCourseSummary,
 *     CursorPage,
 *   } from '@/lib/discovery-api';
 */

export {
  discoveryApi,
  CEFR_LEVELS,
  parseCefrLevel,
  type CefrLevel,
  type DiscoverySpecialtySummary,
  type DiscoveryTeacherSummary,
  type DiscoveryCourseSummary,
  type DiscoveryGroupSummary,
  type CursorPage,
  type ListTeachersParams,
  type ListCoursesParams,
} from './api/discovery';

export { serverDiscovery, ServerDiscoveryError } from './server-discovery';
