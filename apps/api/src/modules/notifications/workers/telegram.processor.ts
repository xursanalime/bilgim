import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';

import { EnvConfig } from '../../../config/config.module';
import { QUEUE_NAMES } from '../../../infra/bullmq/queue.constants';
import { NotificationsService } from '../notifications.service';
import { NotificationRepository } from '../repositories/notification.repository';

export interface TelegramJob {
  notificationId: string;
  userId: string;
  kind: string;
  channel: 'TELEGRAM';
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
  /**
   * If the producer already knows the chat id (e.g. from a prior bot
   * /start binding) it can be passed directly. Otherwise the worker
   * resolves it from the user's profile (TODO: Phase 5/6 chat-id binding).
   */
  telegramChatId?: string;
}

/**
 * TelegramProcessor — sends notifications via the Telegram Bot API
 * (Req 16.5, 16.6).
 *
 * Endpoint: `https://api.telegram.org/bot{TOKEN}/sendMessage`. Returns
 * `{ ok: true, result: { message_id: number, ... } }` on success; we
 * persist `result.message_id` into `NotificationDelivery.providerRef`.
 *
 * Chat-id resolution is stubbed for now — the platform will attach a
 * `telegramChatId` to `User` once the Phase 5 bot /start handler ships.
 * For Phase 1 we log and mark the delivery `FAILED` (with a clear error)
 * when no chat id is available.
 */
@Processor(QUEUE_NAMES.TELEGRAM)
export class TelegramProcessor extends WorkerHost {
  private readonly logger = new Logger(TelegramProcessor.name);

  constructor(
    private readonly notificationRepository: NotificationRepository,
    private readonly configService: ConfigService<EnvConfig, true>,
    private readonly notificationsService: NotificationsService,
  ) {
    super();
  }

