import { Logger } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import {
  Notification,
  NotificationChannel,
  NotificationKind,
  PrismaClient,
} from '@prisma/client';

import { QUEUE_NAMES } from '../../../infra/bullmq/queue.constants';
import { NotificationsService } from '../notifications.service';
import { NotificationRepository } from '../repositories/notification.repository';

/**
 * Job payload pushed by `OutboxDispatcher` onto `notification-fanout`.
 *
 * `topic` is the original outbox topic (e.g. `lesson.published`); `payload`
 * is whatever the producer module emitted; `outboxEventId` and
 * `idempotencyKey` are propagated for traceability.
 */
export interface NotificationFanoutJob {
  topic: string;
  payload: Record<string, unknown>;
  outboxEventId?: string;
  idempotencyKey?: string;
}

interface ResolvedTemplate {
  kind: NotificationKind;
  title: string;
  body: string;
  data?: Record<string, unknown> | undefined;
}

interface DeliveryEnqueue {
  notificationId: string;
  userId: string;
  kind: NotificationKind;
  channel: NotificationChannel;
  title: string;
  body: string;
  data?: Record<string, unknown> | undefined;
}

/**
 * NotificationFanoutProcessor — multi-channel fan-out worker (Req 16.1, 16.2,
 * 16.4, 16.5).
 *
 * Responsibilities:
 *   1. Translate domain events (`lesson.published`, `enrollment.approved`,
 *      `payment.succeeded`, `schedule.changed`) into a recipient list and a
 *      Notification template.
 *   2. Idempotently insert one `Notification` per recipient using a
 *      deterministic `idempotencyKey` (Req 16.4).
 *   3. Look up each recipient's `(kind, channel)` preference matrix and, for
 *      each enabled channel, enqueue a delivery job onto the matching
 *      delivery queue (Req 16.1).
 *
 * Idempotency: the same outbox event re-delivered N times produces exactly
 * `|recipients|` Notification rows because:
 *   - the Notification insert is `ON CONFLICT (idempotencyKey) DO NOTHING`,
 *   - the per-channel delivery job uses `jobId = "{notifId}:{channel}"`, so
 *     BullMQ's own dedup (`jobId` is unique within a queue while the job is
 *     not removed) prevents the same delivery from being enqueued twice.
 *
 * Unhandled topics are logged and skipped (the job succeeds so BullMQ does
 * not retry forever).
 */
