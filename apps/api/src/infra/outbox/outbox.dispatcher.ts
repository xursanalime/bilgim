import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { withTraceJobOptions } from '../../common/observability';
import { QUEUE_NAMES } from '../bullmq/queue.constants';
import { MetricsService } from '../metrics/metrics.service';

/** Outbox event status constants */
export const OUTBOX_STATUS = {
  PENDING: 'PENDING',
  DISPATCHED: 'DISPATCHED',
  DEAD_LETTER: 'DEAD_LETTER',
} as const;

/** Maximum number of retry attempts before marking as DEAD_LETTER */
const MAX_ATTEMPTS = 10;

/** Batch size for polling */
const POLL_BATCH_SIZE = 50;

/** Polling interval in milliseconds (2 seconds per spec) */
const POLL_INTERVAL_MS = 2_000;

/**
 * Exponential backoff formula: 5 * 5^attempt seconds
 * attempt 1 → 5s, attempt 2 → 25s, attempt 3 → 125s, attempt 4 → 625s, ...
 */
const BACKOFF_BASE_SECONDS = 5;
const BACKOFF_MULTIPLIER = 5;

/**
 * Maps outbox event topics to BullMQ queue names.
 * Add new topic → queue mappings here as new event types are introduced.
 *
 * A topic may map to one OR more queue names. When multiple queues are
 * listed, the dispatcher fans the job out to all of them — this is how
 * `live.started` / `live.ended` reach both the notification fan-out
 * worker (so students get the live-started push) and the
 * recording-orchestration worker (so the recorder lifecycle runs).
 */
const TOPIC_TO_QUEUE: Record<string, string | readonly string[]> = {
  // Auth events
  'user.registered': QUEUE_NAMES.EMAIL,
  'user.email_verified': QUEUE_NAMES.EMAIL,
  'password.reset.requested': QUEUE_NAMES.EMAIL,
  'auth.login': QUEUE_NAMES.NOTIFICATION_FANOUT,

  // Billing events
  'payment.succeeded': QUEUE_NAMES.NOTIFICATION_FANOUT,
  'payment.failed': QUEUE_NAMES.NOTIFICATION_FANOUT,
  'subscription.activated': QUEUE_NAMES.NOTIFICATION_FANOUT,

  // Catalog events
  'lesson.published': QUEUE_NAMES.NOTIFICATION_FANOUT,
  'schedule.changed': QUEUE_NAMES.NOTIFICATION_FANOUT,

  // Enrollment events
  'enrollment.requested': QUEUE_NAMES.NOTIFICATION_FANOUT,
  'enrollment.approved': QUEUE_NAMES.NOTIFICATION_FANOUT,

  // Live events — fan out to BOTH the notification queue (student
  // alerts) AND the recording queue (recorder lifecycle).
  'live.started': [
    QUEUE_NAMES.NOTIFICATION_FANOUT,
    QUEUE_NAMES.LIVE_RECORDING,
  ],
  'live.ended': [
    QUEUE_NAMES.NOTIFICATION_FANOUT,
    QUEUE_NAMES.LIVE_RECORDING,
  ],
  'recording.ready': QUEUE_NAMES.NOTIFICATION_FANOUT,

  // Homework events
  'submission.created': QUEUE_NAMES.AI_GRADING,
  'submission.graded': QUEUE_NAMES.NOTIFICATION_FANOUT,
  'submission.submitted': QUEUE_NAMES.NOTIFICATION_FANOUT,
  // Notification-bearing homework topics emitted by the homework +
  // speaking modules. `homework.graded` is reused by the speaking
  // finalize-grade path (Req 15.3); `speaking.scoring_failed` notifies
  // the instructor when audio AI scoring exhausts its retries (Req 7.5).
  'homework.assigned': QUEUE_NAMES.NOTIFICATION_FANOUT,
  'homework.graded': QUEUE_NAMES.NOTIFICATION_FANOUT,
  'speaking.scoring_failed': QUEUE_NAMES.NOTIFICATION_FANOUT,

  // AI & Catalog
  'ai.tutor_used': QUEUE_NAMES.NOTIFICATION_FANOUT,
  'lesson.viewed': QUEUE_NAMES.NOTIFICATION_FANOUT,

  // Notification events
  'notification.email': QUEUE_NAMES.EMAIL,
  'notification.telegram': QUEUE_NAMES.TELEGRAM,
  'notification.push': QUEUE_NAMES.PUSH,
};

