import { Readable } from 'stream';

import {
  csvHeader,
  encodeCsvField,
  encodeCsvRow,
  streamCsv,
  type CsvColumn,
} from './csv-stream';

interface Row {
  id: string;
  name: string;
  amount: number | null;
  paidAt: Date | null;
}

const COLS: CsvColumn<Row>[] = [
  { header: 'id', value: (r) => r.id },
  { header: 'name', value: (r) => r.name },
  { header: 'amount', value: (r) => r.amount },
  { header: 'paidAt', value: (r) => r.paidAt },
];

async function readAll(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

describe('csv-stream — encoder', () => {
  it('encodes simple values without quoting', () => {
    expect(encodeCsvField('hello')).toBe('hello');
    expect(encodeCsvField(42)).toBe('42');
    expect(encodeCsvField(true)).toBe('true');
  });

  it('returns empty string for null/undefined', () => {
    expect(encodeCsvField(null)).toBe('');
    expect(encodeCsvField(undefined)).toBe('');
  });

  it('quotes and escapes strings containing commas, quotes or newlines', () => {
    expect(encodeCsvField('a,b')).toBe('"a,b"');
    expect(encodeCsvField('he said "hi"')).toBe('"he said ""hi"""');
    expect(encodeCsvField('line1\nline2')).toBe('"line1\nline2"');
    expect(encodeCsvField('line1\r\nline2')).toBe('"line1\r\nline2"');
  });

  it('renders Date as ISO 8601', () => {
    const d = new Date('2024-06-15T12:34:56.789Z');
    expect(encodeCsvField(d)).toBe('2024-06-15T12:34:56.789Z');
  });

  it('renders BigInt and bigint-like via toString', () => {
    expect(encodeCsvField(BigInt('9007199254740993'))).toBe('9007199254740993');
  });

  it('JSON-stringifies plain objects', () => {
    // Plain objects without a custom toString fall back to JSON, and
    // the resulting string is then quoted because of the embedded `"`.
    expect(encodeCsvField({ a: 1, b: 'x' })).toBe('"{""a"":1,""b"":""x""}"');
  });
});

describe('csv-stream — encodeCsvRow / csvHeader', () => {
  it('joins columns with `,` in the configured order', () => {
    expect(csvHeader(COLS)).toBe('id,name,amount,paidAt');
    const row = encodeCsvRow(COLS, {
      id: 'i1',
      name: 'a, b',
      amount: 100,
      paidAt: new Date('2024-01-02T00:00:00Z'),
    });
    expect(row).toBe('i1,"a, b",100,2024-01-02T00:00:00.000Z');
  });

  it('renders null fields as empty', () => {
    const row = encodeCsvRow(COLS, {
      id: 'i2',
      name: 'no payments',
      amount: null,
      paidAt: null,
    });
    expect(row).toBe('i2,no payments,,');
  });
});

describe('csv-stream — streamCsv', () => {
  it('streams the header + paged rows with CRLF line endings', async () => {
    const pages: Row[][] = [
      [
        { id: '1', name: 'a', amount: 10, paidAt: null },
        { id: '2', name: 'b', amount: 20, paidAt: null },
      ],
      [{ id: '3', name: 'c', amount: 30, paidAt: null }],
      [],
    ];
    let calls = 0;
    const stream = streamCsv(COLS, async (page) => {
      calls += 1;
      return pages[page - 1] ?? [];
    });

    const out = await readAll(stream);
    expect(out).toBe(
      [
        'id,name,amount,paidAt',
        '1,a,10,',
        '2,b,20,',
        '3,c,30,',
        '',
      ].join('\r\n'),
    );
    expect(calls).toBe(3);
  });

  it('emits headers-only CSV when the first page is empty', async () => {
    const stream = streamCsv(COLS, async () => []);
    const out = await readAll(stream);
    expect(out).toBe('id,name,amount,paidAt\r\n');
  });

  it('aborts the stream when the page provider rejects', async () => {
    const stream = streamCsv(COLS, async () => {
      throw new Error('boom');
    });
    await expect(readAll(stream)).rejects.toThrow('boom');
  });
});
