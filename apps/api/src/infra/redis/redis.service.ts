import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { EnvConfig } from '../../config/config.module';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor(private readonly config: ConfigService<EnvConfig, true>) {
    const redisUrl = this.config.get('REDIS_URL', { infer: true });
    this.client = new Redis(redisUrl, {
      maxRetriesPerRequest: null, // Required for BullMQ compatibility
      enableReadyCheck: true,
      retryStrategy: (times: number) => {
        if (times > 10) {
          this.logger.error('Redis connection failed after 10 retries');
          return null;
        }
        return Math.min(times * 200, 5000);
      },
    });

    this.client.on('connect', () => {
      this.logger.log('Redis connected');
    });

    this.client.on('error', (err) => {
      this.logger.error(`Redis error: ${err.message}`);
    });
  }

  /** Get the underlying ioredis client (for BullMQ connection sharing) */
  getClient(): Redis {
    return this.client;
  }

  /** Simple key-value get */
  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  /** Simple key-value set with optional TTL in seconds */
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  /** Delete a key */
  async del(key: string): Promise<number> {
    return this.client.del(key);
  }

  /** Check if a key exists */
  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result === 1;
  }

  /** Set a key only if it does not exist (for distributed locks / dedup) */
  async setnx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  /** Increment a key (for rate limiting counters) */
  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  /** Set expiry on an existing key */
  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.client.expire(key, ttlSeconds);
  }

  /** Publish a message to a Redis channel */
  async publish(channel: string, message: string): Promise<number> {
    return this.client.publish(channel, message);
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Closing Redis connection');
    await this.client.quit();
  }
}
