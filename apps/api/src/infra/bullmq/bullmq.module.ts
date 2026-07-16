import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { EnvConfig } from '../../config/config.module';
import { ALL_QUEUE_NAMES } from './queue.constants';

@Global()
@Module({
  imports: [
    // Register BullMQ with shared Redis connection from env
    BullModule.forRootAsync({
      useFactory: (config: ConfigService<EnvConfig, true>) => {
        const redisUrl = config.get('REDIS_URL', { infer: true });
        const url = new URL(redisUrl);
        return {
          connection: {
            host: url.hostname,
            port: Number(url.port) || 6379,
            password: url.password || undefined,
            db: url.pathname ? Number(url.pathname.slice(1)) || 0 : 0,
          },
        };
      },
      inject: [ConfigService],
    }),
    // Register all queues
    ...ALL_QUEUE_NAMES.map((name) =>
      BullModule.registerQueue({
        name,
        defaultJobOptions: {
          removeOnComplete: { count: 1000 },
          removeOnFail: { count: 5000 },
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
        },
      }),
    ),
  ],
  exports: [BullModule],
})
export class BullMqModule {}
