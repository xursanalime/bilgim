'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  CalendarClock,
  CalendarOff,
  Loader2,
  RotateCcw,
  Save,
  Trash2,
  X,
} from 'lucide-react';

import { ApiClientError } from '../../lib/api-client';
import { scheduleApi } from '../../lib/api/schedule';
import {
  APP_TIMEZONE,
  WEEKDAYS,
  defaultRecurrence,
  expandOccurrences,
  formatOccurrenceTashkent,
  parseSchedule,
  serializeScheduleBlock,
  validateRecurrence,
  type EndCondition,
  type Frequency,
  type ScheduleRecurrence,
  type WeekdayCode,
} from '../../lib/schedule-rrule';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../ui/card';
import { Checkbox } from '../ui/checkbox';
import { Input } from '../ui/input';
import { Label } from '../ui/form-field';
import { Select } from '../ui/select';
import { toast } from '../ui/toast';

// ═══════════════════════════════════════════════════════════════════
// ScheduleEditor — teacher-side RRULE schedule editor (Task 4.5, Req 8.5).
//
//   • Frequency (daily / weekly), interval, weekdays (BYDAY).
//   • Start date + time, anchored to Asia/Tashkent.
//   • End condition: never / until date / count.
//   • Exceptions: cancel a specific occurrence (EXDATE) and restore it.
//   • Live preview of the next N computed occurrences (client-side expander).
//
// Recurrence (de)serialization + expansion lives in the pure, unit-tested
// `lib/schedule-rrule` module. Persistence goes through `scheduleApi`, which
// documents the backend contract + the exceptions-endpoint assumption.
// ═══════════════════════════════════════════════════════════════════

const PREVIEW_COUNT = 8;
const DURATION_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 45, label: '45 daqiqa' },
  { value: 60, label: '60 daqiqa' },
  { value: 90, label: '90 daqiqa' },
  { value: 120, label: '120 daqiqa' },
];

export interface ScheduleEditorProps {
  /** The Group this schedule belongs to. */
  groupId: string;
  /** Group `startsOn` (ISO) — seeds the start date when no schedule exists. */
  groupStartsOn?: string | null;
}

