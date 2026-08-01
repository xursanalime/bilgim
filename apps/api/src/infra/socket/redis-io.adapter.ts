import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { ServerOptions } from 'socket.io';
import Redis from 'ioredis';

import { ConfigService } from '@nestjs/config';
import type { EnvConfig } from '../../config/config.module';

/**
 * `RedisIoAdapter` — wires the Socket.io `@socket.io/redis-adapter`
 * pub/sub adapter into Nest's gateway bootstrap.
 *
 * Without this, every `server.to(room).emit(...)` call (live chat,
 * DM, group chat) only reaches sockets connected to the *same* API
 * pod. In a single-pod dev setup this is invisible; the moment the
 * API scales past one replica (or a rolling deploy briefly runs two),
 * half the connected clients silently stop receiving broadcasts. The
 * Redis adapter fans every emit out through pub/sub so all pods see
 * it, using a *separate* ioredis connection pair (dedicated pub/sub
 * clients, not `RedisService`'s shared client, since pub/sub mode
 * takes over the whole connection).
 */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private pubClient?: Redis;
  private subClient?: Redis;

  constructor(private readonly app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const config = this.app.get(ConfigService<EnvConfig, true>);
    const redisUrl = config.get('REDIS_URL', { infer: true });

    this.pubClient = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.subClient = this.pubClient.duplicate();

    await Promise.all([
      new Promise<void>((resolve, reject) => {
        this.pubClient!.once('ready', resolve);
        this.pubClient!.once('error', reject);
      }),
      new Promise<void>((resolve, reject) => {
        this.subClient!.once('ready', resolve);
        this.subClient!.once('error', reject);
      }),
    ]);

    this.adapterConstructor = createAdapter(this.pubClient, this.subClient);
  }

  override createIOServer(port: number, options?: ServerOptions): unknown {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}
