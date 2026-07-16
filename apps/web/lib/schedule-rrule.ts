/**
 * schedule-rrule — a pure, dependency-free RRULE (RFC 5545) helper for the
 * teacher schedule editor (Task 4.5, Req 8.5).
 *
 * The web app does NOT ship the `rrule` npm package (the backend does, and
 * uses it to validate + expand). To keep the bundle lean we hand-write a
 * focused serializer + expander for the subset the editor exposes:
 *
 *   FREQ      → DAILY | WEEKLY
 *   INTERVAL  → every N days/weeks
 *   BYDAY     → weekday list (WEEKLY only)
 *   BYHOUR /  → time-of-day, mirroring the backend's own example
 *   BYMINUTE     ("FREQ=WEEKLY;BYDAY=MO;BYHOUR=18;BYMINUTE=0")
 *   UNTIL |   → end condition
 *   COUNT
 *
 * Plus EXDATE management (cancel a specific occurrence).
 *
 * ── Timezone ──────────────────────────────────────────────────────────
 * Scheduling is anchored to Asia/Tashkent. Tashkent has observed a stable
 * UTC+5 with NO daylight-saving since 1992, so we model it as a fixed
 * +05:00 offset. This keeps the module pure and deterministic (no Intl /
 * tz-database lookups) while staying correct for present + future classes.
 * If Uzbekistan ever reintroduces DST this is the single place to revisit.
 *
 * Everything here is pure and synchronous so it can be unit-tested in
 * isolation (see schedule-rrule.spec.ts).
 */

// ── Constants ───────────────────────────────────────────────────────────

/** IANA timezone all schedules are anchored to. */
export const APP_TIMEZONE = 'Asia/Tashkent';

/** Fixed UTC offset for Asia/Tashkent (UTC+5, no DST). Minutes. */
export const TASHKENT_UTC_OFFSET_MINUTES = 300;

/** RFC 5545 weekday codes, in ISO week order (Mon-first). */
export const WEEKDAYS = [
  { code: 'MO', isoDay: 1, label: 'Dushanba', short: 'Du' },
  { code: 'TU', isoDay: 2, label: 'Seshanba', short: 'Se' },
  { code: 'WE', isoDay: 3, label: 'Chorshanba', short: 'Ch' },
  { code: 'TH', isoDay: 4, label: 'Payshanba', short: 'Pa' },
  { code: 'FR', isoDay: 5, label: 'Juma', short: 'Ju' },
  { code: 'SA', isoDay: 6, label: 'Shanba', short: 'Sh' },
  { code: 'SU', isoDay: 7, label: 'Yakshanba', short: 'Ya' },
] as const;

export type WeekdayCode = (typeof WEEKDAYS)[number]['code'];

const WEEKDAY_CODES: readonly WeekdayCode[] = WEEKDAYS.map((w) => w.code);

/** Map JS `getUTCDay()` (0=Sun..6=Sat) → RFC weekday code. */
const JS_DAY_TO_CODE: readonly WeekdayCode[] = [
  'SU',
  'MO',
  'TU',
  'WE',
  'TH',
  'FR',
  'SA',
];

/**
 * Hard cap on expansion to protect the UI from an unbounded rule
 * (`FREQ=DAILY` with no UNTIL/COUNT). Generous enough for ~3 years of
 * daily classes.
 */
const MAX_EXPANSION = 1000;

// ── Types ────────────────────────────────────────────────────────────────

export type Frequency = 'DAILY' | 'WEEKLY';

export type EndCondition =
  | { type: 'never' }
  /** `date` is a Tashkent-local calendar day, `YYYY-MM-DD` (inclusive). */
  | { type: 'until'; date: string }
  | { type: 'count'; count: number };

/**
 * The editor's recurrence model. `startDate`/`startTime` are Tashkent-local
 * wall-clock values (`YYYY-MM-DD` / `HH:mm`). `byday` only applies to WEEKLY.
 */
export interface ScheduleRecurrence {
  freq: Frequency;
  interval: number;
  byday: WeekdayCode[];
  startDate: string;
  startTime: string;
  end: EndCondition;
}

/** A single concrete occurrence produced by the expander. */
export interface Occurrence {
  /** UTC instant of the occurrence start. */
  start: Date;
  /** ISO-8601 UTC string of the occurrence start (stable EXDATE key). */
  iso: string;
}

// ── Defaults ───────────────────────────────────────────────────────────

