import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { requestContext } from './common/http/request-context.middleware';
import { loadEnv } from './config/env';

/** Builds the configured app; shared by main.ts and e2e tests so they exercise the same wiring. */
export async function createApp(): Promise<NestExpressApplication> {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    logger: env.NODE_ENV === 'test' ? false : undefined,
  });
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(requestContext);
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: [env.WEB_ORIGIN],
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'],
    maxAge: 600,
  });
  app.setGlobalPrefix('v1');
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
  return app;
}
