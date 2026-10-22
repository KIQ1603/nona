import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req } from '@nestjs/common';
import { normalizeVnPhone, phoneOtpRequestSchema, phoneOtpVerifySchema } from '@nona/contracts';
import type { Request } from 'express';
import type { RequestWithAuth } from '../../../common/auth/auth.types';
import { OptionalAuth } from '../../../common/auth/decorators';
import { AppError } from '../../../common/errors/app-error';
import { parseInput } from '../../../common/http/parse';
import { resolveOwner } from '../../cart/presentation/cart.controller';
import { PhoneVerificationService } from '../application/phone-verification.service';

type Req = Request & RequestWithAuth & { cookies?: Record<string, string> };

/** Phone proof at checkout. Works for signed-in users and guests (identified by their cart cookie). */
@Controller('checkout/phone')
@OptionalAuth()
export class CheckoutPhoneController {
  constructor(@Inject(PhoneVerificationService) private readonly phone: PhoneVerificationService) {}

  private owner(req: Req) {
    const owner = resolveOwner(req);
    if (!owner) throw new AppError('CART_EMPTY', 409, 'Giỏ hàng đang trống.');
    return owner;
  }

  @Get()
  async status(@Query('phone') raw: string | undefined, @Req() req: Req) {
    const phone = normalizeVnPhone(raw ?? '');
    if (!phone) return { phone: null, verified: false };
    return { phone, verified: await this.phone.isVerifiedNow(this.owner(req), phone) };
  }

  @Post('otp')
  @HttpCode(200)
  request(@Body() body: unknown, @Req() req: Req) {
    const owner = this.owner(req);
    return this.phone.request(owner, parseInput(phoneOtpRequestSchema, body).phone, 'CHECKOUT', {
      requestId: req.headers['x-request-id'] as string | undefined,
      ip: req.ip,
    });
  }

  @Post('verify')
  @HttpCode(200)
  async verify(@Body() body: unknown, @Req() req: Req) {
    const owner = this.owner(req);
    const res = await this.phone.verify(
      owner,
      parseInput(phoneOtpVerifySchema, body).code,
      'CHECKOUT',
      {
        requestId: req.headers['x-request-id'] as string | undefined,
      },
    );
    return { phone: res.rawPhone, verified: true };
  }
}
