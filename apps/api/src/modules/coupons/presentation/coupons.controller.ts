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
} from '@nestjs/common';
import { applyCouponSchema, createCouponSchema, updateCouponSchema } from '@nona/contracts';
import type { Request } from 'express';
import type { AuthContext, RequestWithAuth } from '../../../common/auth/auth.types';
import {
  CurrentAuth,
  OptionalAuth,
  RequestId,
  RequirePermission,
} from '../../../common/auth/decorators';
import { AppError } from '../../../common/errors/app-error';
import { parseInput } from '../../../common/http/parse';
import { LoginThrottle } from '../../auth/infrastructure/login-throttle';
import { CartService } from '../../cart/application/cart.service';
import { resolveOwner } from '../../cart/presentation/cart.controller';
import { CouponsService } from '../application/coupons.service';

type Req = Request & RequestWithAuth & { cookies?: Record<string, string> };
const uuid = new ParseUUIDPipe({ version: '4', exceptionFactory: () => AppError.notFound() });
const APPLY_LIMIT = 20; // attempts per IP per 15 minutes: stops code guessing

@Controller()
export class CouponsController {
  constructor(
    @Inject(CouponsService) private readonly coupons: CouponsService,
    @Inject(CartService) private readonly cart: CartService,
    @Inject(LoginThrottle) private readonly throttle: LoginThrottle,
  ) {}

  @Post('cart/coupon')
  @OptionalAuth()
  @HttpCode(200)
  async apply(@Body() body: unknown, @Req() req: Req) {
    const key = `coupon|${req.ip ?? 'unknown'}`;
    if (this.throttle.isBlocked(key, APPLY_LIMIT))
      throw new AppError(
        'RATE_LIMITED',
        429,
        'Bạn thử mã quá nhiều lần. Vui lòng thử lại sau ít phút.',
      );
    this.throttle.recordFailure(key);
    const { code } = parseInput(applyCouponSchema, body);
    const owner = resolveOwner(req);
    const cart = await this.cart.get(owner);
    const coupon = await this.coupons.applyToCart(
      owner,
      { userId: req.auth?.userId, email: req.auth?.email },
      code,
      cart.subtotalVnd,
    );
    return { coupon };
  }

  @Delete('cart/coupon')
  @OptionalAuth()
  @HttpCode(204)
  async remove(@Req() req: Req) {
    await this.coupons.removeFromCart(resolveOwner(req));
  }

  // ---- admin (coupons are data owned by staff, never constants) ----
  @Get('admin/coupons')
  @RequirePermission('admin:access')
  list() {
    return this.coupons.list();
  }

  @Post('admin/coupons')
  @RequirePermission('coupons:write')
  create(@Body() body: unknown, @CurrentAuth() auth: AuthContext, @RequestId() requestId?: string) {
    return this.coupons.create(parseInput(createCouponSchema, body), {
      userId: auth.userId,
      requestId,
    });
  }

  @Patch('admin/coupons/:id')
  @RequirePermission('coupons:write')
  update(
    @Param('id', uuid) id: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @RequestId() requestId?: string,
  ) {
    const { version, coupon } = parseInput(updateCouponSchema, body);
    return this.coupons.update(id, version, coupon, { userId: auth.userId, requestId });
  }
}
