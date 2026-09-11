import type { Request } from 'express';

/**
 * Shape the JwtAuthGuard guarantees on `request.user` after successful
 * verification. Controllers must derive authorization ONLY from this —
 * never from client-provided body/query fields.
 */
export interface AuthenticatedUser {
  sub: string;
  email?: string;
  /** Signed by our own auth service on every token — always present. */
  role: string;
  name?: string;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}
