import {
  Body,
  Controller,
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

const BASE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};

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

const ACCESS_TTL_MS = parseJwtTtlMs(process.env.JWT_EXPIRES_IN);
const REFRESH_TTL_MS =
  Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 7) * 24 * 60 * 60 * 1000;

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
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.refresh(
      req.cookies?.refresh_token as string | undefined,
    );
    this.setAuthCookies(res, result.accessToken, result.refreshToken);
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
    res.clearCookie('access_token', { ...BASE_COOKIE_OPTIONS });
    res.clearCookie('refresh_token', { ...BASE_COOKIE_OPTIONS });
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
  ) {
    res.cookie('access_token', accessToken, {
      ...BASE_COOKIE_OPTIONS,
      maxAge: ACCESS_TTL_MS,
    });
    res.cookie('refresh_token', refreshToken, {
      ...BASE_COOKIE_OPTIONS,
      maxAge: REFRESH_TTL_MS,
    });
  }
}