export function defaultRecurrence(startDate?: string): ScheduleRecurrence {
  const today = startDate ?? toDateInput(new Date());
  return {
    freq: 'WEEKLY',
    interval: 1,
    byday: ['MO', 'WE', 'FR'],
    startDate: today,
    startTime: '18:00',
    end: { type: 'never' },
  };
}

// ── Date helpers (Tashkent ↔ UTC) ────────────────────────────────────────

/** `Date` → `YYYY-MM-DD` (UTC fields). */
export function toDateInput(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(
    d.getUTCDate(),
  )}`;
}

/**
 * Convert a Tashkent wall-clock date+time to the real UTC instant.
 * Tashkent = UTC+5, so UTC = local − 5h.
 */
export function tashkentToUtc(
  dateStr: string,
  timeStr: string,
): Date | null {
  const date = parseDateParts(dateStr);
  const time = parseTimeParts(timeStr);
  if (!date || !time) return null;
  const asUtc = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    time.hour,
    time.minute,
    0,
    0,
  );
  return new Date(asUtc - TASHKENT_UTC_OFFSET_MINUTES * 60_000);
}

/** A UTC instant → the Tashkent wall-clock `Date` (fields read via getUTC*). */
function utcToTashkentFields(d: Date): Date {
  return new Date(d.getTime() + TASHKENT_UTC_OFFSET_MINUTES * 60_000);
}

// ── Serialization ────────────────────────────────────────────────────────

/**
 * Serialize the recurrence to a bare RRULE *value* string (no `RRULE:`
 * prefix), e.g. `FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR;BYHOUR=18;BYMINUTE=0`.
 *
 * This is what the backend stores in `Schedule.rrule`. Time-of-day is encoded
 * via BYHOUR/BYMINUTE to match the backend's documented example and so the
 * value round-trips through `RRule.fromString` without a separate DTSTART.
 *
 * Parts are emitted in a stable order so the output is deterministic.
 */
export function serializeRruleValue(rec: ScheduleRecurrence): string {
  const time = parseTimeParts(rec.startTime);
  const parts: string[] = [`FREQ=${rec.freq}`];

  const interval = Math.max(1, Math.floor(rec.interval || 1));
  if (interval !== 1) parts.push(`INTERVAL=${interval}`);

  if (rec.freq === 'WEEKLY' && rec.byday.length > 0) {
    parts.push(`BYDAY=${orderWeekdays(rec.byday).join(',')}`);
  }

  if (time) {
    parts.push(`BYHOUR=${time.hour}`);
    parts.push(`BYMINUTE=${time.minute}`);
  }

  if (rec.end.type === 'count') {
    parts.push(`COUNT=${Math.max(1, Math.floor(rec.end.count))}`);
  } else if (rec.end.type === 'until') {
    // UNTIL is a UTC timestamp. Use end-of-day Tashkent so the whole local
    // calendar day is inclusive regardless of the occurrence time.
    const untilUtc = tashkentToUtc(rec.end.date, '23:59');
    if (untilUtc) parts.push(`UNTIL=${toRruleUtcStamp(untilUtc)}`);
  }

  return parts.join(';');
}

/**
 * Serialize the full RFC 5545 block the backend's `RRule.fromString` accepts:
 *
 *   DTSTART;TZID=Asia/Tashkent:20250901T180000
 *   RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;BYHOUR=18;BYMINUTE=0
 *   EXDATE;TZID=Asia/Tashkent:20250915T180000
 *
 * `exdates` are ISO-8601 UTC instant strings (the `iso` field of an
 * {@link Occurrence}); they are rendered as Tashkent-local stamps.
 */
export function serializeScheduleBlock(
  rec: ScheduleRecurrence,
  exdates: string[] = [],
): string {
  const lines: string[] = [];
  const dtstart = localStampFor(rec.startDate, rec.startTime);
  if (dtstart) lines.push(`DTSTART;TZID=${APP_TIMEZONE}:${dtstart}`);
  lines.push(`RRULE:${serializeRruleValue(rec)}`);

  const stamps = exdates
    .map((iso) => localStampFromIso(iso))
    .filter((s): s is string => s !== null);
  if (stamps.length > 0) {
    lines.push(`EXDATE;TZID=${APP_TIMEZONE}:${stamps.join(',')}`);
  }

  return lines.join('\n');
}

// ── Parsing ──────────────────────────────────────────────────────────────

/**
 * Best-effort parse of a stored `rrule` value (bare or `RRULE:`-prefixed,
 * optionally preceded by a `DTSTART` line) back into the editor model.
 * Unsupported parts are ignored. Returns `null` if no FREQ is found.
 *
 * `startDate` is taken from a DTSTART line when present; otherwise it falls
 * back to `fallbackStartDate` (typically the group's `startsOn`) or today.
 */
export function parseSchedule(
  raw: string,
  fallbackStartDate?: string,
): { recurrence: ScheduleRecurrence; exdates: string[] } | null {
  if (!raw || typeof raw !== 'string') return null;

  let dtstartDate: string | undefined;
  let dtstartTime: string | undefined;
  let rruleValue = '';
  const exdates: string[] = [];

  for (const lineRaw of raw.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line) continue;
    if (/^DTSTART/i.test(line)) {
      const parsed = parseLocalStampLine(line);
      if (parsed) {
        dtstartDate = parsed.date;
        dtstartTime = parsed.time;
      }
    } else if (/^EXDATE/i.test(line)) {
      const value = line.slice(line.indexOf(':') + 1);
      for (const stamp of value.split(',')) {
        const iso = isoFromLocalStamp(stamp.trim());
        if (iso) exdates.push(iso);
      }
    } else if (/^RRULE:/i.test(line)) {
      rruleValue = line.slice(line.indexOf(':') + 1);
    } else if (!rruleValue && /FREQ=/i.test(line)) {
      // Bare value with no RRULE: prefix.
      rruleValue = line;
    }
  }

  const fields = parseRruleFields(rruleValue);
  if (!fields.freq) return null;

  const startTime =
    dtstartTime ?? `${pad2(fields.byhour ?? 18)}:${pad2(fields.byminute ?? 0)}`;
  const startDate =
    dtstartDate ?? fallbackStartDate ?? toDateInput(new Date());

  return {
    recurrence: {
      freq: fields.freq,
      interval: fields.interval ?? 1,
      byday: fields.byday ?? [],
      startDate,
      startTime,
      end: fields.end ?? { type: 'never' },
    },
    exdates,
  };
}

interface ParsedFields {
  freq?: Frequency;
  interval?: number;
  byday?: WeekdayCode[];
  byhour?: number;
  byminute?: number;
  end?: EndCondition;
}

function parseRruleFields(value: string): ParsedFields {
  const out: ParsedFields = {};
  if (!value) return out;
  for (const segment of value.split(';')) {
    const [keyRaw, valRaw] = segment.split('=');
    if (!keyRaw || valRaw === undefined) continue;
    const key = keyRaw.trim().toUpperCase();
    const val = valRaw.trim();
    switch (key) {
      case 'FREQ':
        if (val.toUpperCase() === 'DAILY') out.freq = 'DAILY';
        else if (val.toUpperCase() === 'WEEKLY') out.freq = 'WEEKLY';
        break;
      case 'INTERVAL': {
        const n = Number.parseInt(val, 10);
        if (Number.isFinite(n) && n > 0) out.interval = n;
        break;
      }
      case 'BYDAY':
        out.byday = val
          .split(',')
          .map((c) => c.trim().toUpperCase())
          .filter((c): c is WeekdayCode =>
            WEEKDAY_CODES.includes(c as WeekdayCode),
          );
        break;
      case 'BYHOUR': {
        const n = Number.parseInt(val, 10);
        if (Number.isFinite(n)) out.byhour = n;
        break;
      }
      case 'BYMINUTE': {
        const n = Number.parseInt(val, 10);
        if (Number.isFinite(n)) out.byminute = n;
        break;
      }
      case 'COUNT': {
        const n = Number.parseInt(val, 10);
        if (Number.isFinite(n) && n > 0) out.end = { type: 'count', count: n };
        break;
      }
      case 'UNTIL': {
        const date = dateFromRruleUtcStamp(val);
        if (date) out.end = { type: 'until', date };
        break;
      }
      default:
        break;
    }
  }
  return out;
}

// ── Expansion ──────────────────────────────────────────────────────────

export interface ExpandOptions {
  /** Max occurrences to return. */
  limit: number;
  /** Cancelled occurrence keys (ISO UTC strings). Default: none. */
  exdates?: string[];
  /** Only return occurrences at/after this instant. Default: epoch. */
  from?: Date;
}

/**
 * Expand the recurrence into concrete occurrences (UTC), honouring the
 * supported subset (DAILY/WEEKLY + INTERVAL + BYDAY + UNTIL/COUNT). EXDATEs
 * are removed AFTER counting toward COUNT, matching RFC 5545 semantics.
 *
 * Returns at most `limit` occurrences at/after `from`.
 */
export function expandOccurrences(
  rec: ScheduleRecurrence,
  options: ExpandOptions,
): Occurrence[] {
  const start = tashkentToUtc(rec.startDate, rec.startTime);
  if (!start) return [];

  const interval = Math.max(1, Math.floor(rec.interval || 1));
  const exdateSet = new Set(options.exdates ?? []);
  const from = options.from ?? new Date(0);

  // End bounds.
  const untilUtc =
    rec.end.type === 'until' ? tashkentToUtc(rec.end.date, '23:59') : null;
  const maxCount =
    rec.end.type === 'count' ? Math.max(1, Math.floor(rec.end.count)) : null;

  const result: Occurrence[] = [];
  let produced = 0; // counts toward COUNT (pre-EXDATE filter)

  // Iterate calendar days from the start day's Tashkent-local midnight.
  const startLocal = utcToTashkentFields(start);
  const cursor = new Date(
    Date.UTC(
      startLocal.getUTCFullYear(),
      startLocal.getUTCMonth(),
      startLocal.getUTCDate(),
    ),
  );
  const hour = startLocal.getUTCHours();
  const minute = startLocal.getUTCMinutes();

  // Week anchor (Monday of the start week) for WEEKLY INTERVAL math.
  const startWeekMonday = mondayOf(cursor);

  const bydaySet = new Set<WeekdayCode>(
    rec.freq === 'WEEKLY'
      ? rec.byday.length > 0
        ? rec.byday
        : [JS_DAY_TO_CODE[startLocal.getUTCDay()]!]
      : [],
  );

  for (let guard = 0; guard < MAX_EXPANSION * 7 + 7; guard += 1) {
    if (maxCount !== null && produced >= maxCount) break;
    if (result.length >= options.limit) break;

    const dayCode = JS_DAY_TO_CODE[cursor.getUTCDay()]!;
    let matches = false;

    if (rec.freq === 'DAILY') {
      const dayDiff = Math.round(
        (cursor.getTime() - Date.UTC(
          startLocal.getUTCFullYear(),
          startLocal.getUTCMonth(),
          startLocal.getUTCDate(),
        )) /
          86_400_000,
      );
      matches = dayDiff >= 0 && dayDiff % interval === 0;
    } else {
      // WEEKLY: day must be in BYDAY and the week must be on the interval.
      if (bydaySet.has(dayCode)) {
        const weekDiff = Math.round(
          (mondayOf(cursor).getTime() - startWeekMonday.getTime()) /
            (7 * 86_400_000),
        );
        matches = weekDiff >= 0 && weekDiff % interval === 0;
      }
    }

    if (matches) {
      const occUtc = new Date(
        Date.UTC(
          cursor.getUTCFullYear(),
          cursor.getUTCMonth(),
          cursor.getUTCDate(),
          hour,
          minute,
        ) -
          TASHKENT_UTC_OFFSET_MINUTES * 60_000,
      );

      // Skip occurrences strictly before the rule start instant.
      if (occUtc.getTime() >= start.getTime()) {
        if (untilUtc && occUtc.getTime() > untilUtc.getTime()) break;
        produced += 1;
        const iso = occUtc.toISOString();
        if (!exdateSet.has(iso) && occUtc.getTime() >= from.getTime()) {
          result.push({ start: occUtc, iso });
        }
      }
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return result;
}

// ── Validation ───────────────────────────────────────────────────────────

/** Returns a list of human-readable validation errors (empty = valid). */
export function validateRecurrence(rec: ScheduleRecurrence): string[] {
  const errors: string[] = [];

  if (!parseDateParts(rec.startDate)) {
    errors.push('Boshlanish sanasi yaroqsiz.');
  }
  if (!parseTimeParts(rec.startTime)) {
    errors.push('Boshlanish vaqti yaroqsiz.');
  }
  if (!Number.isInteger(rec.interval) || rec.interval < 1) {
    errors.push('Interval 1 yoki undan katta butun son bo\u2018lishi kerak.');
  }
  if (rec.freq === 'WEEKLY' && rec.byday.length === 0) {
    errors.push('Haftalik takrorlash uchun kamida bitta kun tanlang.');
  }
  if (rec.end.type === 'count' && (!Number.isInteger(rec.end.count) || rec.end.count < 1)) {
    errors.push('Takrorlar soni 1 yoki undan katta bo\u2018lishi kerak.');
  }
  if (rec.end.type === 'until') {
    const until = parseDateParts(rec.end.date);
    const start = parseDateParts(rec.startDate);
    if (!until) {
      errors.push('Tugash sanasi yaroqsiz.');
    } else if (start && rec.end.date < rec.startDate) {
      errors.push('Tugash sanasi boshlanish sanasidan keyin bo\u2018lishi kerak.');
    }
  }

  return errors;
}

// ── Low-level helpers ────────────────────────────────────────────────────

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function parseDateParts(
  s: string,
): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '');
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function parseTimeParts(s: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s ?? '');
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function orderWeekdays(codes: WeekdayCode[]): WeekdayCode[] {
  const set = new Set(codes);
  return WEEKDAY_CODES.filter((c) => set.has(c));
}

/** Monday (UTC midnight) of the week containing `d` (treated as UTC date). */
function mondayOf(d: Date): Date {
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const deltaToMonday = (day + 6) % 7; // days since Monday
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) -
      deltaToMonday * 86_400_000,
  );
}

/** UTC instant → RFC UTC stamp `YYYYMMDDTHHMMSSZ`. */
function toRruleUtcStamp(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(
      d.getUTCSeconds(),
    )}Z`
  );
}

