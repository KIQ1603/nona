import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { mfaCodeSchema } from '@nona/contracts';
import type { AuthContext } from '../../../common/auth/auth.types';
import { Authenticated, CurrentAuth, RequestId } from '../../../common/auth/decorators';
import { AppError } from '../../../common/errors/app-error';
import { parseInput } from '../../../common/http/parse';
import { LoginThrottle } from '../../auth/infrastructure/login-throttle';
import { MfaService } from '../application/mfa.service';

/** Enrolment endpoints. They stay available to a session that is still MFA-restricted (that is their purpose). */
@Controller('me/mfa')
@Authenticated()
export class MfaController {
  constructor(
    @Inject(MfaService) private readonly mfa: MfaService,
    @Inject(LoginThrottle) private readonly throttle: LoginThrottle,
  ) {}

  private staffOnly(auth: AuthContext) {
    if (auth.role === 'CUSTOMER')
      throw new AppError('FORBIDDEN', 403, 'Xác thực hai lớp chỉ dành cho nhân viên.');
  }

  @Post('setup')
  @HttpCode(200)
  setup(@CurrentAuth() auth: AuthContext) {
    this.staffOnly(auth);
    return this.mfa.beginEnrolment(auth.userId, auth.email);
  }

  @Post('confirm')
  @HttpCode(200)
  async confirm(
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @RequestId() requestId?: string,
  ) {
    this.staffOnly(auth);
    const key = `mfa-confirm|${auth.userId}`;
    if (this.throttle.isBlocked(key, 10))
      throw new AppError(
        'RATE_LIMITED',
        429,
        'Bạn thử quá nhiều lần. Vui lòng thử lại sau ít phút.',
      );
    this.throttle.recordFailure(key);
    return {
      recoveryCodes: await this.mfa.confirmEnrolment(
        auth.userId,
        parseInput(mfaCodeSchema, body).code,
        auth.sessionId,
        requestId,
      ),
    };
  }

  @Post('disable')
  @HttpCode(204)
  async disable(
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @RequestId() requestId?: string,
  ) {
    this.staffOnly(auth);
    await this.mfa.disable(auth.userId, parseInput(mfaCodeSchema, body).code, requestId);
  }
}
