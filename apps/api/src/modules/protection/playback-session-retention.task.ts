import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PlaybackSessionRepository } from './repositories/playback-session.repository';

/**
 * Default retention window (days) for forensic `PlaybackSession` rows when
 * `PLAYBACK_SESSION_RETENTION_DAYS` is not configured (Req 6.2).
 */
const DEFAULT_RETENTION_DAYS = 90;

/**
 * PlaybackSessionRetentionTask — prunes forensic `PlaybackSession` rows on a
 * daily schedule (content-protection-backend, Req 6.2).
 *
 * The repository already exposes `deleteIssuedBefore(cutoff)` and the
 * retention window is configured via `PLAYBACK_SESSION_RETENTION_DAYS`, but
 * nothing invoked the pruning. This task wires the two together: every day at
 * 03:00 it deletes sessions issued before `now - retentionDays` and logs the
 * number of rows removed.
 */
@Injectable()
export class PlaybackSessionRetentionTask {
  private readonly logger = new Logger(PlaybackSessionRetentionTask.name);

  constructor(
    private readonly config: ConfigService,
    private readonly playbackSessionRepository: PlaybackSessionRepository,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async pruneExpiredSessions(): Promise<void> {
    const retentionDays =
      this.config.get<number>('PLAYBACK_SESSION_RETENTION_DAYS') ??
      DEFAULT_RETENTION_DAYS;
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    try {
      const deleted =
        await this.playbackSessionRepository.deleteIssuedBefore(cutoff);
      this.logger.log(
        `Pruned ${deleted} playback session(s) issued before ${cutoff.toISOString()} ` +
          `(retention ${retentionDays}d)`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to prune playback sessions issued before ${cutoff.toISOString()}: ` +
          `${(error as Error).message}`,
      );
    }
  }
}
