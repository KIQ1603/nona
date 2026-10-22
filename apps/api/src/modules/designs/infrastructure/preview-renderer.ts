import { Injectable } from '@nestjs/common';
import sharp from 'sharp';

/** Rasterises the shared SVG to the PNG stored as a version's preview. Fonts come from the host (see runbooks). */
@Injectable()
export class PreviewRenderer {
  async toPng(svg: string): Promise<Buffer> {
    return sharp(Buffer.from(svg), { density: 192 })
      .resize({ width: 800 })
      .png({ compressionLevel: 9 })
      .toBuffer();
  }
}
