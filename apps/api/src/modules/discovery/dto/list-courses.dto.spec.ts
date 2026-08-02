import {
  ListDiscoveryCoursesSchema,
  ListDiscoveryTeachersSchema,
} from './index';

/**
 * Discovery DTO validation — exercises the Zod schemas that defend the
 * public endpoints from malicious or malformed query strings.
 */
describe('ListDiscoveryCoursesSchema', () => {
  it('accepts an empty query (all filters optional)', () => {
    const result = ListDiscoveryCoursesSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('rejects a single-character q to avoid scanning every course', () => {
    const result = ListDiscoveryCoursesSchema.safeParse({ q: 'a' });
    expect(result.success).toBe(false);
  });

  it('coerces numeric query strings (?priceMin=100&pageSize=10)', () => {
    const result = ListDiscoveryCoursesSchema.safeParse({
      priceMin: '100',
      pageSize: '10',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priceMin).toBe(100);
      expect(result.data.pageSize).toBe(10);
    }
  });

  it('rejects priceMin > priceMax', () => {
    const result = ListDiscoveryCoursesSchema.safeParse({
      priceMin: 500,
      priceMax: 100,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-uuid specialtyId', () => {
    const result = ListDiscoveryCoursesSchema.safeParse({
      specialtyId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('clamps pageSize to <= 50 (no unbounded scans)', () => {
    const result = ListDiscoveryCoursesSchema.safeParse({ pageSize: 200 });
    expect(result.success).toBe(false);
  });
});

describe('ListDiscoveryTeachersSchema', () => {
  it('accepts an empty query', () => {
    expect(ListDiscoveryTeachersSchema.safeParse({}).success).toBe(true);
  });

  it('requires q to be at least 2 chars', () => {
    expect(ListDiscoveryTeachersSchema.safeParse({ q: 'x' }).success).toBe(
      false,
    );
    expect(ListDiscoveryTeachersSchema.safeParse({ q: 'xy' }).success).toBe(
      true,
    );
  });

  it('rejects pageSize=0', () => {
    expect(
      ListDiscoveryTeachersSchema.safeParse({ pageSize: 0 }).success,
    ).toBe(false);
  });
});
