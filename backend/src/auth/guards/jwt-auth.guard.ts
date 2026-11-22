import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as jwt from 'jsonwebtoken';
import type {
  AuthenticatedRequest,
  AuthenticatedUser,
} from '../authenticated-request';

type VerifiedPayload = AuthenticatedUser;

/** Suspended-status cache TTL. Keeps the guard DB-light under traffic. */
const STATUS_CACHE_TTL_MS = 30_000;

@Injectable()
export class JwtAuthGuard implements CanActivate {
  /**
   * userId -> { suspended, expiresAt }. A suspension takes effect within this
   * window even for live access tokens; a miss costs one indexed PK lookup.
   */
  private static statusCache = new Map<
    string,
    { suspended: boolean; role: string; expiresAt: number }
  >();

  /**
   * Drops the cached status/role for a user so a suspension, reinstatement or
   * role change takes effect on the very next request instead of after the
   * cache TTL.
   */
  static invalidateStatus(userId: string): void {
    JwtAuthGuard.statusCache.delete(userId);
  }

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const cookies = (request.cookies ?? {}) as Record<
      string,
      string | undefined
    >;
    const token = cookies.access_token || this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('Authentication token missing');
    }

    let payload: VerifiedPayload;
    try {
      const secret = this.getSecret();
      payload = jwt.verify(token, secret) as VerifiedPayload;
    } catch (error) {
      // A missing/invalid server secret is a configuration failure and must
      // not masquerade as a client 401 — surface it as 503 instead.
      if (error instanceof Error && error.message.includes('JWT_SECRET')) {
        throw new ServiceUnavailableException(
          'Authentication is temporarily unavailable',
        );
      }
      throw new UnauthorizedException(
        'Invalid or expired authentication token',
      );
    }

    // Defense in depth: only well-formed payloads from our own signer should
    // ever reach here, but the shape is enforced before controllers rely on it.
    if (!payload || typeof payload.sub !== 'string') {
      throw new UnauthorizedException('Invalid authentication token payload');
    }

    await this.enforceCurrentAccountState(payload.sub, payload.role);

    request.user = payload;
    return true;
  }

  /**
   * Rejects suspended accounts and stale-role tokens. Tokens outlive
   * suspension (15m TTL) and carry a signed role copy, so the DB is the
   * source of truth — consulted through a short-lived in-process cache and
   * invalidated immediately on admin action (invalidateStatus).
   */
  private async enforceCurrentAccountState(
    userId: string,
    tokenRole: string,
  ): Promise<void> {
    const cached = JwtAuthGuard.statusCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      this.rejectIfStale(cached.suspended, cached.role, tokenRole);
      return;
    }
    let suspended = false;
    let role = tokenRole;
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { status: true, role: true },
      });
      // A token for a DELETED account is dead immediately — the DB is the
      // source of truth and `role ?? tokenRole` would otherwise fake validity.
      if (!user) throw new UnauthorizedException('Account no longer exists');
      suspended = user.status === 'SUSPENDED';
      role = user.role;
      JwtAuthGuard.statusCache.set(userId, {
        suspended,
        role,
        expiresAt: Date.now() + STATUS_CACHE_TTL_MS,
      });
      // Opportunistic prune: expired entries are worthless; keep the map
      // bounded under churn without a background sweeper.
      if (JwtAuthGuard.statusCache.size > 1_000) {
        const now = Date.now();
        for (const [id, entry] of JwtAuthGuard.statusCache) {
          if (entry.expiresAt <= now) JwtAuthGuard.statusCache.delete(id);
        }
      }
    } catch (error) {
      // Fail CLOSED. Authorization state lives in the database — if it cannot
      // be read, admitting the request would silently bypass suspension and
      // role changes. A DB outage must produce an error, not a security hole.
      throw error;
    }
    // Rejection happens OUTSIDE the try — a swallowed ForbiddenException here
    // would silently invalidate the whole guard.
    this.rejectIfStale(suspended, role, tokenRole);
  }

  private rejectIfStale(
    suspended: boolean,
    dbRole: string,
    tokenRole: string,
  ): void {
    if (suspended) {
      throw new ForbiddenException(
        'This account is suspended. Contact support for assistance.',
      );
    }
    // Signed role diverged from the DB (promotion/demotion): the token is
    // stale — 401 drives the client through re-authentication.
    if (dbRole !== tokenRole) {
      throw new UnauthorizedException(
        'Your permissions have changed. Please sign in again.',
      );
    }
  }

  private getSecret(): string {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET environment variable is not configured');
    }
    return secret;
  }

  private extractTokenFromHeader(
    request: AuthenticatedRequest,
  ): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