/** RFC UTC stamp `YYYYMMDDTHHMMSSZ` → Tashkent-local `YYYY-MM-DD` day. */
function dateFromRruleUtcStamp(stamp: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/.exec(
    stamp.trim(),
  );
  if (!m) return null;
  const utc = new Date(
    Date.UTC(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6]),
    ),
  );
  const local = utcToTashkentFields(utc);
  return toDateInput(local);
}

/** Tashkent-local date+time → local stamp `YYYYMMDDTHHMMSS` (no offset). */
function localStampFor(dateStr: string, timeStr: string): string | null {
  const date = parseDateParts(dateStr);
  const time = parseTimeParts(timeStr);
  if (!date || !time) return null;
  return (
    `${date.year}${pad2(date.month)}${pad2(date.day)}` +
    `T${pad2(time.hour)}${pad2(time.minute)}00`
  );
}

/** ISO UTC instant string → Tashkent-local stamp `YYYYMMDDTHHMMSS`. */
function localStampFromIso(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const local = utcToTashkentFields(d);
  return (
    `${local.getUTCFullYear()}${pad2(local.getUTCMonth() + 1)}${pad2(
      local.getUTCDate(),
    )}T${pad2(local.getUTCHours())}${pad2(local.getUTCMinutes())}${pad2(
      local.getUTCSeconds(),
    )}`
  );
}

