import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';

import {
  BREACH_NOTIFICATION_DEADLINE_HOURS,
  BreachNotification,
  BreachNotificationCreateInput,
  BreachNotificationStatus,
} from './incident.types';

/**
 * `BreachNotificationService` — Task 30.6, Req 32.7.
 *
 * Manages the GDPR-mandated 72-hour breach notification lifecycle.
 * Tracks deadlines, records when authorities and users are notified,
 * and flags overdue notifications.
 *
 * The service is an in-memory store for now; a persistent adapter
 * (Prisma) can be injected later via a port interface.
 */
@Injectable()
export class BreachNotificationService {
  private readonly logger = new Logger(BreachNotificationService.name);

  /** In-memory store — replace with DB adapter in production. */
  private readonly notifications = new Map<string, BreachNotification>();

  // ─── Public API ─────────────────────────────────────────────────

  /**
   * Create a new breach notification record. Automatically calculates
   * the 72-hour deadline from the current time.
   */
  createNotification(input: BreachNotificationCreateInput): BreachNotification {
    const now = Date.now();
    const deadline = now + BREACH_NOTIFICATION_DEADLINE_HOURS * 60 * 60 * 1000;

    const notification: BreachNotification = {
      id: randomUUID(),
      incidentId: input.incidentId,
      breachType: input.breachType,
      dataCategories: input.dataCategories,
      affectedUserCount: input.affectedUserCount,
      affectedUserIds: input.affectedUserIds,
      consequences: input.consequences,
      mitigationMeasures: input.mitigationMeasures,
      status: BreachNotificationStatus.PENDING,
      deadline,
      authorityNotifiedAt: null,
      usersNotifiedAt: null,
      deadlineMet: null,
      createdAt: now,
      updatedAt: now,
    };

    this.notifications.set(notification.id, notification);
    this.logger.warn(
      `Breach notification created: id=${notification.id}, incident=${input.incidentId}, deadline=${new Date(deadline).toISOString()}`,
    );

    return notification;
  }

  /**
   * Record that the supervisory authority has been notified.
   */
  notifyAuthority(notificationId: string): BreachNotification | null {
    const notification = this.notifications.get(notificationId);
    if (!notification) return null;

    const now = Date.now();
    notification.authorityNotifiedAt = now;
    notification.status = BreachNotificationStatus.AUTHORITY_NOTIFIED;
    notification.deadlineMet = now <= notification.deadline;
    notification.updatedAt = now;

    this.logger.log(
      `Authority notified for breach ${notificationId}, within deadline: ${notification.deadlineMet}`,
    );

    return notification;
  }

  /**
   * Record that affected users have been notified.
   */
  notifyUsers(notificationId: string): BreachNotification | null {
    const notification = this.notifications.get(notificationId);
    if (!notification) return null;

    const now = Date.now();
    notification.usersNotifiedAt = now;
    notification.status = BreachNotificationStatus.USERS_NOTIFIED;
    notification.updatedAt = now;

    this.logger.log(
      `Users notified for breach ${notificationId}, affected count: ${notification.affectedUserCount}`,
    );

    // If authority was already notified, mark as completed
    if (notification.authorityNotifiedAt) {
      notification.status = BreachNotificationStatus.COMPLETED;
    }

    return notification;
  }

  /**
   * Mark the notification as fully completed.
   */
  complete(notificationId: string): BreachNotification | null {
    const notification = this.notifications.get(notificationId);
    if (!notification) return null;

    notification.status = BreachNotificationStatus.COMPLETED;
    notification.updatedAt = Date.now();

    return notification;
  }

  /**
   * Check all pending notifications for deadline breaches.
   * Returns notifications that have exceeded the 72-hour window.
   */
  checkDeadlines(): BreachNotification[] {
    const now = Date.now();
    const overdue: BreachNotification[] = [];

    for (const notification of this.notifications.values()) {
      if (
        notification.status === BreachNotificationStatus.PENDING &&
        now > notification.deadline
      ) {
        notification.status = BreachNotificationStatus.OVERDUE;
        notification.deadlineMet = false;
        notification.updatedAt = now;
        overdue.push(notification);

        this.logger.error(
          `BREACH NOTIFICATION OVERDUE: id=${notification.id}, incident=${notification.incidentId}`,
        );
      }
    }

    return overdue;
  }

  /**
   * Get a notification by ID.
   */
  getNotification(id: string): BreachNotification | null {
    return this.notifications.get(id) ?? null;
  }

  /**
   * Get all notifications for a given incident.
   */
  getByIncident(incidentId: string): BreachNotification[] {
    return Array.from(this.notifications.values()).filter(
      (n) => n.incidentId === incidentId,
    );
  }

  /**
   * Get remaining time until deadline (in milliseconds).
   * Returns negative value if deadline has passed.
   */
  getRemainingTime(notificationId: string): number | null {
    const notification = this.notifications.get(notificationId);
    if (!notification) return null;
    return notification.deadline - Date.now();
  }

  /**
   * Get all notifications (for admin dashboard).
   */
  getAll(): BreachNotification[] {
    return Array.from(this.notifications.values());
  }
}
