import {
  APP_TIMEZONE,
  defaultRecurrence,
  expandOccurrences,
  formatOccurrenceTashkent,
  parseSchedule,
  serializeRruleValue,
  serializeScheduleBlock,
  tashkentToUtc,
  validateRecurrence,
  type ScheduleRecurrence,
} from './schedule-rrule';

describe('schedule-rrule serialization', () => {
  it('serializes a weekly rule with weekdays + time-of-day', () => {
    const rec: ScheduleRecurrence = {
      freq: 'WEEKLY',
      interval: 1,
      byday: ['WE', 'MO', 'FR'],
      startDate: '2025-09-01',
      startTime: '18:30',
      end: { type: 'never' },
    };
    // Weekdays are emitted in canonical Mon-first order; INTERVAL=1 omitted.
    expect(serializeRruleValue(rec)).toBe(
      'FREQ=WEEKLY;BYDAY=MO,WE,FR;BYHOUR=18;BYMINUTE=30',
    );
  });

  it('includes INTERVAL when > 1 and COUNT for a count end condition', () => {
    const rec: ScheduleRecurrence = {
      freq: 'WEEKLY',
      interval: 2,
      byday: ['TU'],
      startDate: '2025-09-02',
      startTime: '09:00',
      end: { type: 'count', count: 12 },
    };
    expect(serializeRruleValue(rec)).toBe(
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;BYHOUR=9;BYMINUTE=0;COUNT=12',
    );
  });

  it('emits a UTC UNTIL stamp for an until end condition', () => {
    const rec: ScheduleRecurrence = {
      freq: 'DAILY',
      interval: 1,
      byday: [],
      startDate: '2025-09-01',
      startTime: '08:00',
      end: { type: 'until', date: '2025-09-30' },
    };
    const value = serializeRruleValue(rec);
    expect(value).toContain('FREQ=DAILY');
    // 2025-09-30 23:59 Tashkent (UTC+5) → 18:59Z same day.
    expect(value).toContain('UNTIL=20250930T185900Z');
  });

  it('serializes a full RFC 5545 block with DTSTART and EXDATE', () => {
    const rec: ScheduleRecurrence = {
      freq: 'WEEKLY',
      interval: 1,
      byday: ['MO'],
      startDate: '2025-09-01',
      startTime: '18:00',
      end: { type: 'never' },
    };
    // EXDATE keyed by the occurrence's UTC instant (Mon 2025-09-08 18:00 +05).
    const exIso = tashkentToUtc('2025-09-08', '18:00')!.toISOString();
    const block = serializeScheduleBlock(rec, [exIso]);
    expect(block).toContain(`DTSTART;TZID=${APP_TIMEZONE}:20250901T180000`);
    expect(block).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=18;BYMINUTE=0');
    expect(block).toContain(`EXDATE;TZID=${APP_TIMEZONE}:20250908T180000`);
  });
});

describe('schedule-rrule parsing (round-trip)', () => {
  it('parses a bare value back into the editor model', () => {
    const parsed = parseSchedule(
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;BYHOUR=18;BYMINUTE=0;COUNT=10',
      '2025-09-01',
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.recurrence.freq).toBe('WEEKLY');
    expect(parsed!.recurrence.interval).toBe(2);
    expect(parsed!.recurrence.byday).toEqual(['MO', 'WE']);
    expect(parsed!.recurrence.startTime).toBe('18:00');
    expect(parsed!.recurrence.end).toEqual({ type: 'count', count: 10 });
  });

  it('round-trips a full block including DTSTART and EXDATE', () => {
    const rec: ScheduleRecurrence = {
      freq: 'WEEKLY',
      interval: 1,
      byday: ['MO', 'TH'],
      startDate: '2025-09-01',
      startTime: '19:15',
      end: { type: 'never' },
    };
    const exIso = tashkentToUtc('2025-09-04', '19:15')!.toISOString();
    const block = serializeScheduleBlock(rec, [exIso]);

    const parsed = parseSchedule(block);
    expect(parsed).not.toBeNull();
    expect(parsed!.recurrence.startDate).toBe('2025-09-01');
    expect(parsed!.recurrence.startTime).toBe('19:15');
    expect(parsed!.recurrence.byday).toEqual(['MO', 'TH']);
    expect(parsed!.exdates).toEqual([exIso]);
  });

  it('returns null when no FREQ is present', () => {
    expect(parseSchedule('BYDAY=MO')).toBeNull();
    expect(parseSchedule('')).toBeNull();
  });
});