function isoToDateInput(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  // Read in Tashkent local terms (UTC+5).
  const local = new Date(d.getTime() + 300 * 60_000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(
    2,
    '0',
  )}-${String(local.getUTCDate()).padStart(2, '0')}`;
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiClientError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

export function ScheduleEditor({ groupId, groupStartsOn }: ScheduleEditorProps) {
  const qc = useQueryClient();
  const seedStartDate = isoToDateInput(groupStartsOn);

  const scheduleQuery = useQuery({
    queryKey: ['schedule', 'group', groupId],
    queryFn: () => scheduleApi.getForGroup(groupId),
  });

  const [recurrence, setRecurrence] = useState<ScheduleRecurrence>(() =>
    defaultRecurrence(seedStartDate),
  );
  const [exdates, setExdates] = useState<string[]>([]);
  const [durationMin, setDurationMin] = useState<number>(90);
  const [scheduleId, setScheduleId] = useState<string | null>(null);
  const hydratedRef = useRef(false);

  // Hydrate editor state once the server schedule is known.
  useEffect(() => {
    if (hydratedRef.current || !scheduleQuery.data) return;
    hydratedRef.current = true;
    const server = scheduleQuery.data.schedule;
    if (server) {
      setScheduleId(server.id);
      setDurationMin(server.durationMin);
      const parsed = parseSchedule(server.rrule, seedStartDate);
      if (parsed) {
        setRecurrence(parsed.recurrence);
        setExdates(parsed.exdates);
      }
    }
  }, [scheduleQuery.data, seedStartDate]);

  const errors = useMemo(
    () => validateRecurrence(recurrence),
    [recurrence],
  );

  // Upcoming occurrences (from now), excluding cancelled ones.
  const upcoming = useMemo(() => {
    if (errors.length > 0) return [];
    return expandOccurrences(recurrence, {
      limit: PREVIEW_COUNT,
      exdates,
      from: new Date(),
    });
  }, [recurrence, exdates, errors.length]);

  // Cancelled occurrences that are still in the future (for the EXDATE list).
  const cancelledUpcoming = useMemo(() => {
    const now = Date.now();
    return exdates
      .map((iso) => ({ iso, date: new Date(iso) }))
      .filter(({ date }) => !Number.isNaN(date.getTime()) && date.getTime() >= now)
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [exdates]);

  const saveMut = useMutation({
    mutationFn: () =>
      scheduleApi.save({
        groupId,
        scheduleId,
        recurrence,
        exdates,
        durationMin,
      }),
    onSuccess: (resource) => {
      setScheduleId(resource.id);
      toast.success('Jadval saqlandi');
      void qc.invalidateQueries({ queryKey: ['schedule', 'group', groupId] });
    },
    onError: (err) => toast.error(errorMessage(err, 'Jadvalni saqlab bo\u2018lmadi')),
  });

  const deleteMut = useMutation({
    mutationFn: () => {
      if (!scheduleId) throw new Error('Jadval mavjud emas');
      return scheduleApi.remove(scheduleId);
    },
    onSuccess: () => {
      setScheduleId(null);
      setExdates([]);
      setRecurrence(defaultRecurrence(seedStartDate));
      hydratedRef.current = true;
      toast.success('Jadval o\u2018chirildi');
      void qc.invalidateQueries({ queryKey: ['schedule', 'group', groupId] });
    },
    onError: (err) =>
      toast.error(errorMessage(err, 'Jadvalni o\u2018chirib bo\u2018lmadi')),
  });

  function patch(next: Partial<ScheduleRecurrence>) {
    setRecurrence((prev) => ({ ...prev, ...next }));
  }

  function toggleWeekday(code: WeekdayCode) {
    setRecurrence((prev) => {
      const set = new Set(prev.byday);
      if (set.has(code)) set.delete(code);
      else set.add(code);
      return { ...prev, byday: Array.from(set) };
    });
  }

  function setEndType(type: EndCondition['type']) {
    if (type === 'never') patch({ end: { type: 'never' } });
    else if (type === 'count') patch({ end: { type: 'count', count: 12 } });
    else
      patch({
        end: {
          type: 'until',
          date: recurrence.end.type === 'until' ? recurrence.end.date : recurrence.startDate,
        },
      });
  }

  function cancelOccurrence(iso: string) {
    setExdates((prev) => (prev.includes(iso) ? prev : [...prev, iso]));
  }

  function restoreOccurrence(iso: string) {
    setExdates((prev) => prev.filter((x) => x !== iso));
  }

  const rrulePreview = useMemo(
    () => serializeScheduleBlock(recurrence, exdates),
    [recurrence, exdates],
  );

  if (scheduleQuery.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-ink-faint" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-blue" />
            Takroriy jadval
          </CardTitle>
          <CardDescription>
            Dars takrorlanish qoidasini belgilang. Vaqt mintaqasi:{' '}
            <span className="font-semibold text-ink-strong">{APP_TIMEZONE}</span>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Frequency + interval */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sched-freq">Takrorlanish</Label>
              <Select
                id="sched-freq"
                value={recurrence.freq}
                onChange={(e) => patch({ freq: e.target.value as Frequency })}
              >
                <option value="WEEKLY">Haftalik</option>
                <option value="DAILY">Kunlik</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sched-interval">
                Har nechta {recurrence.freq === 'WEEKLY' ? 'hafta' : 'kun'}da
              </Label>
              <Input
                id="sched-interval"
                type="number"
                min={1}
                max={52}
                inputMode="numeric"
                value={recurrence.interval}
                onChange={(e) =>
                  patch({ interval: Math.max(1, Number(e.target.value) || 1) })
                }
              />
            </div>
          </div>

          {/* Weekdays (weekly only) */}
          {recurrence.freq === 'WEEKLY' && (
            <div className="space-y-2">
              <Label>Hafta kunlari</Label>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((w) => {
                  const checked = recurrence.byday.includes(w.code);
                  return (
                    <label
                      key={w.code}
                      className="flex cursor-pointer items-center gap-2 rounded-xl border border-rim bg-tint/40 px-3 py-2 text-sm font-semibold text-ink-strong"
                    >
                      <Checkbox
                        size="sm"
                        checked={checked}
                        onChange={() => toggleWeekday(w.code)}
                        aria-label={w.label}
                      />
                      <span aria-hidden="true">{w.short}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Start date / time + duration */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="sched-start-date">Boshlanish sanasi</Label>
              <Input
                id="sched-start-date"
                type="date"
                value={recurrence.startDate}
                onChange={(e) => patch({ startDate: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sched-start-time">Vaqt ({APP_TIMEZONE})</Label>
              <Input
                id="sched-start-time"
                type="time"
                value={recurrence.startTime}
                onChange={(e) => patch({ startTime: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sched-duration">Davomiyligi</Label>
              <Select
                id="sched-duration"
                value={durationMin}
                onChange={(e) => setDurationMin(Number(e.target.value))}
              >
                {DURATION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {/* End condition */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sched-end">Tugash sharti</Label>
              <Select
                id="sched-end"
                value={recurrence.end.type}
                onChange={(e) => setEndType(e.target.value as EndCondition['type'])}
              >
                <option value="never">Muddatsiz</option>
                <option value="until">Sanagacha</option>
                <option value="count">Takrorlar soni</option>
              </Select>
            </div>
            {recurrence.end.type === 'until' && (
              <div className="space-y-1.5">
                <Label htmlFor="sched-until">Tugash sanasi</Label>
                <Input
                  id="sched-until"
                  type="date"
                  value={recurrence.end.date}
                  min={recurrence.startDate}
                  onChange={(e) =>
                    patch({ end: { type: 'until', date: e.target.value } })
                  }
                />
              </div>
            )}
            {recurrence.end.type === 'count' && (
              <div className="space-y-1.5">
                <Label htmlFor="sched-count">Takrorlar soni</Label>
                <Input
                  id="sched-count"
                  type="number"
                  min={1}
                  max={500}
                  inputMode="numeric"
                  value={recurrence.end.count}
                  onChange={(e) =>
                    patch({
                      end: { type: 'count', count: Math.max(1, Number(e.target.value) || 1) },
                    })
                  }
                />
              </div>
            )}
          </div>

          {/* Validation errors */}
          {errors.length > 0 && (
            <div
              role="alert"
              className="space-y-1 rounded-2xl border border-red/20 bg-red-tint p-4 text-sm font-semibold text-red"
            >
              {errors.map((msg) => (
                <p key={msg} className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {msg}
                </p>
              ))}
            </div>
          )}

          {/* Serialized RRULE (transparency for the teacher) */}
          <div className="space-y-1.5">
            <Label htmlFor="sched-rrule">RRULE (RFC 5545)</Label>
            <pre
              id="sched-rrule"
              className="overflow-x-auto whitespace-pre-wrap rounded-2xl border border-rim bg-tint/40 p-3 font-mono text-xs text-ink-soft"
            >
              {rrulePreview}
            </pre>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-rim pt-4">
            {scheduleId && (
              <Button
                type="button"
                variant="ghost"
                loading={deleteMut.isPending}
                leftIcon={
                  deleteMut.isPending ? undefined : <Trash2 className="h-4 w-4" />
                }
                onClick={() => deleteMut.mutate()}
              >
                Jadvalni o‘chirish
              </Button>
            )}
            <Button
              type="button"
              loading={saveMut.isPending}
              disabled={errors.length > 0}
              leftIcon={saveMut.isPending ? undefined : <Save className="h-4 w-4" />}
              onClick={() => saveMut.mutate()}
            >
              Jadvalni saqlash
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Preview + exceptions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarOff className="h-5 w-5 text-purple" />
            Keyingi darslar va istisnolar
          </CardTitle>
          <CardDescription>
            Keyingi {PREVIEW_COUNT} ta dars vaqti. Kerakli darsni bekor qilib,
            istisno (EXDATE) sifatida belgilashingiz mumkin.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Upcoming */}
          {upcoming.length === 0 ? (
            <p className="text-sm text-ink-soft">
              {errors.length > 0
                ? 'Jadvalni to\u2018g\u2018rilang \u2014 oldindan ko\u2018rish mavjud emas.'
                : 'Bu qoida bo\u2018yicha kelgusi darslar topilmadi.'}
            </p>
          ) : (
            <ul className="divide-y divide-rim overflow-hidden rounded-2xl border border-rim">
              {upcoming.map((occ) => (
                <li
                  key={occ.iso}
                  className="flex items-center justify-between gap-3 bg-canvas px-4 py-2.5"
                >
                  <span className="text-sm font-semibold text-ink-strong">
                    {formatOccurrenceTashkent(occ.start)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    leftIcon={<X className="h-3.5 w-3.5" />}
                    onClick={() => cancelOccurrence(occ.iso)}
                  >
                    Bekor qilish
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {/* Cancelled (EXDATE) */}
          {cancelledUpcoming.length > 0 && (
            <div className="space-y-2">
              <Label>Bekor qilingan darslar</Label>
              <ul className="flex flex-wrap gap-2">
                {cancelledUpcoming.map(({ iso, date }) => (
                  <li key={iso}>
                    <Badge variant="red" size="lg" className="gap-2">
                      <span>{formatOccurrenceTashkent(date)}</span>
                      <button
                        type="button"
                        onClick={() => restoreOccurrence(iso)}
                        className="inline-flex items-center gap-1 font-bold underline-offset-2 hover:underline"
                        aria-label={`Tiklash: ${formatOccurrenceTashkent(date)}`}
                      >
                        <RotateCcw className="h-3 w-3" />
                        Tiklash
                      </button>
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
