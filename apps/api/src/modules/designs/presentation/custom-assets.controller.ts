import {
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AuthContext } from '../../../common/auth/auth.types';
import { CurrentAuth, RequestId, RequirePermission } from '../../../common/auth/decorators';
import { AppError } from '../../../common/errors/app-error';
import { CustomAssetsService } from '../application/custom-assets.service';

const uuid = new ParseUUIDPipe({ version: '4', exceptionFactory: () => AppError.notFound() });
const upload = () =>
  FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 2 } });
type File = { buffer: Buffer } | undefined;
const need = (f: File) => {
  if (!f) throw new AppError('MEDIA_INVALID', 400, 'Chưa chọn tệp.');
  return f.buffer;
};

@Controller('admin/custom')
export class CustomAssetsController {
  constructor(@Inject(CustomAssetsService) private readonly assets: CustomAssetsService) {}

  /** A charm picture (SVG/PNG/WebP/JPEG, any size). Saving it into the options needs settings:write. */
  @Post('motif-image')
  @RequirePermission('settings:write')
  @UseInterceptors(upload())
  motif(@UploadedFile() file: File, @CurrentAuth() auth: AuthContext, @RequestId() rid?: string) {
    return this.assets.uploadMotifImage(need(file), { userId: auth.userId, requestId: rid });
  }
}
