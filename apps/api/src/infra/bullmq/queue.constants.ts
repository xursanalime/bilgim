/**
 * BullMQ queue name constants.
 * Each queue corresponds to an async worker type.
 */
export const QUEUE_NAMES = {
  EMAIL: 'email',
  TELEGRAM: 'telegram',
  PUSH: 'push',
  TRANSCODING: 'transcoding',
  AI_GRADING: 'ai-grading',
  NOTIFICATION_FANOUT: 'notification-fanout',
  OUTBOX_DISPATCH: 'outbox-dispatch',
  /**
   * Live-session recording orchestration. Receives `live.started` and
   * `live.ended` outbox events and drives the `RecorderPort` lifecycle
   * (Req 9.5, 9.6, 9.7, 9.8). Kept separate from `notification-fanout`
   * so a recording job is never starved by a slow notification batch
   * (and vice versa) — and so BullMQ's "one consumer per job" model
   * does not pit the two processors against each other.
   */
  LIVE_RECORDING: 'live-recording',
  /**
   * Internal work queue owned by `GamificationProcessor` — `award-xp` /
   * `check-badges` jobs pushed by `GamificationService` itself (not
   * outbox events). Keep `GAMIFICATION_OUTBOX` (below) off this queue:
   * two `@Processor` classes on one queue are competing consumers in
   * BullMQ, not broadcast listeners, so mixing the two job shapes here
   * would silently drop whichever type loses the race.
   */
  GAMIFICATION: 'gamification',
  /**
   * Outbox → `GamificationOutboxProcessor` relay. Deliberately separate
   * from `GAMIFICATION` above (see its docstring) and from
   * `NOTIFICATION_FANOUT` (see that processor's docstring) — this is
   * the third leg of the same "one queue, one consumer" constraint.
   */
  GAMIFICATION_OUTBOX: 'gamification-outbox',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** All queue names as an array (for dynamic registration) */
export const ALL_QUEUE_NAMES: QueueName[] = Object.values(QUEUE_NAMES);
