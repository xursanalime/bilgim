/**
 * Schedule API client — wraps the NestJS `/schedule/*` endpoints that back
 * the per-group recurring schedule (Task 4.5, Req 8.5 / 10.x).
 *
 * ── Backend contract (verified against apps/api/src/modules/schedule) ──────
 *
 *   POST   /schedule/events                  [TEACHER]  → create the (one)
 *            body: { groupId, rrule, timezone, durationMin }    schedule
 *   PATCH  /schedule/events/:id              [TEACHER]  → update (partial)
 *            body: { rrule?, timezone?, durationMin? }
 *   DELETE /schedule/events/:id              [TEACHER]  → remove schedule
 *   GET    /schedule/groups/:groupId/events  [T/S/A]    → schedule + expanded
 *                                                         occurrences (UTC)
 *
 * The `rrule` string is validated server-side with `RRule.fromString`, which
 * accepts both a bare value (`FREQ=WEEKLY;...`) and a full block
 * (`DTSTART...\nRRULE:...`). We persist the bare RRULE value (with
 * BYHOUR/BYMINUTE encoding the time-of-day) via {@link serializeRruleValue}
 * so it round-trips cleanly through the backend's single-RRULE validator.
 *
 * ── Backend ASSUMPTIONS / gaps (documented, not yet wired) ─────────────────
 *
 * 1. EXCEPTIONS / CANCELLATIONS. The Prisma schema HAS a `ScheduleException`
 *    model (groupId, originalAt, cancelled, newAt, reason) but the
 *    `ScheduleController` currently exposes NO REST route for it, and the GET
 *    response (`ScheduleEventsForGroupResult`) does not include exceptions.
 *    Until a dedicated endpoint exists we manage EXDATEs client-side and, on
 *    save, fold them into the persisted block via
 *    {@link serializeScheduleBlock} (the backend validator tolerates the
 *    extra EXDATE line; bare-RRULE expansion simply ignores it).
 *
 *    ASSUMED future endpoints (NOT called yet — flip `EXCEPTIONS_ENDPOINT`
 *    once the backend ships them):
 *      POST   /schedule/groups/:groupId/exceptions { originalAt, cancelled,
 *                                                    newAt?, reason? }
 *      DELETE /schedule/groups/:groupId/exceptions/:exceptionId
 *
 * 2. GET RESPONSE SHAPE. The backend returns `occurrences: [{ start, end }]`
 *    (UTC). An older client type in `lib/api/student.ts` (`ScheduleResponse`
 *    with `upcoming`/`exceptions`) does NOT match the live controller; this
 *    wrapper models the actual `ScheduleEventsForGroupResult` shape.
 */

import { apiClient } from '../api-client';
import {
  APP_TIMEZONE,
  serializeRruleValue,
  serializeScheduleBlock,
  type ScheduleRecurrence,
} from '../schedule-rrule';

/** When the assumed exceptions endpoint ships, set this to `true` to persist
 * EXDATEs as discrete `ScheduleException` rows instead of folding them into
 * the RRULE block. */
export const EXCEPTIONS_ENDPOINT_AVAILABLE = false;

// ── Server resource shapes (mirror schedule.service.ts) ──────────────────

export interface ScheduleEventResource {
  id: string;
  groupId: string;
  rrule: string;
  timezone: string;
  durationMin: number;
  version: number;
  updatedAt: string;
}

export interface ScheduleEventOccurrence {
  /** UTC start instant. */
  start: string;
  /** UTC end instant (`start + durationMin`). */
  end: string;
}

export interface ScheduleEventsForGroupResult {
  groupId: string;
  version: number;
  schedule: ScheduleEventResource | null;
  occurrences: ScheduleEventOccurrence[];
}

// ── Request payloads ───────────────────────────────────────────────────

export interface CreateScheduleEventDto {
  groupId: string;
  rrule: string;
  timezone: string;
  durationMin: number;
}

export interface UpdateScheduleEventDto {
  rrule?: string;
  timezone?: string;
  durationMin?: number;
}

/**
 * Build the `rrule` payload string from the editor model. When EXDATEs are
 * present (and no dedicated exceptions endpoint exists yet) we persist the
 * full DTSTART/RRULE/EXDATE block; otherwise the lean bare value.
 */
export function buildRrulePayload(
  recurrence: ScheduleRecurrence,
  exdates: string[],
): string {
  if (exdates.length > 0 && !EXCEPTIONS_ENDPOINT_AVAILABLE) {
    return serializeScheduleBlock(recurrence, exdates);
  }
  return serializeRruleValue(recurrence);
}

export const scheduleApi = {
  /** GET the group's schedule + a bounded list of upcoming occurrences. */
  getForGroup(groupId: string) {
    return apiClient.get<ScheduleEventsForGroupResult>(
      `/schedule/groups/${groupId}/events`,
    );
  },

  /** POST a new schedule for a group (fails 409 if one already exists). */
  create(dto: CreateScheduleEventDto) {
    return apiClient.post<ScheduleEventResource>('/schedule/events', dto);
  },

  /** PATCH an existing schedule (bumps version + emits `schedule.changed`). */
  update(id: string, dto: UpdateScheduleEventDto) {
    return apiClient.patch<ScheduleEventResource>(
      `/schedule/events/${id}`,
      dto,
    );
  },

  /** DELETE the group's schedule. */
  remove(id: string) {
    return apiClient.delete<void>(`/schedule/events/${id}`);
  },

  /**
   * Persist the editor state. Creates the schedule when none exists, else
   * patches the existing one. `scheduleId` is the current schedule id (or
   * null when creating).
   */
  save(params: {
    groupId: string;
    scheduleId: string | null;
    recurrence: ScheduleRecurrence;
    exdates: string[];
    durationMin: number;
  }) {
    const rrule = buildRrulePayload(params.recurrence, params.exdates);
    if (params.scheduleId) {
      return scheduleApi.update(params.scheduleId, {
        rrule,
        timezone: APP_TIMEZONE,
        durationMin: params.durationMin,
      });
    }
    return scheduleApi.create({
      groupId: params.groupId,
      rrule,
      timezone: APP_TIMEZONE,
      durationMin: params.durationMin,
    });
  },
};
