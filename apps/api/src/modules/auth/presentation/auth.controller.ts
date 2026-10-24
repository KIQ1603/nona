import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  mfaVerifySchema,
  classifyIdentifier,
  registerResendSchema,
  resetPasswordByPhoneSchema,
  registerStartSchema,
  registerVerifyFirebaseSchema,
  registerVerifySchema,
  resetPasswordSchema,
  updateProfileSchema,
} from '@nona/contracts';
import type { CookieOptions, Request, Response } from 'express';
import type { AuthContext } from '../../../common/auth/auth.types';
import {
  Authenticated,
  CurrentAuth,
  OptionalAuth,
  RequestId,
} from '../../../common/auth/decorators';
import { AppError } from '../../../common/errors/app-error';
import { parseInput } from '../../../common/http/parse';
import { logger } from '../../../common/logging/logger';
import { ENV, type Env } from '../../../config/env';
import { DesignsService } from '../../designs/application/designs.service';
import { DESIGN_COOKIE } from '../../designs/presentation/designs.controller';
import { CartService } from '../../cart/application/cart.service';
import { CART_COOKIE } from '../../cart/presentation/cart.controller';
import { FirebasePhoneService } from '../../accounts/application/firebase-phone.service';
import { AuthChallengeService } from '../application/auth-challenge.service';
import { AuthService, SESSION_COOKIE, toMe } from '../application/auth.service';
import {
  GoogleAuthService,
  GoogleFailureError,
  OAUTH_COOKIE,
} from '../application/google-auth.service';
import { LoginThrottle } from '../infrastructure/login-throttle';

type Req = Request & { cookies?: Record<string, string> };

