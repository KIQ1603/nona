import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { phoneOtpVerifySchema } from '@nona/contracts';
import type { AuthContext } from '../../../common/auth/auth.types';
import { Authenticated, CurrentAuth, RequestId } from '../../../common/auth/decorators';
import { parseInput } from '../../../common/http/parse';
import { EmailVerificationService } from '../application/email-verification.service';

@Controller('me/email')
@Authenticated()
export class EmailController {
  constructor(@Inject(EmailVerificationService) private readonly email: EmailVerificationService) {}

  @Get()
  status(@CurrentAuth() auth: AuthContext) {
    return this.email.status(auth.userId);
  }

  @Post('otp')
  @HttpCode(200)
  request(@CurrentAuth() auth: AuthContext, @RequestId() rid?: string) {
    return this.email.request(auth.userId, rid);
  }

  @Post('verify')
  @HttpCode(200)
  verify(@Body() body: unknown, @CurrentAuth() auth: AuthContext, @RequestId() rid?: string) {
    return this.email.verify(auth.userId, parseInput(phoneOtpVerifySchema, body).code, rid);
  }
}
