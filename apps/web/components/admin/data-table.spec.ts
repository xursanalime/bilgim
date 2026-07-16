import {
  compareValues,
  filterRows,
  paginate,
  sortRows,
} from './data-table';

interface Row {
  id: string;
  name: string;
  score: number | null;
}

const ROWS: Row[] = [
  { id: '1', name: 'Charlie', score: 30 },
  { id: '2', name: 'alice', score: 10 },
  { id: '3', name: 'Bob', score: null },
  { id: '4', name: 'Dave', score: 20 },
];

describe('compareValues', () => {
  it('orders numbers numerically', () => {
    expect(compareValues(2, 10)).toBeLessThan(0);
    expect(compareValues(10, 2)).toBeGreaterThan(0);
    expect(compareValues(5, 5)).toBe(0);
  });

  it('orders strings case-insensitively and numerically aware', () => {
    expect(compareValues('alice', 'Bob')).toBeLessThan(0);
    expect(compareValues('item2', 'item10')).toBeLessThan(0);
  });

  it('treats null / undefined / empty string as last', () => {
    expect(compareValues(null, 5)).toBeGreaterThan(0);
    expect(compareValues(5, null)).toBeLessThan(0);
    expect(compareValues(undefined, undefined)).toBe(0);
    expect(compareValues('', 'a')).toBeGreaterThan(0);
  });

  it('orders booleans false < true', () => {
    expect(compareValues(false, true)).toBeLessThan(0);
    expect(compareValues(true, false)).toBeGreaterThan(0);
    expect(compareValues(true, true)).toBe(0);
  });
});

describe('filterRows', () => {
  const search = (r: Row) => `${r.name} ${r.score ?? ''}`;

  it('returns all rows for an empty / whitespace query', () => {
    expect(filterRows(ROWS, search, '')).toHaveLength(4);
    expect(filterRows(ROWS, search, '   ')).toHaveLength(4);
  });

  it('matches case-insensitively across the search text', () => {
    expect(filterRows(ROWS, search, 'ALICE').map((r) => r.id)).toEqual(['2']);
    expect(filterRows(ROWS, search, '30').map((r) => r.id)).toEqual(['1']);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterRows(ROWS, search, 'zzz')).toEqual([]);
  });
});

describe('sortRows', () => {
  it('sorts ascending and descending without mutating the input', () => {
    const asc = sortRows(ROWS, (r) => r.name, 'asc').map((r) => r.name);
    expect(asc).toEqual(['alice', 'Bob', 'Charlie', 'Dave']);

    const desc = sortRows(ROWS, (r) => r.name, 'desc').map((r) => r.name);
    expect(desc).toEqual(['Dave', 'Charlie', 'Bob', 'alice']);

    // original order preserved
    expect(ROWS.map((r) => r.id)).toEqual(['1', '2', '3', '4']);
  });

  it('keeps nil values last on ascending numeric sort', () => {
    const asc = sortRows(ROWS, (r) => r.score, 'asc').map((r) => r.id);
    expect(asc).toEqual(['2', '4', '1', '3']);
  });
});

describe('paginate', () => {
  const items = Array.from({ length: 23 }, (_, i) => i + 1);

  it('returns the requested page slice', () => {
    const p1 = paginate(items, 1, 10);
    expect(p1.items).toHaveLength(10);
    expect(p1.items[0]).toBe(1);
    expect(p1.totalPages).toBe(3);
    expect(p1.total).toBe(23);

    const p3 = paginate(items, 3, 10);
    expect(p3.items).toEqual([21, 22, 23]);
  });

  it('clamps an out-of-range page into the valid range', () => {
    expect(paginate(items, 99, 10).page).toBe(3);
    expect(paginate(items, 0, 10).page).toBe(1);
    expect(paginate(items, -5, 10).page).toBe(1);
  });

  it('always reports at least one page, even when empty', () => {
    const empty = paginate([], 1, 10);
    expect(empty.items).toEqual([]);
    expect(empty.totalPages).toBe(1);
    expect(empty.total).toBe(0);
  });
});
