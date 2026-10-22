import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  adminArticleListQuerySchema,
  createArticleSchema,
  updateArticleSchema,
} from '@nona/contracts';
import type { AuthContext } from '../../../common/auth/auth.types';
import { CurrentAuth, RequestId, RequirePermission } from '../../../common/auth/decorators';
import { AppError } from '../../../common/errors/app-error';
import { parseInput } from '../../../common/http/parse';
import { ArticlesService } from '../application/articles.service';

const uuid = new ParseUUIDPipe({ version: '4', exceptionFactory: () => AppError.notFound() });
const upload = () =>
  FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 4 } });
type File = { buffer: Buffer } | undefined;
const need = (f: File) => {
  if (!f) throw new AppError('MEDIA_INVALID', 400, 'Chưa chọn tệp ảnh.');
  return f.buffer;
};

@Controller('admin/articles')
export class AdminArticlesController {
  constructor(@Inject(ArticlesService) private readonly articles: ArticlesService) {}

  private actor(auth: AuthContext, requestId?: string) {
    return { userId: auth.userId, requestId };
  }

  @Get()
  @RequirePermission('articles:write')
  list(@Query() raw: Record<string, unknown>) {
    const q = parseInput(adminArticleListQuerySchema, raw);
    return this.articles.listAdmin({ status: q.status, q: q.q }, q.page, q.pageSize);
  }

  @Post()
  @RequirePermission('articles:write')
  create(@Body() body: unknown, @CurrentAuth() auth: AuthContext, @RequestId() rid?: string) {
    return this.articles.create(parseInput(createArticleSchema, body), this.actor(auth, rid));
  }

  // fixed paths before ':id'
  @Post('images')
  @RequirePermission('articles:write')
  @UseInterceptors(upload())
  image(@UploadedFile() file: File, @CurrentAuth() auth: AuthContext, @RequestId() rid?: string) {
    return this.articles.uploadBodyImage(need(file), this.actor(auth, rid));
  }

  @Get(':id')
  @RequirePermission('articles:write')
  detail(@Param('id', uuid) id: string) {
    return this.articles.detail(id);
  }

  @Patch(':id')
  @RequirePermission('articles:write')
  update(
    @Param('id', uuid) id: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @RequestId() rid?: string,
  ) {
    return this.articles.update(id, parseInput(updateArticleSchema, body), this.actor(auth, rid));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('articles:write')
  async remove(
    @Param('id', uuid) id: string,
    @CurrentAuth() auth: AuthContext,
    @RequestId() rid?: string,
  ) {
    await this.articles.remove(id, this.actor(auth, rid));
  }

  @Post(':id/cover')
  @RequirePermission('articles:write')
  @UseInterceptors(upload())
  cover(
    @Param('id', uuid) id: string,
    @UploadedFile() file: File,
    @Body() body: { alt?: string },
    @CurrentAuth() auth: AuthContext,
    @RequestId() rid?: string,
  ) {
    return this.articles.setCover(
      id,
      need(file),
      typeof body?.alt === 'string' ? body.alt : undefined,
      this.actor(auth, rid),
    );
  }

  @Delete(':id/cover')
  @RequirePermission('articles:write')
  removeCover(
    @Param('id', uuid) id: string,
    @CurrentAuth() auth: AuthContext,
    @RequestId() rid?: string,
  ) {
    return this.articles.removeCover(id, this.actor(auth, rid));
  }
}
