import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from '@nona/contracts';
import type { AuthContext, RequestWithAuth } from './auth.types';

export const AUTH_KEY = 'nona:auth';
export const PERMISSION_KEY = 'nona:permission';
export const OPTIONAL_AUTH_KEY = 'nona:optional-auth';

/** Route requires a valid session (any role). */
export const Authenticated = () => SetMetadata(AUTH_KEY, true);
/** Route works for guests, but identifies the user (and enforces CSRF on writes) when a valid session exists. */
export const OptionalAuth = () => SetMetadata(OPTIONAL_AUTH_KEY, true);
/** Route requires a session whose role grants `permission`. Routes without either decorator are public. */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(PERMISSION_KEY, permission);

export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const req = ctx.switchToHttp().getRequest<RequestWithAuth>();
    if (!req.auth) throw new Error('CurrentAuth used on a route without authentication');
    return req.auth;
  },
);

export const RequestId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    return ctx.switchToHttp().getRequest<RequestWithAuth>().id;
  },
);
