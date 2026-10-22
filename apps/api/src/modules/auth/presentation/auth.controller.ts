import { Body, Controller, Get, HttpCode, Inject, Patch, Post, Req, Res } from '@nestjs/common';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  mfaVerifySchema,
  registerSchema,
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
import { parseInput } from '../../../common/http/parse';
import { logger } from '../../../common/logging/logger';
import { ENV, type Env } from '../../../config/env';
import { DesignsService } from '../../designs/application/designs.service';
import { DESIGN_COOKIE } from '../../designs/presentation/designs.controller';
import { CartService } from '../../cart/application/cart.service';
import { CART_COOKIE } from '../../cart/presentation/cart.controller';
import { AuthService, SESSION_COOKIE, toMe } from '../application/auth.service';

type Req = Request & { cookies?: Record<string, string> };

@Controller()
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(CartService) private readonly cart: CartService,
    @Inject(DesignsService) private readonly designs: DesignsService,
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

  @Post('auth/register')
  @HttpCode(201)
  async register(
    @Body() body: unknown,
    @Req() req: Req,
    @Res({ passthrough: true }) res: Response,
    @RequestId() requestId?: string,
  ) {
    const result = await this.auth.register(parseInput(registerSchema, body), {
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
    await this.auth.requestPasswordReset(parseInput(forgotPasswordSchema, body).email, {
      ip: req.ip,
      requestId,
    });
    return { ok: true }; // identical for known and unknown emails
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
