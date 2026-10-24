import { Global, Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { CartModule } from '../cart/cart.module';
import { DesignsModule } from '../designs/designs.module';
import { MfaModule } from '../mfa/mfa.module';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './application/auth.guard';
import { GoogleAuthService } from './application/google-auth.service';
import { AuthChallengeService } from './application/auth-challenge.service';
import { AuthService } from './application/auth.service';
import { LoginThrottle } from './infrastructure/login-throttle';
import { PasswordHasher } from './infrastructure/password-hasher';
import { AuthController } from './presentation/auth.controller';

@Global()
@Module({
  imports: [AccountsModule, CartModule, DesignsModule, MfaModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthChallengeService,
    GoogleAuthService,
    PasswordHasher,
    LoginThrottle,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthService, PasswordHasher, LoginThrottle],
})
export class AuthModule {}