/**
 * Lightweight health interface for the outbox dispatcher (Task 24.3).
 * Consumed by the readiness probe — keeps the controller free of
 * the dispatcher's full surface area (Prisma, BullMQ queues).
 */
export interface OutboxDispatcherHealth {
  /**
   * Returns true while the polling loop is wired to a live timer.
   * Used by `/health/ready` to flip the pod out of rotation when
   * the dispatcher has crashed but the HTTP server is still up.
   */
  isHealthy(): boolean;
}

/**
 * OutboxDispatcher polls the OutboxEvent table for PENDING events and dispatches
 * them to the appropriate BullMQ queues based on topic. Implements exponential
 * backoff on failure (5 * 5^attempt seconds). After 10 failed attempts, marks
 * the event as DEAD_LETTER.
 *
 * Polling interval: every 2 seconds via setInterval.
 *
 * Requirements: 18.2, 18.3
 */
@Injectable()
export class OutboxDispatcher
  implements OnModuleInit, OnModuleDestroy, OutboxDispatcherHealth
{
  private readonly logger = new Logger(OutboxDispatcher.name);
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private isProcessing = false;

  constructor(
    private readonly prisma: PrismaClient,
    @InjectQueue(QUEUE_NAMES.EMAIL) private readonly emailQueue: Queue,
    @InjectQueue(QUEUE_NAMES.TELEGRAM) private readonly telegramQueue: Queue,
    @InjectQueue(QUEUE_NAMES.PUSH) private readonly pushQueue: Queue,
    @InjectQueue(QUEUE_NAMES.TRANSCODING) private readonly transcodingQueue: Queue,
    @InjectQueue(QUEUE_NAMES.AI_GRADING) private readonly aiGradingQueue: Queue,
    @InjectQueue(QUEUE_NAMES.NOTIFICATION_FANOUT) private readonly notificationFanoutQueue: Queue,
    @InjectQueue(QUEUE_NAMES.OUTBOX_DISPATCH) private readonly outboxDispatchQueue: Queue,
    @InjectQueue(QUEUE_NAMES.LIVE_RECORDING) private readonly liveRecordingQueue: Queue,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  /**
   * `OutboxDispatcherHealth.isHealthy` — readiness probe support.
   * The dispatcher is considered healthy while the polling timer is
   * wired (i.e. between `onModuleInit` and `onModuleDestroy`).
   */
  isHealthy(): boolean {
    return this.pollTimer !== null;
  }

  onModuleInit(): void {
    this.logger.log(
      `Starting outbox dispatcher (poll interval: ${POLL_INTERVAL_MS}ms, max attempts: ${MAX_ATTEMPTS})`,
    );
    this.pollTimer = setInterval(() => {
      void this.poll();
    }, POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.logger.log('Outbox dispatcher stopped');
  }

  /**
   * Poll for pending outbox events and dispatch them.
   * Uses a lock flag to prevent concurrent polling within the same instance.
   */
  private async poll(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const events = await this.prisma.outboxEvent.findMany({
        where: {
          status: OUTBOX_STATUS.PENDING,
          nextAttemptAt: { lte: new Date() },
        },
        orderBy: { createdAt: 'asc' },
        take: POLL_BATCH_SIZE,
      });

      // Update the pending-events gauge so Prometheus / alerting can
      // catch backlogs (Task 24.3, Req 26.6). We count every PENDING
      // row, not just the slice we picked up this tick — otherwise the
      // gauge would oscillate by the batch size on every poll.
      if (this.metrics) {
        try {
          const pending = await this.prisma.outboxEvent.count({
            where: { status: OUTBOX_STATUS.PENDING },
          });
          this.metrics.setOutboxPending(pending);
        } catch (err) {
          // Gauge is best-effort — never let a metrics failure abort
          // the dispatch loop.
          this.logger.debug(
            `Outbox gauge update failed: ${(err as Error).message}`,
          );
        }
      }

      if (events.length === 0) return;

      this.logger.debug(`Polling: found ${events.length} pending outbox events`);

      for (const event of events) {
        await this.dispatch(event);
      }
    } catch (error) {
      this.logger.error(
        `Outbox poll error: ${(error as Error).message}`,
        (error as Error).stack,
      );
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Dispatch a single outbox event to the appropriate BullMQ queue(s).
   *
   * A topic may map to one or many queue names. The event is fanned
   * out to every queue and only marked DISPATCHED once all enqueues
   * succeed — partial failures bubble up to the retry/backoff branch.
   */
  private async dispatch(event: {
    id: string;
    topic: string;
    payload: unknown;
    attempt: number;
    idempotencyKey: string;
  }): Promise<void> {
    const mapping = TOPIC_TO_QUEUE[event.topic];
    const queueNames: string[] = Array.isArray(mapping)
      ? [...mapping]
      : mapping
        ? [mapping]
        : [];

    if (queueNames.length === 0) {
      this.logger.warn(
        `No queue mapping for topic "${event.topic}", marking as DEAD_LETTER`,
      );
      await this.markDeadLetter(event.id, `No queue mapping for topic: ${event.topic}`);
      return;
    }

    try {
      for (const queueName of queueNames) {
        const queue = this.getQueue(queueName);
        if (!queue) {
          throw new Error(
            `Queue "${queueName}" is not registered for topic "${event.topic}"`,
          );
        }

        // The dispatcher runs as a background poller — the originating
        // request's trace id has been long since lost when we get
        // here. We still pass through `withTraceJobOptions` for
        // symmetry with HTTP-context producers (Task 24.3) but with
        // `null` so the helper is a no-op. If the OutboxEvent ever
        // grows a stored `traceId` column we can plumb it here without
        // touching the dispatch contract.
        await queue.add(
          event.topic,
          {
            outboxEventId: event.id,
            topic: event.topic,
            payload: event.payload,
            idempotencyKey: event.idempotencyKey,
          },
          withTraceJobOptions(undefined, null),
        );

        this.logger.debug(
          `Dispatched outbox event ${event.id} (topic: ${event.topic}) to queue "${queueName}"`,
        );
      }

      // Mark as dispatched only after every fan-out target accepted the job.
      await this.prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: OUTBOX_STATUS.DISPATCHED,
          dispatchedAt: new Date(),
        },
      });
    } catch (error) {
      const nextAttempt = event.attempt + 1;
      const errorMessage = (error as Error).message;

      if (nextAttempt >= MAX_ATTEMPTS) {
        await this.markDeadLetter(event.id, errorMessage);
        this.logger.error(
          `Outbox event ${event.id} moved to DEAD_LETTER after ${MAX_ATTEMPTS} attempts: ${errorMessage}`,
        );
      } else {
        // Exponential backoff: 5 * 5^attempt seconds
        // attempt 1 → 5s, attempt 2 → 25s, attempt 3 → 125s, ...
        const backoffSeconds =
          BACKOFF_BASE_SECONDS * Math.pow(BACKOFF_MULTIPLIER, nextAttempt - 1);
        const nextAttemptAt = new Date(Date.now() + backoffSeconds * 1000);

        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            attempt: nextAttempt,
            nextAttemptAt,
            lastError: errorMessage,
          },
        });

        this.logger.warn(
          `Outbox event ${event.id} dispatch failed (attempt ${nextAttempt}/${MAX_ATTEMPTS}), ` +
            `next retry in ${backoffSeconds}s at ${nextAttemptAt.toISOString()}: ${errorMessage}`,
        );
      }
    }
  }

  /**
   * Mark an outbox event as permanently failed (dead letter).
   * After MAX_ATTEMPTS retries, the event is moved to DEAD_LETTER status.
   */
  private async markDeadLetter(eventId: string, error: string): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { id: eventId },
      data: {
        status: OUTBOX_STATUS.DEAD_LETTER,
        lastError: error,
      },
    });
  }

  /**
   * Resolve a queue name to the corresponding BullMQ Queue instance.
   */
  private getQueue(queueName: string | undefined): Queue | null {
    if (!queueName) return null;

    const queueMap: Record<string, Queue> = {
      [QUEUE_NAMES.EMAIL]: this.emailQueue,
      [QUEUE_NAMES.TELEGRAM]: this.telegramQueue,
      [QUEUE_NAMES.PUSH]: this.pushQueue,
      [QUEUE_NAMES.TRANSCODING]: this.transcodingQueue,
      [QUEUE_NAMES.AI_GRADING]: this.aiGradingQueue,
      [QUEUE_NAMES.NOTIFICATION_FANOUT]: this.notificationFanoutQueue,
      [QUEUE_NAMES.OUTBOX_DISPATCH]: this.outboxDispatchQueue,
      [QUEUE_NAMES.LIVE_RECORDING]: this.liveRecordingQueue,
    };

    return queueMap[queueName] ?? null;
  }
}