@Controller()
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(CartService) private readonly cart: CartService,
    @Inject(DesignsService) private readonly designs: DesignsService,
    @Inject(AuthChallengeService) private readonly challenges: AuthChallengeService,
    @Inject(GoogleAuthService) private readonly google: GoogleAuthService,
    @Inject(FirebasePhoneService) private readonly firebase: FirebasePhoneService,
    @Inject(LoginThrottle) private readonly throttle: LoginThrottle,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    };
  }

  private setSession(res: Response, result: { token: string; expiresAt: Date }) {
    res.cookie(SESSION_COOKIE, result.token, {
      ...this.cookieOptions(),
      expires: result.expiresAt,
    });
    res.setHeader('Cache-Control', 'no-store');
  }

  /** Folds the anonymous cart into the account on sign-in. Never blocks the login itself. */
  private async mergeCart(req: Req, res: Response, userId: string) {
    // Designs first: cart lines that carry a design version must already belong to the account.
    const designToken = req.cookies?.[DESIGN_COOKIE];
    if (designToken) {
      try {
        await this.designs.mergeGuest(userId, designToken);
      } catch (error) {
        logger.error({ err: error, userId }, 'guest design merge failed');
      }
      res.clearCookie(DESIGN_COOKIE, { path: '/' });
    }
    const guestToken = req.cookies?.[CART_COOKIE];
    if (!guestToken) return;
    try {
      await this.cart.mergeGuestCart(userId, guestToken);
    } catch (error) {
      logger.error({ err: error, userId }, 'guest cart merge failed');
    }
    res.clearCookie(CART_COOKIE, { path: '/' });
  }

  @Post('auth/login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Req() req: Req,
    @Res({ passthrough: true }) res: Response,
    @RequestId() requestId?: string,
  ) {
    const { email, password } = parseInput(loginSchema, body);
    const result = await this.auth.login(email, password, {
      ip: req.ip,
      userAgent: req.header('user-agent'),
      requestId,
    });
    if (result.kind === 'mfa') {
      res.setHeader('Cache-Control', 'no-store');
      return { mfaRequired: true as const, challengeToken: result.challengeToken };
    }
    this.setSession(res, result);
    await this.mergeCart(req, res, result.auth.userId);
    return toMe(result.auth);
  }

  /** Which sign-in options the storefront may show. */
  @Get('auth/providers')
  providers(@Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    const firebase = this.firebase.enabled ? this.firebase.webConfig() : null;
    return {
      google: this.google.enabled,
      phone: { provider: firebase ? 'firebase' : 'sms', firebase },
    };
  }

  /** Sends the browser to Google. Same-site paths only for `next`. */
  @Get('auth/google/start')
  googleStart(@Query('next') next: string | undefined, @Res() res: Response) {
    const safe =
      next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\')
        ? next
        : '/tai-khoan';
    if (!this.google.enabled) {
      // the button is always shown; until the keys are configured it explains instead of failing
      return res.redirect(
        302,
        `${this.env.WEB_ORIGIN.replace(/\/$/, '')}/dang-nhap?loi=google-chua-cau-hinh&next=${encodeURIComponent(safe)}`,
      );
    }
    const { url, cookie, maxAgeMs } = this.google.start(safe);
    res.cookie(OAUTH_COOKIE, cookie, { ...this.cookieOptions(), maxAge: maxAgeMs });
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, url);
  }

  /** Google brings the user back here (through the web origin). Always ends in a redirect to the web app. */
  @Get('auth/google/callback')
  async googleCallback(
    @Query() query: { code?: string; state?: string; error?: string },
    @Req() req: Req,
    @Res() res: Response,
    @RequestId() requestId?: string,
  ) {
    const web = this.env.WEB_ORIGIN.replace(/\/$/, '');
    const fail = (code: string, next?: string) => {
      res.clearCookie(OAUTH_COOKIE, { path: '/' });
      res.setHeader('Cache-Control', 'no-store');
      res.redirect(
        302,
        `${web}/dang-nhap?loi=${code}${next ? `&next=${encodeURIComponent(next)}` : ''}`,
      );
    };
    if (!this.google.enabled) return fail('google-chua-cau-hinh');
    const key = `google|${req.ip ?? 'unknown'}`;
    if (this.throttle.isBlocked(key, 30)) return fail('google-loi');
    this.throttle.recordFailure(key);
    try {
      const { profile, next } = await this.google.finish(query, req.cookies?.[OAUTH_COOKIE]);
      try {
        const result = await this.auth.loginWithGoogle(profile, {
          ip: req.ip,
          userAgent: req.header('user-agent'),
          requestId,
        });
        this.setSession(res, result);
        res.clearCookie(OAUTH_COOKIE, { path: '/' });
        await this.mergeCart(req, res, result.auth.userId);
        res.redirect(302, `${web}${next}`);
      } catch (e) {
        if (e instanceof AppError && e.details.reason === 'EMAIL_EXISTS')
          return fail('google-trung-email');
        throw e;
      }
    } catch (e) {
      if (e instanceof GoogleFailureError) return fail(e.code);
      logger.error({ err: e }, 'google sign-in failed');
      return fail('google-loi');
    }
  }

  @Post('auth/mfa/verify')
  @HttpCode(200)
  async verifyMfa(
    @Body() body: unknown,
    @Req() req: Req,
    @Res({ passthrough: true }) res: Response,
    @RequestId() requestId?: string,
  ) {
    const { challengeToken, code } = parseInput(mfaVerifySchema, body);
    const result = await this.auth.completeMfaLogin(challengeToken, code, {
      ip: req.ip,
      userAgent: req.header('user-agent'),
      requestId,
    });
    this.setSession(res, result);
    return toMe(result.auth);
  }

  /** Step 1 of sign-up with an email or a mobile number: sends a code, creates nothing yet. */
  @Post('auth/register/start')
  @HttpCode(200)
  async registerStart(@Body() body: unknown, @Req() req: Req, @RequestId() requestId?: string) {
    const { fullName, identifier, password } = parseInput(registerStartSchema, body);
    return this.challenges.startRegister(
      { fullName, identifier, password },
      { ip: req.ip, userAgent: req.header('user-agent'), requestId },
    );
  }

  @Post('auth/register/resend')
  @HttpCode(200)
  registerResend(@Body() body: unknown, @Req() req: Req, @RequestId() requestId?: string) {
    return this.challenges.resendRegister(parseInput(registerResendSchema, body).token, {
      ip: req.ip,
      requestId,
    });
  }

  /** Step 2 with Firebase Phone Auth: the verified ID token (instead of our code) creates the account. */
  @Post('auth/register/verify-firebase')
  @HttpCode(201)
  async registerVerifyFirebase(
    @Body() body: unknown,
    @Req() req: Req,
    @Res({ passthrough: true }) res: Response,
    @RequestId() requestId?: string,
  ) {
    const { token, idToken } = parseInput(registerVerifyFirebaseSchema, body);
    const phone = await this.challenges.verifyFirebaseToken(idToken);
    const result = await this.challenges.verifyRegister(
      token,
      { phone },
      { ip: req.ip, userAgent: req.header('user-agent'), requestId },
    );
    this.setSession(res, result);
    await this.mergeCart(req, res, result.auth.userId);
    return toMe(result.auth);
  }

  /** Step 2: the right code creates the account and signs the person in. */
  @Post('auth/register/verify')
  @HttpCode(201)
  async registerVerify(
    @Body() body: unknown,
    @Req() req: Req,
    @Res({ passthrough: true }) res: Response,
    @RequestId() requestId?: string,
  ) {
    const { token, code } = parseInput(registerVerifySchema, body);
    const result = await this.challenges.verifyRegister(token, code, {
      ip: req.ip,
      userAgent: req.header('user-agent'),
      requestId,
    });
    this.setSession(res, result);
    await this.mergeCart(req, res, result.auth.userId);
    return toMe(result.auth);
  }

  @Post('auth/forgot-password')
  @HttpCode(202)
  async forgotPassword(@Body() body: unknown, @Req() req: Req, @RequestId() requestId?: string) {
    const { identifier } = parseInput(forgotPasswordSchema, body);
    const id = classifyIdentifier(identifier);
    if (id.kind === 'INVALID')
      throw AppError.validation({ issues: [{ path: 'identifier', message: id.reason }] });
    if (id.kind === 'PHONE') {
      // a code by SMS; the answer never says whether the number has an account
      return {
        ok: true,
        ...(await this.challenges.startPhoneReset(id.value, { ip: req.ip, requestId })),
      };
    }
    await this.auth.requestPasswordReset(id.value, { ip: req.ip, requestId });
    return { ok: true }; // identical for known and unknown emails
  }

  @Post('auth/reset-password/phone')
  @HttpCode(204)
  async resetPasswordByPhone(
    @Body() body: unknown,
    @Req() req: Req,
    @RequestId() requestId?: string,
  ) {
    const { token, code, idToken, newPassword } = parseInput(resetPasswordByPhoneSchema, body);
    const proof = code ?? { phone: await this.challenges.verifyFirebaseToken(idToken!) };
    await this.challenges.verifyPhoneReset(token, proof, newPassword, { ip: req.ip, requestId });
  }

  @Post('auth/reset-password')
  @HttpCode(204)
  async resetPassword(@Body() body: unknown, @Req() req: Req, @RequestId() requestId?: string) {
    const { token, newPassword } = parseInput(resetPasswordSchema, body);
    await this.auth.resetPassword(token, newPassword, { ip: req.ip, requestId });
  }

  @Post('auth/refresh')
  @HttpCode(200)
  @Authenticated()
  async refresh(@CurrentAuth() auth: AuthContext, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.refresh(auth);
    this.setSession(res, result);
    return toMe(result.auth);
  }

  @Post('auth/logout')
  @HttpCode(204)
  @Authenticated()
  async logout(
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) res: Response,
    @RequestId() requestId?: string,
  ) {
    await this.auth.logout(auth, requestId);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  /** Who am I? Always 200: `{ user: null }` for guests, so the storefront can probe without console errors. */
  @Get('auth/session')
  @OptionalAuth()
  session(@Req() req: Request & { auth?: AuthContext }, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return { user: req.auth ? toMe(req.auth) : null };
  }

  @Get('me')
  @Authenticated()
  me(@CurrentAuth() auth: AuthContext, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return toMe(auth);
  }

  @Patch('me')
  @Authenticated()
  async updateMe(
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @RequestId() requestId?: string,
  ) {
    return toMe(
      await this.auth.updateProfile(
        auth,
        parseInput(updateProfileSchema, body).fullName,
        requestId,
      ),
    );
  }

  @Post('me/password')
  @HttpCode(204)
  @Authenticated()
  async changePassword(
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @RequestId() requestId?: string,
  ) {
    const { currentPassword, newPassword } = parseInput(changePasswordSchema, body);
    await this.auth.changePassword(auth, currentPassword, newPassword, requestId);
  }
}
