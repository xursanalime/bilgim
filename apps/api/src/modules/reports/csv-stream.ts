import { PassThrough, Readable } from 'stream';

/**
 * Minimal RFC-4180 CSV writer.
 *
 * Why a hand-rolled writer instead of `csv-stringify`? The export
 * surface only needs:
 *   - column-driven row encoding
 *   - quoting of `,`, `"`, `\r`, `\n`
 *   - UTF-8 output (Node default)
 *
 * Pulling in a third-party CSV dep for that is overkill — and we need
 * tight control over how `null` / `undefined` / `BigInt` / Prisma
 * `Decimal` values render in financial exports anyway. Keeping the
 * encoder local makes those rules explicit and unit-testable.
 *
 * Quoting rules:
 *   - Always quote when the value contains `,`, `"`, `\r` or `\n`.
 *   - Inside a quoted field, embedded `"` becomes `""`.
 *   - Empty / null / undefined render as the empty field (no quotes).
 */
export type CsvRow = Record<string, unknown>;

export interface CsvColumn<T = CsvRow> {
  /** Header text written verbatim. */
  header: string;
  /**
   * Project a value out of the row. Strings, numbers, booleans,
   * `Date`, `BigInt`, Prisma `Decimal` (anything with `.toString()`)
   * render predictably; objects are JSON-stringified.
   */
  value: (row: T) => unknown;
}

/**
 * Encode a single field per RFC 4180. Exported so unit tests can
 * exercise the quoting rules directly.
 */
export function encodeCsvField(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  let s: string;
  if (value instanceof Date) {
    s = Number.isNaN(value.getTime()) ? '' : value.toISOString();
  } else if (typeof value === 'object') {
    // Prisma Decimal exposes `.toString()`; same goes for BigInt-ish wrappers.
    // Preserve plain numeric output by checking `typeof toString` first.
    const maybe = (value as { toString?: () => string }).toString;
    if (typeof maybe === 'function' && maybe !== Object.prototype.toString) {
      s = maybe.call(value);
    } else {
      s = JSON.stringify(value);
    }
  } else if (typeof value === 'bigint') {
    s = value.toString();
  } else {
    s = String(value);
  }

  if (s.length === 0) return '';

  // Quote when any of CSV's delimiters or quote chars appear.
  const needsQuotes = /[",\r\n]/.test(s);
  if (!needsQuotes) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Encode an entire row by joining encoded fields with `,`. */
export function encodeCsvRow<T>(columns: CsvColumn<T>[], row: T): string {
  return columns.map((col) => encodeCsvField(col.value(row))).join(',');
}

/** Build the header line from the columns. */
export function csvHeader<T>(columns: CsvColumn<T>[]): string {
  return columns.map((c) => encodeCsvField(c.header)).join(',');
}

/**
 * Stream `pages` of rows as CSV through a `Readable`.
 *
 * `pageProvider` is invoked repeatedly with a 1-indexed page number.
 * It MUST return an empty array when no more rows exist; that signals
 * end-of-stream. Pages are written one row at a time so memory stays
 * proportional to the page size, not the total row count (Task 23.3
 * "DO NOT load whole table into memory").
 *
 * Errors on the page-provider abort the stream with `destroy(err)` so
 * the HTTP response surfaces a 500 rather than a half-truncated CSV.
 */
export function streamCsv<T>(
  columns: CsvColumn<T>[],
  pageProvider: (page: number) => Promise<T[]>,
): Readable {
  const out = new PassThrough();

  // CRLF per RFC 4180. Most spreadsheet tools tolerate LF too, but
  // CRLF is the standard and Excel prefers it.
  const NEWLINE = '\r\n';

  // Header row first — empty-result exports still produce headers
  // (Task 23.3 acceptance: "empty range returns headers-only CSV").
  out.write(csvHeader(columns) + NEWLINE);

  // Run the producer in a microtask so the caller can attach its
  // `pipe()` / event listeners synchronously before any write fires.
  setImmediate(async () => {
    try {
      let page = 1;
      // Cap pages defensively so a stuck cursor cannot loop forever.
      const MAX_PAGES = 100_000;
      while (page <= MAX_PAGES) {
        const rows = await pageProvider(page);
        if (rows.length === 0) break;
        for (const row of rows) {
          out.write(encodeCsvRow(columns, row) + NEWLINE);
        }
        page += 1;
      }
      out.end();
    } catch (err) {
      out.destroy(err as Error);
    }
  });

  return out;
}
