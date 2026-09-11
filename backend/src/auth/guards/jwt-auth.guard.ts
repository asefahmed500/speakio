import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import type {
  AuthenticatedRequest,
  AuthenticatedUser,
} from '../authenticated-request';

type VerifiedPayload = AuthenticatedUser;

@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
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

    request.user = payload;
    return true;
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
