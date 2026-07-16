import {
  getNotificationKindMeta,
  resolveNotificationDeeplink,
  toLocaleHref,
} from './notification-kinds';
import type { NotificationItem } from '../../lib/api/notifications';

function makeNotification(
  partial: Partial<NotificationItem> & Pick<NotificationItem, 'kind'>,
): NotificationItem {
  return {
    id: 'n1',
    userId: 'u1',
    title: 'Test',
    body: null,
    data: null,
    readAt: null,
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

describe('resolveNotificationDeeplink', () => {
  it('prefers an explicit deeplink from the data payload', () => {
    const n = makeNotification({
      kind: 'LESSON_PUBLISHED',
      data: { deeplink: '/custom/path', lessonId: 'abc' },
    });
    expect(resolveNotificationDeeplink(n)).toBe('/custom/path');
  });

  it('falls back to data.url when deeplink is absent', () => {
    const n = makeNotification({
      kind: 'PAYMENT_FAILED',
      data: { url: '/settings/billing?focus=invoice' },
    });
    expect(resolveNotificationDeeplink(n)).toBe(
      '/settings/billing?focus=invoice',
    );
  });

  it('routes enrollment requests to the teacher requests queue', () => {
    const n = makeNotification({ kind: 'ENROLLMENT_REQUESTED' });
    expect(resolveNotificationDeeplink(n)).toBe('/requests');
  });

  it('routes approved/rejected enrollment to my-courses', () => {
    expect(
      resolveNotificationDeeplink(
        makeNotification({ kind: 'ENROLLMENT_APPROVED' }),
      ),
    ).toBe('/my-courses');
    expect(
      resolveNotificationDeeplink(
        makeNotification({ kind: 'ENROLLMENT_REJECTED' }),
      ),
    ).toBe('/my-courses');
  });

  it('routes payments to billing and trial/past-due to subscription', () => {
    expect(
      resolveNotificationDeeplink(
        makeNotification({ kind: 'PAYMENT_SUCCEEDED' }),
      ),
    ).toBe('/settings/billing');
    expect(
      resolveNotificationDeeplink(makeNotification({ kind: 'TRIAL_ENDING' })),
    ).toBe('/settings/subscription');
    expect(
      resolveNotificationDeeplink(
        makeNotification({ kind: 'SUBSCRIPTION_PAST_DUE' }),
      ),
    ).toBe('/settings/subscription');
  });

  it('uses lessonId for published lessons, else my-courses', () => {
    expect(
      resolveNotificationDeeplink(
        makeNotification({
          kind: 'LESSON_PUBLISHED',
          data: { lessonId: 'lesson-9' },
        }),
      ),
    ).toBe('/lessons/lesson-9');
    expect(
      resolveNotificationDeeplink(
        makeNotification({ kind: 'LESSON_PUBLISHED' }),
      ),
    ).toBe('/my-courses');
  });

  it('routes live notifications to the session when present', () => {
    expect(
      resolveNotificationDeeplink(
        makeNotification({
          kind: 'LIVE_STARTED',
          data: { sessionId: 'sess-1' },
        }),
      ),
    ).toBe('/live/sess-1');
    expect(
      resolveNotificationDeeplink(
        makeNotification({
          kind: 'LIVE_REMINDER',
          data: { liveSessionId: 'sess-2' },
        }),
      ),
    ).toBe('/live/sess-2');
    expect(
      resolveNotificationDeeplink(makeNotification({ kind: 'LIVE_STARTED' })),
    ).toBe('/schedule');
  });

  it('routes homework assigned/graded with ids', () => {
    expect(
      resolveNotificationDeeplink(
        makeNotification({
          kind: 'HOMEWORK_ASSIGNED',
          data: { assignmentId: 'a-1' },
        }),
      ),
    ).toBe('/homework/a-1');
    expect(
      resolveNotificationDeeplink(
        makeNotification({
          kind: 'HOMEWORK_GRADED',
          data: { submissionId: 's-1' },
        }),
      ),
    ).toBe('/submissions/s-1');
    expect(
      resolveNotificationDeeplink(
        makeNotification({ kind: 'AI_REVIEW_READY' }),
      ),
    ).toBe('/homework');
  });

  it('routes gamification/level-up kinds to achievements', () => {
    expect(
      resolveNotificationDeeplink(makeNotification({ kind: 'LEVEL_UP' })),
    ).toBe('/achievements');
    expect(
      resolveNotificationDeeplink(
        makeNotification({ kind: 'ACHIEVEMENT_UNLOCKED' }),
      ),
    ).toBe('/achievements');
  });

  it('falls back to generic ids for unknown kinds', () => {
    expect(
      resolveNotificationDeeplink(
        makeNotification({ kind: 'SOME_FUTURE_KIND', data: { groupId: 'g1' } }),
      ),
    ).toBe('/groups/g1');
  });

  it('returns null when no destination can be derived', () => {
    expect(
      resolveNotificationDeeplink(
        makeNotification({ kind: 'SOME_FUTURE_KIND' }),
      ),
    ).toBeNull();
  });
});

describe('toLocaleHref', () => {
  it('prefixes a locale-relative path with the active locale', () => {
    expect(toLocaleHref('/requests', 'uz')).toBe('/uz/requests');
  });

  it('does not double-prefix an already localized path', () => {
    expect(toLocaleHref('/uz/requests', 'uz')).toBe('/uz/requests');
    expect(toLocaleHref('/en/lessons/1', 'uz')).toBe('/en/lessons/1');
  });

  it('normalizes paths without a leading slash', () => {
    expect(toLocaleHref('schedule', 'ru')).toBe('/ru/schedule');
  });

  it('leaves external URLs untouched', () => {
    expect(toLocaleHref('https://bilgim.uz/help', 'uz')).toBe(
      'https://bilgim.uz/help',
    );
  });
});

describe('getNotificationKindMeta', () => {
  it('returns specific meta for known kinds', () => {
    expect(getNotificationKindMeta('PAYMENT_FAILED').tone).toBe('red');
    expect(getNotificationKindMeta('AI_REVIEW_READY').tone).toBe('purple');
  });

  it('falls back to a default for unknown kinds', () => {
    const meta = getNotificationKindMeta('TOTALLY_NEW');
    expect(meta.tone).toBe('blue');
    expect(meta.icon).toBeDefined();
  });
});
