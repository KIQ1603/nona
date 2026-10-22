import 'reflect-metadata';
import { createApp } from './app.factory';
import { loadEnv } from './config/env';
import { logger } from './common/logging/logger';

async function bootstrap() {
  const env = loadEnv();
  const app = await createApp();
  await app.listen(env.API_PORT);
  logger.info({ port: env.API_PORT }, 'api listening');
}

bootstrap().catch((error) => {
  logger.fatal({ err: error }, 'api failed to start');
  process.exit(1);
});