describe('schedule-rrule expansion', () => {
  it('expands a weekly MWF rule into the correct weekdays/times', () => {
    const rec: ScheduleRecurrence = {
      freq: 'WEEKLY',
      interval: 1,
      byday: ['MO', 'WE', 'FR'],
      startDate: '2025-09-01', // Monday
      startTime: '18:00',
      end: { type: 'never' },
    };
    const occ = expandOccurrences(rec, { limit: 3 });
    expect(occ.map((o) => o.iso)).toEqual([
      tashkentToUtc('2025-09-01', '18:00')!.toISOString(), // Mon
      tashkentToUtc('2025-09-03', '18:00')!.toISOString(), // Wed
      tashkentToUtc('2025-09-05', '18:00')!.toISOString(), // Fri
    ]);
  });

  it('honours COUNT as a hard stop', () => {
    const rec: ScheduleRecurrence = {
      freq: 'DAILY',
      interval: 1,
      byday: [],
      startDate: '2025-09-01',
      startTime: '10:00',
      end: { type: 'count', count: 4 },
    };
    const occ = expandOccurrences(rec, { limit: 100 });
    expect(occ).toHaveLength(4);
    expect(occ[3]!.iso).toBe(tashkentToUtc('2025-09-04', '10:00')!.toISOString());
  });

  it('honours UNTIL (inclusive of the final local day)', () => {
    const rec: ScheduleRecurrence = {
      freq: 'DAILY',
      interval: 1,
      byday: [],
      startDate: '2025-09-01',
      startTime: '10:00',
      end: { type: 'until', date: '2025-09-03' },
    };
    const occ = expandOccurrences(rec, { limit: 100 });
    expect(occ.map((o) => o.iso)).toEqual([
      tashkentToUtc('2025-09-01', '10:00')!.toISOString(),
      tashkentToUtc('2025-09-02', '10:00')!.toISOString(),
      tashkentToUtc('2025-09-03', '10:00')!.toISOString(),
    ]);
  });

  it('applies INTERVAL for every-other-week rules', () => {
    const rec: ScheduleRecurrence = {
      freq: 'WEEKLY',
      interval: 2,
      byday: ['MO'],
      startDate: '2025-09-01', // Monday
      startTime: '12:00',
      end: { type: 'count', count: 3 },
    };
    const occ = expandOccurrences(rec, { limit: 10 });
    expect(occ.map((o) => o.iso)).toEqual([
      tashkentToUtc('2025-09-01', '12:00')!.toISOString(),
      tashkentToUtc('2025-09-15', '12:00')!.toISOString(),
      tashkentToUtc('2025-09-29', '12:00')!.toISOString(),
    ]);
  });

  it('removes EXDATE occurrences but still counts them toward COUNT', () => {
    const rec: ScheduleRecurrence = {
      freq: 'DAILY',
      interval: 1,
      byday: [],
      startDate: '2025-09-01',
      startTime: '10:00',
      end: { type: 'count', count: 3 },
    };
    const cancelled = tashkentToUtc('2025-09-02', '10:00')!.toISOString();
    const occ = expandOccurrences(rec, { limit: 100, exdates: [cancelled] });
    // COUNT=3 produces 3 occurrences; the middle one is cancelled, leaving 2.
    expect(occ.map((o) => o.iso)).toEqual([
      tashkentToUtc('2025-09-01', '10:00')!.toISOString(),
      tashkentToUtc('2025-09-03', '10:00')!.toISOString(),
    ]);
  });

  it('filters occurrences before the `from` instant', () => {
    const rec: ScheduleRecurrence = {
      freq: 'DAILY',
      interval: 1,
      byday: [],
      startDate: '2025-09-01',
      startTime: '10:00',
      end: { type: 'never' },
    };
    const from = tashkentToUtc('2025-09-03', '00:00')!;
    const occ = expandOccurrences(rec, { limit: 2, from });
    expect(occ[0]!.iso).toBe(tashkentToUtc('2025-09-03', '10:00')!.toISOString());
  });
});

describe('schedule-rrule timezone + validation', () => {
  it('converts Tashkent wall time to the correct UTC instant (UTC+5)', () => {
    const utc = tashkentToUtc('2025-09-01', '18:00')!;
    expect(utc.toISOString()).toBe('2025-09-01T13:00:00.000Z');
  });

  it('formats an occurrence back in Tashkent local time', () => {
    const utc = tashkentToUtc('2025-09-01', '18:00')!;
    expect(formatOccurrenceTashkent(utc)).toContain('18:00');
    expect(formatOccurrenceTashkent(utc)).toContain('01.09.2025');
  });

  it('flags an empty weekday set for weekly rules', () => {
    const rec = { ...defaultRecurrence('2025-09-01'), byday: [] };
    expect(validateRecurrence(rec)).toContain(
      'Haftalik takrorlash uchun kamida bitta kun tanlang.',
    );
  });

  it('flags an until date before the start date', () => {
    const rec: ScheduleRecurrence = {
      ...defaultRecurrence('2025-09-10'),
      end: { type: 'until', date: '2025-09-01' },
    };
    expect(validateRecurrence(rec)).toContain(
      'Tugash sanasi boshlanish sanasidan keyin bo\u2018lishi kerak.',
    );
  });

  it('accepts a valid default recurrence', () => {
    expect(validateRecurrence(defaultRecurrence('2025-09-01'))).toEqual([]);
  });
});
