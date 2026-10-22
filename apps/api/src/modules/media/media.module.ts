import { Global, Inject, Module, OnModuleInit } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { ImageProcessor } from './application/image-processor';
import { OBJECT_STORAGE, type ObjectStorage } from './domain';
import { MemoryStorage } from './infrastructure/memory-storage';
import { S3Storage } from './infrastructure/s3-storage';
import { logger } from '../../common/logging/logger';

@Global()
@Module({
  providers: [
    ImageProcessor,
    {
      provide: OBJECT_STORAGE,
      inject: [ENV],
      useFactory: (env: Env): ObjectStorage =>
        env.STORAGE_DRIVER === 'memory' ? new MemoryStorage() : new S3Storage(env),
    },
  ],
  exports: [ImageProcessor, OBJECT_STORAGE],
})
export class MediaModule implements OnModuleInit {
  constructor(@Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage) {}

  async onModuleInit() {
    try {
      await this.storage.ensureReady();
    } catch (error) {
      // Storage being down must not stop the storefront; uploads will fail with a clear error instead.
      logger.error({ err: error }, 'object storage not ready');
    }
  }
}