  async process(job: Job<TelegramJob>): Promise<{ messageId: number | null }> {
    const data = job.data;
    const token = this.configService.get('TELEGRAM_BOT_TOKEN', { infer: true });
    if (!token) {
      this.logger.warn(
        `Telegram job ${job.id}: TELEGRAM_BOT_TOKEN not configured, marking FAILED`,
      );
      await this.notificationRepository.upsertDelivery({
        notificationId: data.notificationId,
        channel: 'TELEGRAM',
        status: 'FAILED',
        attempt: job.attemptsMade + 1,
        errorMsg: 'Telegram bot token not configured',
      });
      this.notificationsService.recordDispatch?.(data.kind, 'TELEGRAM', 'FAILED');
      this.notificationsService.recordFailure?.(
        data.kind,
        'TELEGRAM',
        'provider_unavailable',
      );
      return { messageId: null };
    }

    const chatId = await this.resolveChatId(data);
    if (!chatId) {
      this.logger.warn(
        `Telegram job ${job.id}: TODO: resolve user's chat id (user=${data.userId}); marking FAILED`,
      );
      await this.notificationRepository.upsertDelivery({
        notificationId: data.notificationId,
        channel: 'TELEGRAM',
        status: 'FAILED',
        attempt: job.attemptsMade + 1,
        errorMsg: 'Telegram chat id not bound to user',
      });
      this.notificationsService.recordDispatch?.(data.kind, 'TELEGRAM', 'FAILED');
      this.notificationsService.recordFailure?.(
        data.kind,
        'TELEGRAM',
        'chat_id_missing',
      );
      return { messageId: null };
    }

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const text = `*${this.escapeMarkdown(data.title)}*\n\n${this.escapeMarkdown(data.body)}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'MarkdownV2',
          disable_web_page_preview: true,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Telegram API ${response.status}: ${errorText.slice(0, 200)}`,
        );
      }

      const json = (await response.json()) as {
        ok: boolean;
        result?: { message_id: number };
        description?: string;
      };
      if (!json.ok || !json.result) {
        throw new Error(
          `Telegram API returned ok=false: ${json.description ?? 'unknown'}`,
        );
      }

      await this.notificationRepository.upsertDelivery({
        notificationId: data.notificationId,
        channel: 'TELEGRAM',
        status: 'SENT',
        attempt: job.attemptsMade + 1,
        providerRef: String(json.result.message_id),
      });
      this.notificationsService.recordDispatch?.(data.kind, 'TELEGRAM', 'SENT');

      this.logger.log(
        `Telegram message sent (notification=${data.notificationId} chat=${chatId} message_id=${json.result.message_id})`,
      );
      return { messageId: json.result.message_id };
    } catch (error) {
      const message = (error as Error).message;
      const willRetry = job.attemptsMade + 1 < (job.opts.attempts ?? 1);

      await this.notificationRepository.upsertDelivery({
        notificationId: data.notificationId,
        channel: 'TELEGRAM',
        status: willRetry ? 'PENDING_RETRY' : 'FAILED',
        attempt: job.attemptsMade + 1,
        errorMsg: message,
      });
      this.notificationsService.recordDispatch?.(
        data.kind,
        'TELEGRAM',
        willRetry ? 'PENDING_RETRY' : 'FAILED',
      );
      // Final retry exhausted → bump the dedicated terminal-failure
      // counter (Task 24.3, Req 26.2). The reason classifier maps the
      // upstream error onto the small stable label set the dashboard
      // uses.
      if (!willRetry) {
        this.notificationsService.recordFailure?.(
          data.kind,
          'TELEGRAM',
          classifyTelegramFailure(message),
        );
      }
      this.logger.warn(
        `Telegram send failed for notification ${data.notificationId} (attempt ${job.attemptsMade + 1}): ${message}`,
      );
      throw error;
    }
  }

  /**
   * TODO (Phase 5): once the bot /start handler binds a `telegramChatId`
   * to the `User` row, look it up here. For now, accept an explicit chat
   * id from the job payload (used by tests + admin tools) or return null.
   */
  private async resolveChatId(data: TelegramJob): Promise<string | null> {
    if (data.telegramChatId) return data.telegramChatId;
    return null;
  }

  /**
   * Escape Telegram MarkdownV2 reserved characters per
   * https://core.telegram.org/bots/api#markdownv2-style — content was
   * paraphrased for compliance with licensing restrictions.
   */
  private escapeMarkdown(s: string): string {
    return s.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (m) => `\\${m}`);
  }
}

/**
 * Map a Telegram bot API failure message into the stable `reason`
 * label set used by `edubridge_notification_failed_total{reason}`
 * (Task 24.3, Req 26.2).
 *
 * Reason set:
 *   - `upstream_5xx`        — Telegram returned a 5xx (server-side).
 *   - `chat_id_missing`     — bot can't reach the chat (chat not found,
 *                             bot was kicked / blocked).
 *   - `provider_unavailable` — DNS / network / TLS / Telegram-side rate
 *                             limit (429).
 *   - `unknown`             — any other terminal failure.
 */
export function classifyTelegramFailure(message: string): string {
  if (!message) return 'unknown';
  const lower = message.toLowerCase();
  if (
    lower.includes('chat not found') ||
    lower.includes('bot was blocked') ||
    lower.includes('user is deactivated') ||
    lower.includes('chat_id') ||
    lower.includes('peer_id_invalid')
  ) {
    return 'chat_id_missing';
  }
  if (/\btelegram api 5\d{2}\b/.test(lower) || /\b5\d{2}\b/.test(lower)) {
    return 'upstream_5xx';
  }
  if (
    lower.includes('429') ||
    lower.includes('too many requests') ||
    lower.includes('econnrefused') ||
    lower.includes('etimedout') ||
    lower.includes('enotfound') ||
    lower.includes('handshake') ||
    lower.includes('tls') ||
    lower.includes('socket')
  ) {
    return 'provider_unavailable';
  }
  return 'unknown';
}
