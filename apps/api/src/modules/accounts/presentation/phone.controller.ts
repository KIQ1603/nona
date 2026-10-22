import { Body, Controller, Delete, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { phoneOtpRequestSchema, phoneOtpVerifySchema } from '@nona/contracts';
import type { AuthContext } from '../../../common/auth/auth.types';
import { Authenticated, CurrentAuth, RequestId } from '../../../common/auth/decorators';
import { parseInput } from '../../../common/http/parse';
import { PhoneVerificationService } from '../application/phone-verification.service';

@Controller('me/phone')
@Authenticated()
export class PhoneController {
  constructor(@Inject(PhoneVerificationService) private readonly phone: PhoneVerificationService) {}

  @Get()
  status(@CurrentAuth() auth: AuthContext) {
    return this.phone.status(auth.userId);
  }

  /** Sends a one-time code to the number (Zalo ZNS). */
  @Post('otp')
  @HttpCode(200)
  request(@Body() body: unknown, @CurrentAuth() auth: AuthContext, @RequestId() rid?: string) {
    return this.phone.request(
      { userId: auth.userId },
      parseInput(phoneOtpRequestSchema, body).phone,
      'ACCOUNT',
      {
        requestId: rid,
      },
    );
  }

  @Post('verify')
  @HttpCode(200)
  verify(@Body() body: unknown, @CurrentAuth() auth: AuthContext, @RequestId() rid?: string) {
    return this.phone
      .verify({ userId: auth.userId }, parseInput(phoneOtpVerifySchema, body).code, 'ACCOUNT', {
        requestId: rid,
      })
      .then(({ phone, verified }) => ({ phone, verified }));
  }

  @Delete()
  remove(@CurrentAuth() auth: AuthContext, @RequestId() rid?: string) {
    return this.phone.remove(auth.userId, { requestId: rid });
  }
}
