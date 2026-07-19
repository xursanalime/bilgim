import {
  CreateScheduleEventSchema,
  UpdateScheduleEventSchema,
} from './schedule.dto';

const VALID_RRULE = 'FREQ=WEEKLY;BYDAY=TU,TH,SA;BYHOUR=20;BYMINUTE=0';
const VALID_GROUP_ID = '33333333-3333-3333-3333-333333333333';

describe('schedule DTOs', () => {
  // ==================================================================
  // CreateScheduleEventSchema
  // ==================================================================

  describe('CreateScheduleEventSchema', () => {
    it('accepts a valid RRULE + Asia/Tashkent default', () => {
      const result = CreateScheduleEventSchema.safeParse({
        groupId: VALID_GROUP_ID,
        rrule: VALID_RRULE,
        durationMin: 90,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.timezone).toBe('Asia/Tashkent');
      }
    });

    it('rejects malformed RRULE strings (not RFC 5545)', () => {
      const result = CreateScheduleEventSchema.safeParse({
        groupId: VALID_GROUP_ID,
        rrule: 'this is not an rrule',
        durationMin: 90,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find((i) =>
          i.path.includes('rrule'),
        );
        expect(issue?.message).toMatch(/rrule must be a valid/);
      }
    });

    it('rejects non-positive durationMin', () => {
      const result = CreateScheduleEventSchema.safeParse({
        groupId: VALID_GROUP_ID,
        rrule: VALID_RRULE,
        durationMin: 0,
      });
      expect(result.success).toBe(false);
    });

    it('rejects > 1 day durationMin', () => {
      const result = CreateScheduleEventSchema.safeParse({
        groupId: VALID_GROUP_ID,
        rrule: VALID_RRULE,
        durationMin: 24 * 60 + 1,
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-UUID groupId', () => {
      const result = CreateScheduleEventSchema.safeParse({
        groupId: 'not-a-uuid',
        rrule: VALID_RRULE,
        durationMin: 90,
      });
      expect(result.success).toBe(false);
    });
  });

  // ==================================================================
  // UpdateScheduleEventSchema
  // ==================================================================

  describe('UpdateScheduleEventSchema', () => {
    it('accepts a single-field partial update', () => {
      const result = UpdateScheduleEventSchema.safeParse({
        durationMin: 60,
      });
      expect(result.success).toBe(true);
    });

    it('rejects an empty body', () => {
      const result = UpdateScheduleEventSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('rejects malformed RRULE on update', () => {
      const result = UpdateScheduleEventSchema.safeParse({
        rrule: 'not-an-rrule',
      });
      expect(result.success).toBe(false);
    });
  });
});
