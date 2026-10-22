import { Body, Controller, Delete, Get, Inject, Param, Post, Res } from '@nestjs/common';
import { wishlistMergeSchema } from '@nona/contracts';
import type { Response } from 'express';
import { z } from 'zod';
import type { AuthContext } from '../../../common/auth/auth.types';
import { Authenticated, CurrentAuth } from '../../../common/auth/decorators';
import { parseInput } from '../../../common/http/parse';
import { WishlistService } from '../application/wishlist.service';

const slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .max(120);

@Controller('wishlist')
@Authenticated()
export class WishlistController {
  constructor(@Inject(WishlistService) private readonly wishlist: WishlistService) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return this.wishlist.slugs(auth.userId);
  }

  @Post('items')
  add(@Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.wishlist.add(
      auth.userId,
      parseInput(z.object({ productSlug: slug }), body).productSlug,
    );
  }

  @Delete('items/:slug')
  remove(@Param('slug') s: string, @CurrentAuth() auth: AuthContext) {
    return this.wishlist.remove(auth.userId, parseInput(slug, s));
  }

  @Post('merge')
  merge(@Body() body: unknown, @CurrentAuth() auth: AuthContext) {
    return this.wishlist.merge(
      auth.userId,
      parseInput(wishlistMergeSchema, body).slugs.filter((s) => slug.safeParse(s).success),
    );
  }
}
