import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { Job } from 'bullmq';

import { EnvConfig } from '../../../config/config.module';
import { QUEUE_NAMES } from '../../../infra/bullmq/queue.constants';
import { NotificationsService } from '../notifications.service';
import { NotificationRepository } from '../repositories/notification.repository';

export interface SmsJob {
  notificationId: string;
  userId: string;
  kind: string;
  channel: 'SMS';
  title: string;
  body: string;
  phoneNumber?: string; // Target phone number (e.g., '+998901234567')
}

/**
 * SmsProcessor — sends SMS notifications via the Eskiz.uz Gateway API (O'zbekiston-First).
 *
 * Implements JWT authentication caching, token refresh on 401, error persistence,
 * and Prometheus telemetry registration.
 */
@Processor(QUEUE_NAMES.SMS)
export class SmsProcessor extends WorkerHost {
  private readonly logger = new Logger(SmsProcessor.name);
  private cachedToken: string | null = null;
  private tokenExpiresAt: number = 0; // Epoch timestamp

  constructor(
    private readonly notificationRepository: NotificationRepository,
    private readonly configService: ConfigService<EnvConfig, true>,
    private readonly notificationsService: NotificationsService,
    private readonly prisma: PrismaClient,
  ) {
    super();
  }

  async process(job: Job<SmsJob>): Promise<{ success: boolean }> {
    const data = job.data;
    const phone = data.phoneNumber || (await this.resolveUserPhone(data.userId));

    if (!phone) {
      this.logger.warn(`SMS job ${job.id}: user ${data.userId} has no valid phone number. Marking FAILED`);
      await this.notificationRepository.upsertDelivery({
        notificationId: data.notificationId,
        channel: 'SMS',
        status: 'FAILED',
        attempt: job.attemptsMade + 1,
        errorMsg: 'User phone number missing',
      });
      this.notificationsService.recordDispatch(data.kind, 'SMS', 'FAILED');
      this.notificationsService.recordFailure(data.kind, 'SMS', 'phone_missing');
      return { success: false };
    }

    const email = this.configService.get('ESKIZ_EMAIL', { infer: true }) || 'info@bilgim.uz';
    const password = this.configService.get('ESKIZ_PASSWORD', { infer: true });

    if (!password) {
      this.logger.warn(`SMS job ${job.id}: ESKIZ_PASSWORD not configured. Logging and marking FAILED`);
      await this.notificationRepository.upsertDelivery({
        notificationId: data.notificationId,
        channel: 'SMS',
        status: 'FAILED',
        attempt: job.attemptsMade + 1,
        errorMsg: 'Eskiz SMS credentials not configured',
      });
      this.notificationsService.recordDispatch(data.kind, 'SMS', 'FAILED');
      this.notificationsService.recordFailure(data.kind, 'SMS', 'provider_unavailable');
      return { success: false };
    }

    try {
      const token = await this.getEskizToken(email, password);
      const success = await this.sendSms(token, phone, data.body);

      if (success) {
        await this.notificationRepository.upsertDelivery({
          notificationId: data.notificationId,
          channel: 'SMS',
          status: 'DELIVERED',
          attempt: job.attemptsMade + 1,
        });
        this.notificationsService.recordDispatch(data.kind, 'SMS', 'DELIVERED');
        return { success: true };
      } else {
        throw new Error('Eskiz gateway returned delivery failure');
      }
    } catch (err: any) {
      this.logger.error(`SMS job ${job.id} failed: ${err.message}`, err.stack);
      await this.notificationRepository.upsertDelivery({
        notificationId: data.notificationId,
        channel: 'SMS',
        status: 'FAILED',
        attempt: job.attemptsMade + 1,
        errorMsg: err.message,
      });
      this.notificationsService.recordDispatch(data.kind, 'SMS', 'FAILED');
      this.notificationsService.recordFailure(data.kind, 'SMS', 'upstream_error');
      throw err; // Trigger BullMQ retry
    }
  }

  /**
   * Fetches the user's phone number from StudentProfile or User table
   */
  private async resolveUserPhone(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true },
    });
    return user?.phone || null;
  }

  /**
   * Authenticates with Eskiz API, caching the token in memory
   */
  private async getEskizToken(email: string, password: string): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.tokenExpiresAt > now) {
      return this.cachedToken;
    }

    this.logger.log('Authenticating with Eskiz.uz SMS gateway...');
    const response = await fetch('https://notify.eskiz.uz/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Eskiz Auth failed with status ${response.status}: ${errBody}`);
    }

    const resData: any = await response.json();
    const token = resData?.data?.token;
    if (!token) {
      throw new Error('Eskiz auth response missing token field');
    }

    this.cachedToken = token;
    // Cache token for 20 days (Eskiz tokens usually last 30 days)
    this.tokenExpiresAt = now + 20 * 24 * 60 * 60 * 1000;
    return token;
  }

  /**
   * Sends the SMS through the Eskiz SMS send endpoint
   */
  private async sendSms(token: string, phone: string, text: string): Promise<boolean> {
    const formattedPhone = this.formatPhoneNumber(phone);
    const fromName = this.configService.get('ESKIZ_FROM_NAME', { infer: true }) || '4546'; // Default Eskiz testing shortcode

    this.logger.log(`Sending SMS to ${formattedPhone} via Eskiz.uz...`);
    const response = await fetch('https://notify.eskiz.uz/api/message/sms/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        mobile_phone: formattedPhone,
        message: text,
        from: fromName,
      }),
    });

    if (response.status === 401) {
      // Invalidate token cache on unauthorized so next run re-authenticates
      this.cachedToken = null;
      throw new Error('Eskiz returned 401 Unauthorized; token invalidated');
    }

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Eskiz send SMS failed with status ${response.status}: ${errBody}`);
    }

    const resData: any = await response.json();
    this.logger.log(`SMS sent successfully to ${formattedPhone}. Status: ${resData?.status}`);
    return resData?.status === 'waiting' || resData?.status === 'sent' || resData?.status === 'success';
  }

  /**
   * Formats local phone numbers to Eskiz format (998XXXXXXXXX)
   */
  private formatPhoneNumber(phone: string): string {
    // Strip everything except digits
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('8')) {
      cleaned = '998' + cleaned.substring(1);
    }
    if (!cleaned.startsWith('998') && cleaned.length === 9) {
      cleaned = '998' + cleaned;
    }
    return cleaned;
  }
}
