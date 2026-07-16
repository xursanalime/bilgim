import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

import { EnvConfig } from '../../../config/config.module';
import { QUEUE_NAMES } from '../../../infra/bullmq/queue.constants';
import { NotificationsService } from '../notifications.service';
import { NotificationRepository } from '../repositories/notification.repository';

export interface EmailJob {
  notificationId: string;
  userId: string;
  kind: string;
  channel: 'EMAIL';
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
}

/**
 * Outbox-style job pushed by `OutboxDispatcher` for transactional
 * topics like `user.registered` or `password.reset.requested`.
 *
 * Distinct from `EmailJob` (notification fan-out) — these jobs are
 * not associated with a `Notification` row. The processor renders a
 * topic-specific template and goes straight to SMTP.
 */
export interface OutboxEmailJob {
  outboxEventId: string;
  topic: string;
  payload: {
    userId?: string;
    email?: string;
    fullName?: string;
    token?: string;
    [key: string]: unknown;
  };
  idempotencyKey: string;
}

type IncomingJob = EmailJob | OutboxEmailJob;

function isOutboxJob(job: IncomingJob): job is OutboxEmailJob {
  return 'topic' in job && 'payload' in job;
}

/**
 * EmailProcessor — sends notification emails via SMTP / SES (Req 16.5, 16.6).
 *
 * Configuration (env): `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`,
 * `EMAIL_FROM`. The transport is built lazily on the first job so tests
 * never connect to a real SMTP server.
 *
 * Provider reference: on success we persist `info.messageId` into
 * `NotificationDelivery.providerRef` (Req 16.6).
 *
 * Retries: BullMQ provides exponential backoff out of the box (`attempts:
 * 3`, `backoff: { type: 'exponential', delay: 2000 }` in `BullMqModule`).
 * Any thrown error here is treated as a transient failure and BullMQ
 * automatically reschedules. Once `attemptsMade >= attempts` the job ends
 * up in the failed set and we mark the delivery row as `FAILED`.
 */