@Processor(QUEUE_NAMES.NOTIFICATION_FANOUT)
export class NotificationFanoutProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationFanoutProcessor.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly notificationsService: NotificationsService,
    private readonly notificationRepository: NotificationRepository,
    @InjectQueue(QUEUE_NAMES.EMAIL) private readonly emailQueue: Queue,
    @InjectQueue(QUEUE_NAMES.TELEGRAM) private readonly telegramQueue: Queue,
    @InjectQueue(QUEUE_NAMES.PUSH) private readonly pushQueue: Queue,
    @InjectQueue(QUEUE_NAMES.SMS) private readonly smsQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<NotificationFanoutJob>): Promise<{
    topic: string;
    notificationsCreated: number;
    deliveriesEnqueued: number;
  }> {
    const { topic, payload } = job.data;
    this.logger.debug(
      `Fan-out job ${job.id} topic="${topic}" outboxEventId=${job.data.outboxEventId ?? 'n/a'}`,
    );

    const recipients = await this.resolveRecipients(topic, payload);
    if (recipients.length === 0) {
      this.logger.debug(
        `No recipients for topic "${topic}" (skipped or unsupported)`,
      );
      return { topic, notificationsCreated: 0, deliveriesEnqueued: 0 };
    }

    let notificationsCreated = 0;
    const deliveryQueue: DeliveryEnqueue[] = [];

    for (const r of recipients) {
      const idempotencyKey = this.buildIdempotencyKey(topic, payload, r.userId);
      const { notification, created } =
        await this.notificationsService.createNotification({
          userId: r.userId,
          kind: r.template.kind,
          title: r.template.title,
          body: r.template.body,
          data: r.template.data ?? null,
          idempotencyKey,
        });
      if (created) notificationsCreated += 1;

      const channels = await this.notificationsService.resolveChannelsForUser(
        r.userId,
        r.template.kind,
      );
      for (const channel of [
        'EMAIL',
        'TELEGRAM',
        'PUSH',
        'SMS',
      ] as NotificationChannel[]) {
        if (!channels[channel]) continue;
        deliveryQueue.push({
          notificationId: notification.id,
          userId: r.userId,
          kind: r.template.kind,
          channel,
          title: r.template.title,
          body: r.template.body,
          data: r.template.data,
        });
      }

      // IN_APP is always-on (Task 14.3 / Req 16.1) — the Notification row
      // IS the in-app delivery, so we record one as SENT immediately,
      // independent of the preference matrix.
      await this.notificationRepository.upsertDelivery({
        notificationId: notification.id,
        channel: 'IN_APP',
        status: 'SENT',
      });
      this.notificationsService.recordDispatch?.(
        r.template.kind,
        'IN_APP',
        'SENT',
      );
    }

    let deliveriesEnqueued = 0;
    for (const delivery of deliveryQueue) {
      const enqueued = await this.enqueueDelivery(delivery);
      if (enqueued) deliveriesEnqueued += 1;
    }

    this.logger.log(
      `Fan-out topic="${topic}" recipients=${recipients.length} ` +
        `notifications_created=${notificationsCreated} ` +
        `deliveries_enqueued=${deliveriesEnqueued}`,
    );

    return {
      topic,
      notificationsCreated,
      deliveriesEnqueued,
    };
  }

  // ==================================================================
  // Recipient + template resolution
  // ==================================================================

  private async resolveRecipients(
    topic: string,
    payload: Record<string, unknown>,
  ): Promise<Array<{ userId: string; template: ResolvedTemplate }>> {
    switch (topic) {
      case 'lesson.published':
        return this.recipientsForLessonPublished(payload);
      case 'enrollment.requested':
        return this.recipientsForEnrollmentRequested(payload);
      case 'enrollment.approved':
        return this.recipientsForEnrollmentApproved(payload);
      case 'payment.succeeded':
        return this.recipientsForPaymentSucceeded(payload);
      case 'schedule.changed':
        return this.recipientsForScheduleChanged(payload);
      case 'homework.assigned':
        return this.recipientsForHomeworkAssigned(payload);
      case 'homework.graded':
        return this.recipientsForHomeworkGraded(payload);
      case 'speaking.scoring_failed':
        return this.recipientsForSpeakingScoringFailed(payload);
      default:
        this.logger.warn(
          `Topic "${topic}" not yet wired into NotificationFanoutProcessor (skipping)`,
        );
        return [];
    }
  }

  private async recipientsForLessonPublished(
    payload: Record<string, unknown>,
  ): Promise<Array<{ userId: string; template: ResolvedTemplate }>> {
    const lessonId = payload.lessonId as string | undefined;
    const groupId = payload.groupId as string | undefined;
    if (!lessonId || !groupId) {
      this.logger.warn(
        `lesson.published payload missing lessonId/groupId: ${JSON.stringify(payload)}`,
      );
      return [];
    }

    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { id: true, title: true, groupId: true },
    });
    if (!lesson) {
      this.logger.warn(`lesson.published lesson ${lessonId} not found`);
      return [];
    }

    const enrollments = await this.prisma.enrollment.findMany({
      where: { groupId, status: 'APPROVED' },
      select: { studentId: true },
    });

    return enrollments.map((e) => ({
      userId: e.studentId,
      template: {
        kind: 'LESSON_PUBLISHED' as NotificationKind,
        title: 'Yangi dars chiqdi',
        body: `Yangi dars: "${lesson.title}"`,
        data: { lessonId: lesson.id, groupId: lesson.groupId },
      },
    }));
  }

  private async recipientsForEnrollmentRequested(
    payload: Record<string, unknown>,
  ): Promise<Array<{ userId: string; template: ResolvedTemplate }>> {
    const teacherId = payload.teacherId as string | undefined;
    const groupId = payload.groupId as string | undefined;
    if (!teacherId) {
      this.logger.warn(
        `enrollment.requested payload missing teacherId: ${JSON.stringify(payload)}`,
      );
      return [];
    }
    const groupName = groupId
      ? (await this.prisma.group.findUnique({
          where: { id: groupId },
          select: { name: true },
        }))?.name ?? null
      : null;

    return [
      {
        userId: teacherId,
        template: {
          kind: 'ENROLLMENT_REQUESTED' as NotificationKind,
          title: "Yangi qo'shilish so'rovi",
          body: groupName
            ? `"${groupName}" guruhiga yangi qo'shilish so'rovi keldi`
            : "Guruhingizga yangi qo'shilish so'rovi keldi",
          data: {
            groupId: groupId ?? null,
            studentId: payload.studentId ?? null,
            enrollmentRequestId: payload.enrollmentRequestId ?? null,
          },
        },
      },
    ];
  }

  private async recipientsForEnrollmentApproved(
    payload: Record<string, unknown>,
  ): Promise<Array<{ userId: string; template: ResolvedTemplate }>> {
    const studentId = payload.studentId as string | undefined;
    const groupId = payload.groupId as string | undefined;
    if (!studentId) {
      this.logger.warn(
        `enrollment.approved payload missing studentId: ${JSON.stringify(payload)}`,
      );
      return [];
    }
    const groupName = groupId
      ? (await this.prisma.group.findUnique({
          where: { id: groupId },
          select: { name: true },
        }))?.name ?? null
      : null;

    return [
      {
        userId: studentId,
        template: {
          kind: 'ENROLLMENT_APPROVED' as NotificationKind,
          title: "Ro'yxatdan o'tish tasdiqlandi",
          body: groupName
            ? `Siz "${groupName}" guruhiga qo'shildingiz`
            : "Siz guruhga qo'shildingiz",
          data: {
            groupId: groupId ?? null,
            enrollmentId: payload.enrollmentId ?? null,
            enrollmentRequestId: payload.enrollmentRequestId ?? null,
          },
        },
      },
    ];
  }

  private async recipientsForPaymentSucceeded(
    payload: Record<string, unknown>,
  ): Promise<Array<{ userId: string; template: ResolvedTemplate }>> {
    const studentId = payload.studentId as string | null | undefined;
    const teacherId = payload.teacherId as string | null | undefined;
    const recipient = (studentId ?? teacherId) as string | undefined;
    if (!recipient) {
      this.logger.warn(
        `payment.succeeded payload has no studentId/teacherId: ${JSON.stringify(payload)}`,
      );
      return [];
    }
    const amount = payload.amountUzs as number | undefined;

    return [
      {
        userId: recipient,
        template: {
          kind: 'PAYMENT_SUCCEEDED' as NotificationKind,
          title: "To'lov muvaffaqiyatli",
          body: amount
            ? `${amount.toLocaleString('uz-UZ')} so'm to'lovingiz qabul qilindi`
            : "To'lovingiz qabul qilindi",
          data: {
            paymeId: payload.paymeId ?? null,
            invoiceId: payload.invoiceId ?? null,
            amountUzs: amount ?? null,
          },
        },
      },
    ];
  }

  private async recipientsForScheduleChanged(
    payload: Record<string, unknown>,
  ): Promise<Array<{ userId: string; template: ResolvedTemplate }>> {
    const groupId = payload.groupId as string | undefined;
    if (!groupId) {
      this.logger.warn(
        `schedule.changed payload missing groupId: ${JSON.stringify(payload)}`,
      );
      return [];
    }
    const enrollments = await this.prisma.enrollment.findMany({
      where: { groupId, status: 'APPROVED' },
      select: { studentId: true },
    });
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: { name: true },
    });

    return enrollments.map((e) => ({
      userId: e.studentId,
      template: {
        kind: 'SCHEDULE_CHANGED' as NotificationKind,
        title: "Jadval o'zgardi",
        body: group
          ? `"${group.name}" guruhi jadvalida o'zgarish`
          : 'Jadvalda o\'zgarish',
        data: {
          groupId,
          version: payload.version ?? null,
        },
      },
    }));
  }

  /**
   * `homework.assigned` — emitted from `AssignmentService.publish`
   * (Task 17.3). Mirrors the lesson.published shape: every APPROVED
   * student of the lesson's group receives one HOMEWORK_ASSIGNED
   * notification. The idempotency key uses `assignmentId` so a
   * worker retry produces zero new rows.
   */
  private async recipientsForHomeworkAssigned(
    payload: Record<string, unknown>,
  ): Promise<Array<{ userId: string; template: ResolvedTemplate }>> {
    const assignmentId = payload.assignmentId as string | undefined;
    const groupId = payload.groupId as string | undefined;
    const lessonId = payload.lessonId as string | undefined;
    const title = (payload.title as string | undefined) ?? null;
    if (!assignmentId || !groupId) {
      this.logger.warn(
        `homework.assigned payload missing assignmentId/groupId: ${JSON.stringify(payload)}`,
      );
      return [];
    }

    const enrollments = await this.prisma.enrollment.findMany({
      where: { groupId, status: 'APPROVED' },
      select: { studentId: true },
    });

    return enrollments.map((e) => ({
      userId: e.studentId,
      template: {
        kind: 'HOMEWORK_ASSIGNED' as NotificationKind,
        title: 'Yangi uy vazifa',
        body: title ? `Yangi uy vazifa: "${title}"` : 'Yangi uy vazifa berildi',
        data: {
          assignmentId,
          groupId,
          lessonId: lessonId ?? null,
        },
      },
    }));
  }

  /**
   * `homework.graded` — emitted from `SubmissionService.grade`
   * (Task 18.1). Produces one HOMEWORK_GRADED notification for the
   * single owning student of the submission. The fan-out is intentionally
   * 1:1 (not a group broadcast) — only the student who submitted should
   * be notified about their grade.
   *
   * The idempotency key (`homework.graded:{submissionId}:{userId}`) is
   * stable across retries, so a re-played outbox event creates zero
   * new rows.
   */
  private async recipientsForHomeworkGraded(
    payload: Record<string, unknown>,
  ): Promise<Array<{ userId: string; template: ResolvedTemplate }>> {
    const submissionId = payload.submissionId as string | undefined;
    const studentId = payload.studentId as string | undefined;
    const score = payload.score as number | undefined;
    const totalPoints = payload.totalPoints as number | undefined;
    if (!submissionId || !studentId) {
      this.logger.warn(
        `homework.graded payload missing submissionId/studentId: ${JSON.stringify(payload)}`,
      );
      return [];
    }

    const body =
      score !== undefined && totalPoints !== undefined
        ? `Sizning uy vazifangiz baholandi: ${score}/${totalPoints}`
        : 'Sizning uy vazifangiz baholandi';

    return [
      {
        userId: studentId,
        template: {
          kind: 'HOMEWORK_GRADED' as NotificationKind,
          title: 'Uy vazifa baholandi',
          body,
          data: {
            submissionId,
            assignmentId: payload.assignmentId ?? null,
            score: score ?? null,
            totalPoints: totalPoints ?? null,
          },
        },
      },
    ];
  }

  /**
   * `speaking.scoring_failed` — emitted from
   * `SpeakingScoringService.markScoringFailed` when audio AI scoring
   * exhausts its retries (Task 4.3, Req 7.5). Produces a single
   * instructor-facing notification prompting a manual review of the
   * recording. The kind reuses `AI_REVIEW_READY` — the instructor's
   * attention is required on an AI-grading outcome — rather than adding a
   * new NotificationKind (the schema is frozen for this task).
   *
   * The idempotency key (`speaking.scoring_failed:{submissionId}:{userId}`)
   * keeps a replayed outbox event to zero new rows.
   */
  private async recipientsForSpeakingScoringFailed(
    payload: Record<string, unknown>,
  ): Promise<Array<{ userId: string; template: ResolvedTemplate }>> {
    const submissionId = payload.submissionId as string | undefined;
    const teacherId = payload.teacherId as string | undefined;
    if (!submissionId || !teacherId) {
      this.logger.warn(
        `speaking.scoring_failed payload missing submissionId/teacherId: ${JSON.stringify(payload)}`,
      );
      return [];
    }

    return [
      {
        userId: teacherId,
        template: {
          kind: 'AI_REVIEW_READY' as NotificationKind,
          title: 'Nutq topshirig‘ini qo‘lda baholang',
          body: 'Avtomatik baholash amalga oshmadi. Iltimos, audio javobni qo‘lda baholang.',
          data: {
            submissionId,
            assignmentId: payload.assignmentId ?? null,
            studentId: payload.studentId ?? null,
            reason: 'AI_SCORING_FAILED',
          },
        },
      },
    ];
  }

  // ==================================================================
  // Idempotency keys
  // ==================================================================

  /**
   * Per-recipient idempotency keys. The shape `{topic}:{primaryRef}:{userId}`
   * (or `{topic}:{primaryRef}:v{version}:{userId}` for schedule changes) is
   * referenced from the design doc so that hand-written tests can predict
   * the values. Producers that re-emit the same outbox event will hit the
   * `ON CONFLICT DO NOTHING` branch in the repository.
   */
  private buildIdempotencyKey(
    topic: string,
    payload: Record<string, unknown>,
    userId: string,
  ): string {
    switch (topic) {
      case 'lesson.published':
        return `lesson.published:${payload.lessonId}:${userId}`;
      case 'enrollment.requested':
        return `enrollment.requested:${payload.enrollmentRequestId ?? 'unknown'}:${userId}`;
      case 'enrollment.approved':
        return `enrollment.approved:${payload.enrollmentRequestId ?? payload.enrollmentId ?? 'unknown'}:${userId}`;
      case 'payment.succeeded':
        return `payment.succeeded:${payload.paymeId ?? payload.paymeTxId ?? 'unknown'}:${userId}`;
      case 'schedule.changed':
        return `schedule.changed:${payload.groupId}:v${payload.version ?? 1}:${userId}`;
      case 'homework.assigned':
        return `homework.assigned:${payload.assignmentId}:${userId}`;
      case 'homework.graded':
        return `homework.graded:${payload.submissionId}:${userId}`;
      case 'speaking.scoring_failed':
        return `speaking.scoring_failed:${payload.submissionId}:${userId}`;
      default:
        return `${topic}:${userId}`;
    }
  }

  // ==================================================================
  // Per-channel delivery enqueue
  // ==================================================================

  private async enqueueDelivery(delivery: DeliveryEnqueue): Promise<boolean> {
    const jobId = `${delivery.notificationId}:${delivery.channel}`;
    const baseJob = {
      notificationId: delivery.notificationId,
      userId: delivery.userId,
      kind: delivery.kind,
      title: delivery.title,
      body: delivery.body,
      data: delivery.data ?? null,
    };

    try {
      switch (delivery.channel) {
        case 'EMAIL':
          await this.emailQueue.add(
            'notification.email',
            { ...baseJob, channel: 'EMAIL' },
            { jobId },
          );
          await this.notificationRepository.upsertDelivery({
            notificationId: delivery.notificationId,
            channel: 'EMAIL',
            status: 'QUEUED',
          });
          this.notificationsService.recordDispatch?.(
            delivery.kind,
            'EMAIL',
            'QUEUED',
          );
          return true;
        case 'TELEGRAM':
          await this.telegramQueue.add(
            'notification.telegram',
            { ...baseJob, channel: 'TELEGRAM' },
            { jobId },
          );
          await this.notificationRepository.upsertDelivery({
            notificationId: delivery.notificationId,
            channel: 'TELEGRAM',
            status: 'QUEUED',
          });
          this.notificationsService.recordDispatch?.(
            delivery.kind,
            'TELEGRAM',
            'QUEUED',
          );
          return true;
        case 'PUSH':
          await this.pushQueue.add(
            'notification.push',
            { ...baseJob, channel: 'PUSH' },
            { jobId },
          );
          await this.notificationRepository.upsertDelivery({
            notificationId: delivery.notificationId,
            channel: 'PUSH',
            status: 'QUEUED',
          });
          this.notificationsService.recordDispatch?.(
            delivery.kind,
            'PUSH',
            'QUEUED',
          );
          return true;
        case 'SMS':
          await this.smsQueue.add(
            'notification.sms',
            { ...baseJob, channel: 'SMS' },
            { jobId },
          );
          await this.notificationRepository.upsertDelivery({
            notificationId: delivery.notificationId,
            channel: 'SMS',
            status: 'QUEUED',
          });
          this.notificationsService.recordDispatch?.(
            delivery.kind,
            'SMS',
            'QUEUED',
          );
          return true;
        case 'IN_APP':
          // IN_APP has no delivery queue — the Notification row is the delivery.
          return false;
        default:
          this.logger.warn(`Unknown channel "${delivery.channel}", skipping`);
          return false;
      }
    } catch (error) {
      this.logger.error(
        `Failed to enqueue ${delivery.channel} delivery for notification ${delivery.notificationId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      return false;
    }
  }
}
