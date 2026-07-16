/**
 * BullMQ queue name constants.
 * Each queue corresponds to an async worker type.
 */
export const QUEUE_NAMES = {
  EMAIL: 'email',
  TELEGRAM: 'telegram',
  PUSH: 'push',
  SMS: 'sms',
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
  GAMIFICATION: 'gamification',
  /**
   * Speaking/pronunciation AI scoring (Phase 4, Req 7.3, 7.4). Receives
   * one `speaking.score` job per SUBMITTED audio submission and drives
   * the `SpeakingScoringPort` → produces a numeric score + structured
   * pronunciation/fluency feedback persisted as an AI_DRAFT Feedback
   * row. Kept separate from `ai-grading` (text homework precheck) so an
   * audio-scoring job — which may call a slower speech provider — never
   * starves the text grading queue, and vice versa.
   */
  SPEAKING_SCORING: 'speaking-scoring',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** All queue names as an array (for dynamic registration) */
export const ALL_QUEUE_NAMES: QueueName[] = Object.values(QUEUE_NAMES);
