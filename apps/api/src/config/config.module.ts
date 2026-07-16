import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { envSchema, EnvConfig } from './env.schema';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
      validate: (config: Record<string, unknown>) => {
        const parsed = envSchema.safeParse(config);
        if (!parsed.success) {
          const formatted = parsed.error.format();
          throw new Error(
            `❌ Invalid environment variables:\n${JSON.stringify(formatted, null, 2)}`,
          );
        }
        return parsed.data;
      },
    }),
  ],
  exports: [NestConfigModule],
})
export class AppConfigModule {}

export { EnvConfig };
