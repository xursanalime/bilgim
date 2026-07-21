import { haversineDistanceKm } from './impossible-travel.service';

/**
 * Standalone unit tests for `haversineDistanceKm` — Task 27.3
 * (Req 27.3).
 *
 * These checks are intentionally narrow: they pin the great-circle
 * distance against well-known city pairs so a regression in the
 * formula (radius constant, radians conversion, antipode handling)
 * is caught the moment it lands. The wider symmetric / bounded
 * properties live in `impossible-travel.service.spec.ts` next to
 * the consumer.
 *
 * Reference distances pulled from openly published sources (city
 * centre coordinates, great-circle calculator). The 1% tolerance is
 * enough headroom for the haversine vs. ellipsoid mismatch and for
 * city-centre coordinate rounding, but tight enough to catch a real
 * formula bug.
 *
 * **Validates: Requirements 27.3**
 */

describe('haversineDistanceKm — known city pairs', () => {
  // Tashkent (city centre) — 41.3111° N, 69.2797° E.
  const TASHKENT = { lat: 41.3111, lon: 69.2797 };
  // Moscow — 55.7558° N, 37.6176° E.
  const MOSCOW = { lat: 55.7558, lon: 37.6176 };
  // Samarkand — 39.6542° N, 66.9597° E.
  const SAMARKAND = { lat: 39.6542, lon: 66.9597 };

  it('returns exactly 0 for identical coordinates', () => {
    expect(haversineDistanceKm(41.3111, 69.2797, 41.3111, 69.2797)).toBe(0);
    expect(haversineDistanceKm(0, 0, 0, 0)).toBe(0);
    expect(haversineDistanceKm(-90, 0, -90, 0)).toBe(0);
  });

  it('Tashkent → Moscow ≈ 2790 km (within 1% tolerance)', () => {
    const km = haversineDistanceKm(
      TASHKENT.lat,
      TASHKENT.lon,
      MOSCOW.lat,
      MOSCOW.lon,
    );
    expect(km).toBeGreaterThan(2790 * 0.99);
    expect(km).toBeLessThan(2790 * 1.01);
  });

  it('Tashkent → Samarkand ≈ 270 km (within 5% tolerance)', () => {
    // Samarkand sits within Uzbekistan, so this short-haul case
    // exercises the small-angle path of the haversine formula. The
    // tolerance is a touch wider here because the 270 km headline
    // figure rounds aggressively in published sources.
    const km = haversineDistanceKm(
      TASHKENT.lat,
      TASHKENT.lon,
      SAMARKAND.lat,
      SAMARKAND.lon,
    );
    expect(km).toBeGreaterThan(270 * 0.95);
    expect(km).toBeLessThan(280 * 1.05);
  });

  it('antipodal points ≈ 20015 km (Earth half-circumference)', () => {
    // (0, 0) → (0, 180) is a clean antipodal pair: the great-circle
    // distance is exactly half the Earth's circumference.
    const km = haversineDistanceKm(0, 0, 0, 180);
    expect(km).toBeGreaterThan(20015 * 0.99);
    expect(km).toBeLessThan(20015 * 1.01);
  });

  it('symmetric: distance(a, b) === distance(b, a)', () => {
    const ab = haversineDistanceKm(
      TASHKENT.lat,
      TASHKENT.lon,
      MOSCOW.lat,
      MOSCOW.lon,
    );
    const ba = haversineDistanceKm(
      MOSCOW.lat,
      MOSCOW.lon,
      TASHKENT.lat,
      TASHKENT.lon,
    );
    expect(Math.abs(ab - ba)).toBeLessThan(1e-9);
  });

  it('handles longitude wrap correctly across the antimeridian', () => {
    // 1° step across the antimeridian must produce roughly the same
    // distance as a 1° step inside the (-180, 180) range. Both are
    // ~111 km at the equator.
    const inside = haversineDistanceKm(0, 179, 0, -179);
    const reference = haversineDistanceKm(0, 0, 0, 2);
    expect(Math.abs(inside - reference)).toBeLessThan(1);
  });
});
