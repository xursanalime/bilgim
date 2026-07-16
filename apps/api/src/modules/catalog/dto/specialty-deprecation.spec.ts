import {
  CreateCourseSchema,
  UpdateCourseSchema,
} from './create-course.dto';
import { CreateGroupSchema, UpdateGroupSchema } from './create-group.dto';

/**
 * Req 2.3 — `specialtyId` deprecation shim (Task 6.3).
 *
 * The generic Specialty abstraction is being retired (Bilgim is English-only).
 * Endpoints that previously accepted a `specialtyId` must keep accepting the
 * request during the deprecation window while IGNORING the value. These tests
 * assert the request-DTO boundary:
 *
 *   1. A request WITH `specialtyId` parses successfully (accepted).
 *   2. A request WITHOUT `specialtyId` parses successfully (never required).
 *   3. A lenient (non-UUID) `specialtyId` is still accepted (no validation
 *      error) so a legacy client is never broken.
 *
 * "Ignored server-side" (the value never drives a Specialty write/requirement)
 * is asserted separately in `catalog.service.spec.ts`.
 */
describe('specialtyId deprecation shim (Req 2.3)', () => {
  const SPECIALTY_ID = '11111111-1111-1111-1111-111111111111';

  describe('CreateCourseSchema', () => {
    it('accepts a request that includes a deprecated specialtyId', () => {
      const result = CreateCourseSchema.safeParse({
        title: 'IELTS Writing',
        specialtyId: SPECIALTY_ID,
      });
      expect(result.success).toBe(true);
    });

    it('accepts a request that omits specialtyId (never required)', () => {
      const result = CreateCourseSchema.safeParse({ title: 'IELTS Writing' });
      expect(result.success).toBe(true);
    });

    it('accepts a non-UUID specialtyId leniently (does not break legacy clients)', () => {
      const result = CreateCourseSchema.safeParse({
        title: 'IELTS Writing',
        specialtyId: 'legacy-marketing-slug',
      });
      expect(result.success).toBe(true);
    });

    it('accepts a null specialtyId', () => {
      const result = CreateCourseSchema.safeParse({
        title: 'IELTS Writing',
        specialtyId: null,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('UpdateCourseSchema', () => {
    it('accepts an update that includes a deprecated specialtyId', () => {
      const result = UpdateCourseSchema.safeParse({
        title: 'New title',
        specialtyId: SPECIALTY_ID,
      });
      expect(result.success).toBe(true);
    });

    it('accepts an update that omits specialtyId', () => {
      const result = UpdateCourseSchema.safeParse({ title: 'New title' });
      expect(result.success).toBe(true);
    });
  });

  describe('CreateGroupSchema', () => {
    it('accepts a request that includes a deprecated specialtyId', () => {
      const result = CreateGroupSchema.safeParse({
        name: 'Morning group',
        priceUzs: 0,
        specialtyId: SPECIALTY_ID,
      });
      expect(result.success).toBe(true);
    });

    it('accepts a request that omits specialtyId (never required)', () => {
      const result = CreateGroupSchema.safeParse({
        name: 'Morning group',
        priceUzs: 0,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('UpdateGroupSchema', () => {
    it('accepts an update that includes a deprecated specialtyId', () => {
      const result = UpdateGroupSchema.safeParse({
        name: 'Evening group',
        specialtyId: SPECIALTY_ID,
      });
      expect(result.success).toBe(true);
    });

    it('accepts an update that omits specialtyId', () => {
      const result = UpdateGroupSchema.safeParse({ name: 'Evening group' });
      expect(result.success).toBe(true);
    });
  });
});