@Processor(QUEUE_NAMES.EMAIL)
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);
  private transporter: Transporter | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly notificationRepository: NotificationRepository,
    private readonly configService: ConfigService<EnvConfig, true>,
    private readonly notificationsService: NotificationsService,
  ) {
    super();
  }

  async process(job: Job<IncomingJob>): Promise<{ messageId: string | null }> {
    const data = job.data;

    // Outbox-style topic job (verification, password reset, etc.)
    if (isOutboxJob(data)) {
      return this.processOutboxJob(job as Job<OutboxEmailJob>);
    }

    // Look up the recipient's email. Missing user → permanent failure.
    const user = await this.prisma.user.findUnique({
      where: { id: data.userId },
      select: { email: true, locale: true },
    });
    if (!user) {
      this.logger.warn(
        `Email job ${job.id}: user ${data.userId} not found, marking delivery FAILED`,
      );
      await this.notificationRepository.upsertDelivery({
        notificationId: data.notificationId,
        channel: 'EMAIL',
        status: 'FAILED',
        attempt: job.attemptsMade,
        errorMsg: 'User not found',
      });
      this.notificationsService.recordDispatch?.(data.kind, 'EMAIL', 'FAILED');
      // Terminal failure — user lookup failed and no retry will fix it.
      this.notificationsService.recordFailure?.(
        data.kind,
        'EMAIL',
        'user_not_found',
      );
      return { messageId: null };
    }

    const transporter = this.getTransporter();
    const from = this.configService.get('EMAIL_FROM', { infer: true });

    try {
      const info = await transporter.sendMail({
        from,
        to: user.email,
        subject: data.title,
        text: data.body,
        html: this.buildHtml(data.title, data.body),
      });

      await this.notificationRepository.upsertDelivery({
        notificationId: data.notificationId,
        channel: 'EMAIL',
        status: 'SENT',
        attempt: job.attemptsMade + 1,
        providerRef: info.messageId ?? null,
      });
      this.notificationsService.recordDispatch?.(data.kind, 'EMAIL', 'SENT');

      this.logger.log(
        `Email sent to ${user.email} (notification=${data.notificationId} messageId=${info.messageId ?? 'n/a'})`,
      );
      return { messageId: info.messageId ?? null };
    } catch (error) {
      const message = (error as Error).message;
      const willRetry = job.attemptsMade + 1 < (job.opts.attempts ?? 1);

      await this.notificationRepository.upsertDelivery({
        notificationId: data.notificationId,
        channel: 'EMAIL',
        status: willRetry ? 'PENDING_RETRY' : 'FAILED',
        attempt: job.attemptsMade + 1,
        errorMsg: message,
      });
      this.notificationsService.recordDispatch?.(
        data.kind,
        'EMAIL',
        willRetry ? 'PENDING_RETRY' : 'FAILED',
      );

      // Final retry exhausted → bump the dedicated terminal-failure
      // counter so on-call can alert on a sudden failure ratio without
      // slicing the noisier `notifications_dispatched_total` series
      // (Task 24.3, Req 26.2).
      if (!willRetry) {
        this.notificationsService.recordFailure?.(
          data.kind,
          'EMAIL',
          classifyEmailFailure(message),
        );
      }

      this.logger.warn(
        `Email send failed for notification ${data.notificationId} (attempt ${job.attemptsMade + 1}/${job.opts.attempts ?? 1}): ${message}`,
      );
      // Re-throw → BullMQ schedules a retry per backoff settings.
      throw error;
    }
  }

  /**
   * Process outbox-style transactional emails (registration verification,
   * password reset). Renders a template based on `topic` and sends
   * directly via SMTP — no `Notification` row is involved.
   */
  private async processOutboxJob(
    job: Job<OutboxEmailJob>,
  ): Promise<{ messageId: string | null }> {
    const { topic, payload } = job.data;
    const email = typeof payload.email === 'string' ? payload.email : null;
    const fullName =
      typeof payload.fullName === 'string' ? payload.fullName : 'foydalanuvchi';
    const token = typeof payload.token === 'string' ? payload.token : null;

    if (!email) {
      this.logger.warn(
        `Outbox email job ${job.id} (topic=${topic}): missing email payload, skipping`,
      );
      return { messageId: null };
    }

    const tpl = this.renderOutboxTemplate(topic, { fullName, token });
    if (!tpl) {
      this.logger.warn(
        `Outbox email job ${job.id} (topic=${topic}): no template, skipping`,
      );
      return { messageId: null };
    }

    const transporter = this.getTransporter();
    const from = this.configService.get('EMAIL_FROM', { infer: true });

    try {
      const info = await transporter.sendMail({
        from,
        to: email,
        subject: tpl.subject,
        text: tpl.text,
        html: tpl.html,
        // Deliverability headers — reduce spam-folder classification and
        // give well-behaved clients a one-click unsubscribe affordance.
        replyTo: from,
        headers: {
          'X-Entity-Ref-ID': job.data.outboxEventId,
          'X-Mailer': 'Bilgim',
          'List-Unsubscribe': '<mailto:unsubscribe@bilgim.uz>',
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          Precedence: 'transactional',
        },
      });
      this.logger.log(
        `Outbox email sent topic=${topic} to=${email} messageId=${info.messageId ?? 'n/a'}`,
      );
      return { messageId: info.messageId ?? null };
    } catch (error) {
      this.logger.warn(
        `Outbox email send failed topic=${topic} to=${email}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /**
   * Build the subject/text/html for transactional outbox emails. Returns
   * null when the topic is not rendered as an email (e.g. notification
   * fan-out should never reach this branch).
   */
  private renderOutboxTemplate(
    topic: string,
    ctx: { fullName: string; token: string | null },
  ): { subject: string; text: string; html: string } | null {
    const appUrl =
      this.configService.get('APP_URL', { infer: true }) ??
      'http://localhost:3000';

    if (topic === 'user.registered') {
      const url = ctx.token
        ? `${appUrl}/uz/verify-email?token=${encodeURIComponent(ctx.token)}`
        : `${appUrl}/uz/verify-email`;
      const subject = 'Bilgim — emailingizni tasdiqlang';
      const text = [
        `Salom, ${ctx.fullName}!`,
        '',
        'Bilgim platformasiga xush kelibsiz.',
        'Akkauntingizni faollashtirish uchun quyidagi havolani bosing:',
        url,
        '',
        'Havola 24 soat davomida amal qiladi.',
        "Agar siz ro'yxatdan o'tmagan bo'lsangiz, bu xabarni e'tiborsiz qoldiring.",
        '',
        '— Bilgim jamoasi',
      ].join('\n');
      return { subject, text, html: this.buildVerifyHtml(ctx.fullName, url) };
    }

    if (topic === 'password.reset.requested') {
      const url = ctx.token
        ? `${appUrl}/uz/reset-password?token=${encodeURIComponent(ctx.token)}`
        : `${appUrl}/uz/forgot-password`;
      const subject = 'Bilgim — parolni tiklash';
      const text = [
        `Salom, ${ctx.fullName}!`,
        '',
        'Parolingizni tiklash uchun quyidagi havolani bosing:',
        url,
        '',
        'Havola 1 soat davomida amal qiladi.',
        'Agar so\'rovni siz yubormagan bo\'lsangiz, bu xabarni e\'tiborsiz qoldiring.',
        '',
        '— Bilgim jamoasi',
      ].join('\n');
      return { subject, text, html: this.buildResetHtml(ctx.fullName, url) };
    }

    return null;
  }

  private buildVerifyHtml(fullName: string, url: string): string {
    const safeName = this.escapeHtml(fullName);
    const safeUrl = this.escapeHtml(url);
    return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#F5F5F7;font-family:-apple-system,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F5F7;padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.04),0 24px 64px -24px rgba(0,0,0,.12);">
        <tr><td style="padding:40px 40px 0 40px;">
          <div style="display:inline-block;background:linear-gradient(135deg,#667EEA 0%,#764BA2 50%,#AF52DE 100%);width:48px;height:48px;border-radius:14px;text-align:center;line-height:48px;color:#fff;font-weight:800;letter-spacing:-0.04em;">EB</div>
        </td></tr>
        <tr><td style="padding:24px 40px 8px 40px;">
          <h1 style="margin:0;font-size:24px;font-weight:800;letter-spacing:-0.02em;color:#1D1D1F;">Emailingizni tasdiqlang</h1>
        </td></tr>
        <tr><td style="padding:0 40px 24px 40px;color:#6E6E73;font-size:15px;line-height:1.6;">
          <p style="margin:8px 0;">Salom, <strong style="color:#1D1D1F;">${safeName}</strong>!</p>
          <p style="margin:8px 0;">Bilgim platformasiga xush kelibsiz. Akkauntingizni faollashtirish uchun quyidagi tugmani bosing.</p>
        </td></tr>
        <tr><td align="center" style="padding:8px 40px 24px 40px;">
          <a href="${safeUrl}" style="display:inline-block;background:#0071E3;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:14px;font-size:15px;box-shadow:0 8px 24px -8px rgba(0,113,227,.5);">Emailni tasdiqlash</a>
        </td></tr>
        <tr><td style="padding:0 40px 24px 40px;color:#6E6E73;font-size:13px;line-height:1.5;">
          <p style="margin:8px 0;">Yoki havolani brauzeringizga nusxalang:<br/>
            <a href="${safeUrl}" style="color:#0071E3;word-break:break-all;">${safeUrl}</a>
          </p>
          <p style="margin:8px 0;color:#AEAEB2;font-size:12px;">Havola 24 soat davomida amal qiladi.</p>
        </td></tr>
        <tr><td style="padding:24px 40px;border-top:1px solid #E8E8ED;color:#AEAEB2;font-size:12px;text-align:center;">
          © ${new Date().getFullYear()} Bilgim · O'zbekiston uchun ta'lim platformasi
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  }

  private buildResetHtml(fullName: string, url: string): string {
    const safeName = this.escapeHtml(fullName);
    const safeUrl = this.escapeHtml(url);
    return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#F5F5F7;font-family:-apple-system,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F5F7;padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.04),0 24px 64px -24px rgba(0,0,0,.12);">
        <tr><td style="padding:40px 40px 0 40px;">
          <div style="display:inline-block;background:linear-gradient(135deg,#667EEA 0%,#764BA2 50%,#AF52DE 100%);width:48px;height:48px;border-radius:14px;text-align:center;line-height:48px;color:#fff;font-weight:800;letter-spacing:-0.04em;">EB</div>
        </td></tr>
        <tr><td style="padding:24px 40px 8px 40px;">
          <h1 style="margin:0;font-size:24px;font-weight:800;letter-spacing:-0.02em;color:#1D1D1F;">Parolni tiklash</h1>
        </td></tr>
        <tr><td style="padding:0 40px 24px 40px;color:#6E6E73;font-size:15px;line-height:1.6;">
          <p style="margin:8px 0;">Salom, <strong style="color:#1D1D1F;">${safeName}</strong>!</p>
          <p style="margin:8px 0;">Parolingizni tiklash uchun quyidagi tugmani bosing.</p>
        </td></tr>
        <tr><td align="center" style="padding:8px 40px 24px 40px;">
          <a href="${safeUrl}" style="display:inline-block;background:#0071E3;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:14px;font-size:15px;box-shadow:0 8px 24px -8px rgba(0,113,227,.5);">Parolni tiklash</a>
        </td></tr>
        <tr><td style="padding:0 40px 24px 40px;color:#6E6E73;font-size:13px;line-height:1.5;">
          <p style="margin:8px 0;">Yoki havolani brauzeringizga nusxalang:<br/>
            <a href="${safeUrl}" style="color:#0071E3;word-break:break-all;">${safeUrl}</a>
          </p>
          <p style="margin:8px 0;color:#AEAEB2;font-size:12px;">Havola 1 soat davomida amal qiladi. Agar so&apos;rovni siz yubormagan bo&apos;lsangiz, e&apos;tiborsiz qoldiring.</p>
        </td></tr>
        <tr><td style="padding:24px 40px;border-top:1px solid #E8E8ED;color:#AEAEB2;font-size:12px;text-align:center;">
          © ${new Date().getFullYear()} Bilgim
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  }

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;
    const host = this.configService.get('SMTP_HOST', { infer: true });
    const port = this.configService.get('SMTP_PORT', { infer: true });
    const user = this.configService.get('SMTP_USER', { infer: true });
    const pass = this.configService.get('SMTP_PASS', { infer: true });

    this.transporter = nodemailer.createTransport({
      host,
      port,
      // STARTTLS for non-465 ports; implicit TLS for 465.
      secure: port === 465,
      auth: user && pass ? { user, pass } : undefined,
    });
    this.logger.log(
      `SMTP transporter initialised host=${host} port=${port} secure=${port === 465}`,
    );
    return this.transporter;
  }

  private buildHtml(title: string, body: string): string {
    const safeTitle = this.escapeHtml(title);
    const safeBody = this.escapeHtml(body);
    return `<!DOCTYPE html>
<html><body style="font-family: -apple-system, Helvetica, Arial, sans-serif; padding: 16px;">
<h2 style="margin: 0 0 12px 0;">${safeTitle}</h2>
<p style="margin: 0; color: #333; line-height: 1.5;">${safeBody}</p>
<hr style="margin-top: 24px; border: 0; border-top: 1px solid #eee;" />
<p style="font-size: 12px; color: #999;">Bilgim</p>
</body></html>`;
  }

  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

/**
 * Map an SMTP / nodemailer error message into the small, stable
 * `reason` label set used by the
 * `bilgim_notification_failed_total{reason}` counter
 * (Task 24.3, Req 26.2). Cardinality is bounded — anything we
 * cannot recognise becomes `unknown`.
 *
 * Reason set:
 *   - `upstream_5xx`        — the SMTP server returned a 5xx code
 *                             (permanent failure on the relay's side).
 *   - `provider_unavailable` — connection refused / DNS / TLS handshake
 *                             failures that look infrastructural.
 *   - `unknown`             — any other terminal failure.
 */
export function classifyEmailFailure(message: string): string {
  if (!message) return 'unknown';
  const lower = message.toLowerCase();
  if (/\b5\d{2}\b/.test(lower) || lower.includes('5xx')) return 'upstream_5xx';
  if (
    lower.includes('econnrefused') ||
    lower.includes('etimedout') ||
    lower.includes('enotfound') ||
    lower.includes('connection') ||
    lower.includes('handshake') ||
    lower.includes('tls') ||
    lower.includes('socket')
  ) {
    return 'provider_unavailable';
  }
  return 'unknown';
}
