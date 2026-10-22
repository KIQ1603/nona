import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../../config/env';
import { AuditService } from '../../audit/application/audit.service';
import { ImageProcessor } from '../../media/application/image-processor';
import { OBJECT_STORAGE, type ObjectStorage } from '../../media/domain';

interface Actor {
  userId: string;
  requestId?: string;
}

/**
 * Artwork supplied by the shop for NONA Custom: charm pictures (hat pictures are product images attached to a variant).
 * Whatever the admin uploads (SVG, PNG, big photos) is normalised here, so the editor and the stored
 * previews always work with small, transparent, bounded images.
 */
@Injectable()
export class CustomAssetsService {
  private readonly mediaBase: string;
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ImageProcessor) private readonly images: ImageProcessor,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(ENV) env: Env,
  ) {
    this.mediaBase = env.MEDIA_BASE_URL.replace(/\/$/, '');
  }

  /** Stores a charm picture; the admin then saves the returned key in the custom options. */
  async uploadMotifImage(file: Buffer, actor: Actor) {
    const img = await this.images.processCharm(file);
    const imageKey = `custom/motifs/${randomUUID()}.webp`;
    await this.storage.put(imageKey, img.body, img.contentType);
    await this.audit.record({
      actorId: actor.userId,
      action: 'custom.motif_image',
      targetType: 'custom_options',
      metadata: { imageKey },
      requestId: actor.requestId,
    });
    return {
      imageKey,
      imageUrl: `${this.mediaBase}/${imageKey}`,
      transparent: img.transparent,
      width: img.width,
      height: img.height,
    };
  }
}
