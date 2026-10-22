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
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  adminProductListQuerySchema,
  createCategorySchema,
  createProductSchema,
  createVariantSchema,
  reorderImagesSchema,
  updateCategorySchema,
  updateProductSchema,
  updateVariantSchema,
} from '@nona/contracts';
import type { AuthContext } from '../../../common/auth/auth.types';
import { CurrentAuth, RequestId, RequirePermission } from '../../../common/auth/decorators';
import { AppError } from '../../../common/errors/app-error';
import { parseInput } from '../../../common/http/parse';
import { AdminCatalogService } from '../application/admin-catalog.service';

const uuid = new ParseUUIDPipe({ version: '4', exceptionFactory: () => AppError.notFound() });

@Controller('admin')
export class AdminCatalogController {
  constructor(@Inject(AdminCatalogService) private readonly catalog: AdminCatalogService) {}

  private actor(auth: AuthContext, requestId?: string) {
    return { userId: auth.userId, requestId };
  }

  // categories
  @Get('categories')
  @RequirePermission('admin:access')
  categories() {
    return this.catalog.listCategories();
  }

  @Post('categories')
  @RequirePermission('catalog:write')
  createCategory(
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @RequestId() rid?: string,
  ) {
    return this.catalog.createCategory(
      parseInput(createCategorySchema, body),
      this.actor(auth, rid),
    );
  }

  @Patch('categories/:id')
  @RequirePermission('catalog:write')
  async updateCategory(
    @Param('id', uuid) id: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @RequestId() rid?: string,
  ) {
    await this.catalog.updateCategory(
      id,
      parseInput(updateCategorySchema, body),
      this.actor(auth, rid),
    );
    return this.catalog.listCategories();
  }

  @Delete('categories/:id')
  @HttpCode(204)
  @RequirePermission('catalog:write')
  async deleteCategory(
    @Param('id', uuid) id: string,
    @CurrentAuth() auth: AuthContext,
    @RequestId() rid?: string,
  ) {
    await this.catalog.deleteCategory(id, this.actor(auth, rid));
  }

  // products
  @Get('products')
  @RequirePermission('admin:access')
  products(@Query() raw: Record<string, unknown>) {
    return this.catalog.listProducts(parseInput(adminProductListQuerySchema, raw));
  }

  @Get('products/:id')
  @RequirePermission('admin:access')
  product(@Param('id', uuid) id: string) {
    return this.catalog.getProduct(id);
  }

  @Post('products')
  @RequirePermission('catalog:write')
  createProduct(
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @RequestId() rid?: string,
  ) {
    return this.catalog.createProduct(parseInput(createProductSchema, body), this.actor(auth, rid));
  }

  @Patch('products/:id')
  @RequirePermission('catalog:write')
  updateProduct(
    @Param('id', uuid) id: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @RequestId() rid?: string,
  ) {
    return this.catalog.updateProduct(
      id,
      parseInput(updateProductSchema, body),
      this.actor(auth, rid),
    );
  }

  // variants
  @Post('products/:id/variants')
  @RequirePermission('catalog:write')
  createVariant(
    @Param('id', uuid) id: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @RequestId() rid?: string,
  ) {
    return this.catalog.createVariant(
      id,
      parseInput(createVariantSchema, body),
      this.actor(auth, rid),
    );
  }

  @Patch('variants/:id')
  @RequirePermission('catalog:write')
  updateVariant(
    @Param('id', uuid) id: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @RequestId() rid?: string,
  ) {
    return this.catalog.updateVariant(
      id,
      parseInput(updateVariantSchema, body),
      this.actor(auth, rid),
    );
  }

  // images
  @Post('products/:id/images')
  @RequirePermission('catalog:write')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 4 } }),
  )
  uploadImage(
    @Param('id', uuid) id: string,
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @Body() body: { alt?: string; variantId?: string },
    @CurrentAuth() auth: AuthContext,
    @RequestId() rid?: string,
  ) {
    if (!file) throw new AppError('MEDIA_INVALID', 400, 'Chưa chọn tệp ảnh.');
    return this.catalog.uploadImage(
      id,
      file.buffer,
      typeof body?.alt === 'string' ? body.alt : undefined,
      this.actor(auth, rid),
      typeof body?.variantId === 'string' && /^[0-9a-f-]{36}$/i.test(body.variantId)
        ? body.variantId
        : undefined,
    );
  }

  @Put('products/:id/images/order')
  @RequirePermission('catalog:write')
  reorder(
    @Param('id', uuid) id: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @RequestId() rid?: string,
  ) {
    return this.catalog.reorderImages(
      id,
      parseInput(reorderImagesSchema, body).imageIds,
      this.actor(auth, rid),
    );
  }

  @Delete('products/:id/images/:imageId')
  @RequirePermission('catalog:write')
  deleteImage(
    @Param('id', uuid) id: string,
    @Param('imageId', uuid) imageId: string,
    @CurrentAuth() auth: AuthContext,
    @RequestId() rid?: string,
  ) {
    return this.catalog.deleteImage(id, imageId, this.actor(auth, rid));
  }
}
