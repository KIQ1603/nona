import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  createDesignSchema,
  ROLE_PERMISSIONS,
  submitDesignSchema,
  updateDesignSchema,
} from '@nona/contracts';
import type { Request, Response } from 'express';
import type { RequestWithAuth } from '../../../common/auth/auth.types';
import { OptionalAuth } from '../../../common/auth/decorators';
import { AppError } from '../../../common/errors/app-error';
import { parseInput } from '../../../common/http/parse';
import { ENV, type Env } from '../../../config/env';
import { LoginThrottle } from '../../auth/infrastructure/login-throttle';
import { DesignsService, type Viewer } from '../application/designs.service';
import type { DesignOwner } from '../infrastructure/designs.repository';

export const DESIGN_COOKIE = 'nona_design';
const GUEST_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const uuid = new ParseUUIDPipe({ version: '4', exceptionFactory: () => AppError.notFound() });
type Req = Request & RequestWithAuth & { cookies?: Record<string, string> };

/** Signed-in users own designs by account; everyone else by an opaque, HttpOnly, unguessable cookie. */
export function designOwner(req: Req): DesignOwner | null {
  if (req.auth) return { userId: req.auth.userId };
  const token = req.cookies?.[DESIGN_COOKIE];
  return token && GUEST_TOKEN.test(token) ? { guestToken: token } : null;
}

@Controller()
export class DesignsController {
  constructor(
    @Inject(DesignsService) private readonly designs: DesignsService,
    @Inject(LoginThrottle) private readonly throttle: LoginThrottle,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private requireOwner(req: Req): DesignOwner {
    const owner = designOwner(req);
    if (!owner) throw AppError.notFound('Không tìm thấy thiết kế.');
    return owner;
  }
  /** Staff who may read designs, otherwise the owner. Anyone else gets a 404. */
  private viewer(req: Req): Viewer {
    if (req.auth && ROLE_PERMISSIONS[req.auth.role].includes('designs:read'))
      return { kind: 'staff' };
    return { kind: 'owner', owner: this.requireOwner(req) };
  }
  private allowed(req: Req, scope: string, max: number): boolean {
    const key = `${scope}|${req.ip ?? 'unknown'}`;
    const ok = !this.throttle.isBlocked(key, max);
    if (ok) this.throttle.recordFailure(key);
    return ok;
  }
  private noStore(res: Response) {
    res.setHeader('Cache-Control', 'private, no-store');
  }

  @Get('custom/catalog')
  @Header('Cache-Control', 'public, max-age=0, s-maxage=15, stale-while-revalidate=60')
  catalog() {
    return this.designs.catalog();
  }

  @Post('custom-designs')
  @OptionalAuth()
  async create(@Body() body: unknown, @Req() req: Req, @Res({ passthrough: true }) res: Response) {
    const input = parseInput(createDesignSchema, body);
    let owner = designOwner(req);
    if (!owner) {
      owner = { guestToken: this.designs.newGuestToken() };
      res.cookie(DESIGN_COOKIE, owner.guestToken, {
        httpOnly: true,
        secure: this.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 90 * 24 * 3_600_000,
      });
    }
    this.noStore(res);
    return this.designs.create(owner, input, { allowed: this.allowed(req, 'design-create', 30) });
  }

  @Get('custom-designs')
  @OptionalAuth()
  list(@Req() req: Req, @Res({ passthrough: true }) res: Response) {
    this.noStore(res);
    const owner = designOwner(req);
    return owner ? this.designs.listMine(owner) : { items: [] };
  }

  @Post('custom-designs/assets')
  @OptionalAuth()
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 2 } }),
  )
  async upload(
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @Req() req: Req,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!file) throw new AppError('MEDIA_INVALID', 400, 'Chưa chọn tệp ảnh.');
    let owner = designOwner(req);
    if (!owner) {
      owner = { guestToken: this.designs.newGuestToken() };
      res.cookie(DESIGN_COOKIE, owner.guestToken, {
        httpOnly: true,
        secure: this.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 90 * 24 * 3_600_000,
      });
    }
    this.noStore(res);
    return this.designs.uploadAsset(owner, file.buffer, this.allowed(req, 'design-upload', 20));
  }

  @Get('custom-designs/assets/:assetId/content')
  @OptionalAuth()
  async asset(@Param('assetId', uuid) id: string, @Req() req: Req, @Res() res: Response) {
    const obj = await this.designs.assetContent(id, this.viewer(req));
    res
      .setHeader('Cache-Control', 'private, max-age=300')
      .setHeader('X-Content-Type-Options', 'nosniff')
      .type(obj.contentType)
      .send(obj.body);
  }

  @Get('custom-designs/versions/:versionId/preview')
  @OptionalAuth()
  async preview(@Param('versionId', uuid) id: string, @Req() req: Req, @Res() res: Response) {
    const obj = await this.designs.previewContent(id, this.viewer(req));
    res
      .setHeader('Cache-Control', 'private, max-age=300')
      .setHeader('X-Content-Type-Options', 'nosniff')
      .type(obj.contentType)
      .send(obj.body);
  }

  @Get('custom-designs/:id')
  @OptionalAuth()
  get(@Param('id', uuid) id: string, @Req() req: Req, @Res({ passthrough: true }) res: Response) {
    this.noStore(res);
    return this.designs.get(id, this.viewer(req));
  }

  @Patch('custom-designs/:id')
  @OptionalAuth()
  update(
    @Param('id', uuid) id: string,
    @Body() body: unknown,
    @Req() req: Req,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.noStore(res);
    return this.designs.update(id, this.requireOwner(req), parseInput(updateDesignSchema, body));
  }

  @Post('custom-designs/:id/versions')
  @OptionalAuth()
  newVersion(
    @Param('id', uuid) id: string,
    @Req() req: Req,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.noStore(res);
    return this.designs.newVersion(id, this.requireOwner(req));
  }

  @Post('custom-designs/:id/submit')
  @OptionalAuth()
  @HttpCode(200)
  submit(
    @Param('id', uuid) id: string,
    @Body() body: unknown,
    @Req() req: Req,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.noStore(res);
    return this.designs.submit(
      id,
      this.requireOwner(req),
      parseInput(submitDesignSchema, body ?? {}).contactEmail,
    );
  }
}
