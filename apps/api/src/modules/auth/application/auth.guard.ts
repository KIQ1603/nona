import { timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLE_PERMISSIONS, type Permission } from '@nona/contracts';
import type { Request } from 'express';
import { AUTH_KEY, OPTIONAL_AUTH_KEY, PERMISSION_KEY } from '../../../common/auth/decorators';
import type { RequestWithAuth } from '../../../common/auth/auth.types';
import { AppError } from '../../../common/errors/app-error';
import { ENV, type Env } from '../../../config/env';
import { AuthService, SESSION_COOKIE } from './auth.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const safeEqual = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Global guard.
 *  - Every state-changing request carrying an Origin must come from the web origin (CSRF defence in depth).
 *  - Routes marked @Authenticated / @RequirePermission need a valid session, a matching CSRF token on writes
 *    and (for permissions) a role that grants it. Unmarked routes are public.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & RequestWithAuth & { cookies?: Record<string, string> }>();
    const unsafe = !SAFE_METHODS.has(req.method);

    const origin = req.header('origin');
    if (unsafe && origin && origin !== this.env.WEB_ORIGIN) {
      throw new AppError('FORBIDDEN', 403, 'Nguồn gửi yêu cầu không được phép.', {
        reason: 'origin',
      });
    }

    const targets = [context.getHandler(), context.getClass()];
    const needsAuth = this.reflector.getAllAndOverride<boolean>(AUTH_KEY, targets);
    const permission = this.reflector.getAllAndOverride<Permission>(PERMISSION_KEY, targets);
    const optional = this.reflector.getAllAndOverride<boolean>(OPTIONAL_AUTH_KEY, targets);
    if (!needsAuth && !permission && !optional) return true;

    const token = req.cookies?.[SESSION_COOKIE];
    const auth = token ? await this.auth.authenticate(token) : null;
    if (!auth && optional && !needsAuth && !permission) return true; // guest
    if (!auth) throw new AppError('UNAUTHENTICATED', 401, 'Vui lòng đăng nhập để tiếp tục.');

    if (unsafe) {
      const sent = req.header('x-csrf-token');
      if (!sent || !safeEqual(sent, auth.csrfToken)) {
        throw new AppError(
          'FORBIDDEN',
          403,
          'Phiên làm việc không hợp lệ, vui lòng tải lại trang.',
          { reason: 'csrf' },
        );
      }
    }
    if (permission && auth.mfaRestricted) {
      throw new AppError(
        'MFA_REQUIRED',
        403,
        'Vui lòng thiết lập xác thực hai lớp trước khi sử dụng khu vực quản trị.',
        { reason: 'mfa_enrolment' },
      );
    }
    if (permission && !ROLE_PERMISSIONS[auth.role].includes(permission)) {
      throw new AppError('FORBIDDEN', 403, 'Bạn không có quyền thực hiện thao tác này.');
    }
    req.auth = auth;
    return true;
  }
}
