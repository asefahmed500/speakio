import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import type { AuthenticatedRequest } from '../authenticated-request';

const ROLE_PERMISSIONS: Record<string, string[]> = {
  USER: [
    'tests:take',
    'tests:view',
    'attempts:create',
    'attempts:view_own',
    'certificates:view_own',
    'study_plan:manage',
    'vocabulary:manage',
  ],
  ADMIN: [
    'tests:take',
    'tests:view',
    'tests:manage',
    'tests:create',
    'tests:delete',
    'attempts:create',
    'attempts:view_own',
    'attempts:view_all',
    'attempts:rescore',
    'scoring:view',
    'scoring:override',
    'scoring:retry',
    'agent_ops:view',
    'review_queue:view',
    'review_queue:action',
    'certificates:view_own',
    'certificates:issue',
    'certificates:revoke',
    'users:view',
    'users:manage_role',
    'users:manage_status',
    'users:delete',
    'study_plan:manage',
    'vocabulary:manage',
  ],
};

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user || !user.role) {
      throw new ForbiddenException('User context missing or unauthenticated');
    }

    const userPermissions = ROLE_PERMISSIONS[user.role] ?? [];
    const hasRequired = requiredPermissions.every((perm) =>
      userPermissions.includes(perm),
    );

    if (!hasRequired) {
      throw new ForbiddenException(
        `Insufficient permissions. Requires: ${requiredPermissions.join(', ')}`,
      );
    }

    return true;
  }
}
