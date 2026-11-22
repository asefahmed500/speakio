import {
  Body,
  Controller,
  Headers,
  Get,
  HttpCode,
  Post,
  Res,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response, Request } from 'express';
import { z } from 'zod';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { AuthenticatedRequest } from './authenticated-request';

const registerSchema = z.object({
  email: z.string().trim().email('A valid email address is required').max(254),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128),
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  targetBand: z.number().min(4).max(9).optional(),
});

const loginSchema = z.object({
  email: z.string().trim().email('A valid email address is required').max(254),
  password: z.string().min(1, 'Password is required').max(128),
});

// Deployment note: when the frontend and API run on DIFFERENT sites (e.g. a
// *.workers.dev frontend against a tunneled API), browsers only accept
// cross-site auth cookies with SameSite=None + Secure. Set
// COOKIE_SAMESITE=none in that topology; same-origin deployments keep lax.
// Read lazily: controllers are evaluated while module imports run, which is
// before main.ts loads dotenv. A module-scope read silently ignored .env.
function cookieSameSite(): 'lax' | 'none' {
  return process.env.COOKIE_SAMESITE === 'none' ? 'none' : 'lax';
}
const resetRequestSchema = z.object({
  email: z.string().trim().email('A valid email address is required').max(254),
});

const resetPasswordSchema = z.object({
  token: z.string().min(20).max(128),
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128),
});

function baseCookieOptions() {
  const sameSite = cookieSameSite();
  return {
    httpOnly: true,
    // SameSite=None cookies must be Secure. For local HTTP dev use lax so the
    // browser actually stores the session cookie.
    secure: process.env.NODE_ENV === 'production' || sameSite === 'none',
    sameSite,
    path: '/',
  };
}

/** "15m" | "12h" | "7d" | "60" -> milliseconds; falls back to 15 minutes. */
function parseJwtTtlMs(raw: string | undefined): number {
  const match = /^(\d+)([smhd])$/.exec(raw ?? '');
  if (!match) return 15 * 60 * 1000;
  const value = Number(match[1]);
  const unitMs: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return value * unitMs[match[2]];
}

function accessTtlMs(): number {
  // Read lazily (not at module scope) so .env values loaded by ConfigModule
  // are always honored — module-scope reads race env loading.
  return parseJwtTtlMs(process.env.JWT_EXPIRES_IN);
}

function refreshTtlMs(): number {
  return Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 7) * 24 * 60 * 60 * 1000;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register')
  async register(
    @Body(new ZodValidationPipe(registerSchema))
    body: z.infer<typeof registerSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, tokens } = await this.authService.register(body);
    this.setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      targetBand: user.targetBand,
      subscriptionTier: user.subscriptionTier,
    };
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: z.infer<typeof loginSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, tokens } = await this.authService.login(body);
    this.setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    return user;
  }

  /**
   * Exchanges a valid refresh cookie for a rotated pair. Replaying a rotated
   * token revokes the whole session family (theft detection).
   */
  /** Always 200 — account existence is never revealed. */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('forgot-password')
  async forgotPassword(
    @Body(new ZodValidationPipe(resetRequestSchema))
    body: z.infer<typeof resetRequestSchema>,
  ) {
    await this.authService.requestPasswordReset(body.email);
    return { message: 'If an account exists, a reset link has been sent.' };
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('reset-password')
  async resetPassword(
    @Body(new ZodValidationPipe(resetPasswordSchema))
    body: z.infer<typeof resetPasswordSchema>,
  ) {
    await this.authService.resetPassword(body.token, body.newPassword);
    return { message: 'Password updated. Please sign in.' };
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Headers('x-refresh-no-rotate') noRotate?: string,
  ) {
    const result = await this.authService.refresh(
      req.cookies?.refresh_token as string | undefined,
      noRotate !== '1',
    );
    this.setAuthCookies(
      res,
      result.accessToken,
      result.refreshToken,
      result.refreshTokenExpiresAt
        ? Math.max(0, new Date(result.refreshTokenExpiresAt).getTime() - Date.now())
        : undefined
    );
    return result.user;
  }

  /**
   * Revokes the refresh-token family server-side (the access token itself
   * expires within its short TTL), then clears both cookies.
   */
  @HttpCode(200)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.authService.logout(
      req.cookies?.refresh_token as string | undefined,
    );
    const options = baseCookieOptions();
    res.clearCookie('access_token', options);
    res.clearCookie('refresh_token', options);
    return { success: true, message: 'Logged out successfully' };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMe(@Req() req: AuthenticatedRequest) {
    return this.authService.getProfile(req.user.sub);
  }

  private setAuthCookies(
    res: Response,
    accessToken: string,
    refreshToken: string,
    refreshMaxAge?: number,
  ) {
    res.cookie('access_token', accessToken, {
      ...baseCookieOptions(),
      maxAge: accessTtlMs(),
    });
    res.cookie('refresh_token', refreshToken, {
      ...baseCookieOptions(),
      // No-rotate RSC refreshes reuse the existing token — its real expiry is
      // unchanged, so the browser cookie must not be extended to 7 days.
      maxAge: refreshMaxAge ?? refreshTtlMs(),
    });
  }
}
