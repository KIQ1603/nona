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
  Req,
  Res,
} from '@nestjs/common';
import { addCartItemSchema, updateCartItemSchema } from '@nona/contracts';
import type { Request, Response } from 'express';
import type { RequestWithAuth } from '../../../common/auth/auth.types';
import { OptionalAuth } from '../../../common/auth/decorators';
import { AppError } from '../../../common/errors/app-error';
import { parseInput } from '../../../common/http/parse';
import { ENV, type Env } from '../../../config/env';
import { designOwner } from '../../designs/presentation/designs.controller';
import { CartService } from '../application/cart.service';
import type { Owner } from '../infrastructure/cart.repository';

export const CART_COOKIE = 'nona_cart';
const GUEST_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const uuid = new ParseUUIDPipe({ version: '4', exceptionFactory: () => AppError.notFound() });

type Req = Request & RequestWithAuth & { cookies?: Record<string, string> };

/** Signed-in users own a server cart; everyone else is identified by an opaque, HttpOnly cart cookie. */
export function resolveOwner(req: Req): Owner | null {
  if (req.auth) return { userId: req.auth.userId };
  const token = req.cookies?.[CART_COOKIE];
  return token && GUEST_TOKEN.test(token) ? { guestToken: token } : null;
}

@Controller('cart')
@OptionalAuth()
export class CartController {
  constructor(
    @Inject(CartService) private readonly cart: CartService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private noStore(res: Response) {
    res.setHeader('Cache-Control', 'no-store');
  }

  @Get()
  get(@Req() req: Req, @Res({ passthrough: true }) res: Response) {
    this.noStore(res);
    return this.cart.get(resolveOwner(req));
  }

  @Post('items')
  async add(@Body() body: unknown, @Req() req: Req, @Res({ passthrough: true }) res: Response) {
    const { variantId, quantity, designVersionId } = parseInput(addCartItemSchema, body);
    const result = await this.cart.addItem(
      resolveOwner(req),
      variantId,
      quantity,
      designVersionId ? { versionId: designVersionId, owner: designOwner(req) } : undefined,
    );
    if (result.newGuestToken) {
      res.cookie(CART_COOKIE, result.newGuestToken, {
        httpOnly: true,
        secure: this.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 30 * 24 * 3_600_000,
      });
    }
    this.noStore(res);
    return result.cart;
  }

  private requireOwner(req: Req): Owner {
    const owner = resolveOwner(req);
    if (!owner) throw AppError.notFound('Giỏ hàng trống.');
    return owner;
  }

  @Patch('items/:itemId')
  patch(
    @Param('itemId', uuid) itemId: string,
    @Body() body: unknown,
    @Req() req: Req,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.noStore(res);
    return this.cart.setQuantity(
      this.requireOwner(req),
      itemId,
      parseInput(updateCartItemSchema, body).quantity,
    );
  }

  @Delete('items/:itemId')
  remove(
    @Param('itemId', uuid) itemId: string,
    @Req() req: Req,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.noStore(res);
    return this.cart.removeItem(this.requireOwner(req), itemId);
  }

  @Post('acknowledge-price-changes')
  @HttpCode(200)
  ack(@Req() req: Req, @Res({ passthrough: true }) res: Response) {
    this.noStore(res);
    const owner = resolveOwner(req);
    return owner ? this.cart.acknowledgePriceChanges(owner) : this.cart.get(null);
  }
}