/** Tashkent-local stamp `YYYYMMDDTHHMMSS` → ISO UTC instant string. */
function isoFromLocalStamp(stamp: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(stamp);
  if (!m) return null;
  const utc =
    Date.UTC(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6]),
    ) -
    TASHKENT_UTC_OFFSET_MINUTES * 60_000;
  return new Date(utc).toISOString();
}

/** Parse a `DTSTART;TZID=...:YYYYMMDDTHHMMSS` line → local date + time. */
function parseLocalStampLine(
  line: string,
): { date: string; time: string } | null {
  const value = line.slice(line.indexOf(':') + 1).trim();
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/.exec(value);
  if (!m) return null;
  // If the stamp carries a trailing Z it's UTC; convert to local. Otherwise
  // it's already a TZID-local wall time.
  if (value.endsWith('Z')) {
    const iso = new Date(
      Date.UTC(
        Number(m[1]),
        Number(m[2]) - 1,
        Number(m[3]),
        Number(m[4]),
        Number(m[5]),
        Number(m[6]),
      ),
    ).toISOString();
    const local = utcToTashkentFields(new Date(iso));
    return {
      date: toDateInput(local),
      time: `${pad2(local.getUTCHours())}:${pad2(local.getUTCMinutes())}`,
    };
  }
  return {
    date: `${m[1]}-${m[2]}-${m[3]}`,
    time: `${m[4]}:${m[5]}`,
  };
}

/** Format a UTC instant as a Tashkent-local human string for previews. */
export function formatOccurrenceTashkent(d: Date): string {
  const local = utcToTashkentFields(d);
  const code = JS_DAY_TO_CODE[local.getUTCDay()]!;
  const weekday = WEEKDAYS.find((w) => w.code === code)?.label ?? '';
  return (
    `${weekday}, ${pad2(local.getUTCDate())}.${pad2(
      local.getUTCMonth() + 1,
    )}.${local.getUTCFullYear()} ` +
    `${pad2(local.getUTCHours())}:${pad2(local.getUTCMinutes())}`
  );
}
