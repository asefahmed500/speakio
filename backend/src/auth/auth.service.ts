import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';
import { Prisma, Role, User } from '@prisma/client';
import { PasswordResetMailer } from './password-reset-mailer.service';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

const PROFILE_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  targetBand: true,
  subscriptionTier: true,
} as const;

/**
 * Issues short-lived signed access tokens plus rotating refresh tokens.
 *
 * Revocation model: refresh tokens are stored server-side (SHA-256 hash) and
 * grouped in families. Logout revokes the family; replaying an already-rotated
 * token is treated as theft and revokes the whole family. Access tokens die
 * naturally within their short TTL.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private static readonly RESET_TTL_MS = 30 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly resetMailer: PasswordResetMailer,
  ) {}

  /**
   * Always returns successfully — never reveal whether an account exists.
   * A previously issued link is consumed so only the newest one is usable.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const normalized = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalized },
      select: { id: true, email: true },
    });
    if (!user) return;

    const raw = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + AuthService.RESET_TTL_MS);
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.passwordResetToken.create({
        data: {
          tokenHash: this.hashToken(raw),
          userId: user.id,
          expiresAt,
        },
      }),
    ]);

    const frontend = (process.env.FRONTEND_URL ?? 'http://localhost:3000')
      .split(',')[0]
      .trim();
    const link = `${frontend}/reset-password?token=${encodeURIComponent(raw)}`;
    try {
      await this.resetMailer.send(user.email, link);
    } catch (error) {
      // The token is real but the email provider is down: log it, never tell
      // the caller "sent" if delivery failed.
      this.logger.error(
        `Reset email failed for ${user.email}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /** Single-use, expiring, token-bound password change. Revokes all sessions. */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]{20,128}$/.test(token)) {
      throw new BadRequestException('Invalid or expired reset link');
    }
    const stored = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: this.hashToken(token) },
    });
    if (
      !stored ||
      stored.usedAt !== null ||
      stored.expiresAt.getTime() <= Date.now()
    ) {
      throw new BadRequestException('Invalid or expired reset link');
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: stored.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: stored.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  async register(data: {
    email: string;
    password: string;
    name: string;
    targetBand?: number;
  }) {
    const email = data.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('User with this email already exists');
    }

    const passwordHash = await bcrypt.hash(data.password, 10);
    // Role is ALWAYS server-assigned. Privilege levels cannot be self-declared.
    let user: User;
    try {
      user = await this.prisma.user.create({
        data: {
          email,
          passwordHash,
          name: data.name,
          role: Role.USER,
          targetBand: data.targetBand ?? 7.0,
        },
      });
    } catch (error) {
      // Catches the concurrent-registration race where two requests both pass
      // the pre-check; the unique email constraint is the real backstop.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('User with this email already exists');
      }
      throw error;
    }

    const tokens = await this.issueTokens(user);
    return { user, tokens };
  }

  async login(data: { email: string; password: string }) {
    // Select only safe columns — the raw row includes passwordHash and must
    // never reach the controller's response.
    const user = await this.prisma.user.findUnique({
      where: { email: data.email.toLowerCase() },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        targetBand: true,
        subscriptionTier: true,
        passwordHash: true,
        status: true,
      },
    });
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isValid = await bcrypt.compare(data.password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (user.status === 'SUSPENDED') {
      throw new UnauthorizedException(
        'This account is suspended. Contact support for assistance.',
      );
    }

    const tokens = await this.issueTokens(user);
    // Explicit safe projection — the selected row still contains passwordHash
    // and must never be returned to the client.
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        targetBand: user.targetBand,
        subscriptionTier: user.subscriptionTier,
      },
      tokens,
    };
  }

  /**
   * Rotates a refresh token. Reuse of a rotated (revoked) token revokes the
   * entire family before rejecting — the standard theft-detection response.
   */
  async refresh(rawToken: string | undefined) {
    if (!rawToken) {
      throw new UnauthorizedException('Refresh token missing');
    }

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hashToken(rawToken) },
      include: { user: true },
    });
    if (!stored) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (stored.revokedAt) {
      await this.revokeFamily(stored.familyId);
      throw new UnauthorizedException(
        'Refresh token reuse detected — session revoked',
      );
    }
    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    const nextRaw = crypto.randomBytes(48).toString('base64url');
    const expiresAt = this.refreshExpiry();
    await this.prisma.$transaction([
      this.prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() },
      }),
      this.prisma.refreshToken.create({
        data: {
          tokenHash: this.hashToken(nextRaw),
          userId: stored.userId,
          familyId: stored.familyId,
          expiresAt,
        },
      }),
    ]);

    const user = await this.prisma.user.findUnique({
      where: { id: stored.userId },
      select: { ...PROFILE_SELECT, status: true },
    });
    if (!user) {
      await this.revokeFamily(stored.familyId);
      throw new UnauthorizedException('Account no longer exists');
    }
    if (user.status === 'SUSPENDED') {
      await this.revokeFamily(stored.familyId);
      throw new UnauthorizedException(
        'This account is suspended. Contact support for assistance.',
      );
    }

    return {
      accessToken: this.generateAccessToken({ ...stored.user }),
      refreshToken: nextRaw,
      refreshTokenExpiresAt: expiresAt,
      user,
    };
  }

  /** Revokes the refresh-token family so no new access tokens can be minted. */
  async logout(rawToken: string | undefined) {
    if (!rawToken) return;
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hashToken(rawToken) },
    });
    if (stored) {
      await this.revokeFamily(stored.familyId);
    }
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        targetBand: true,
        examDate: true,
        moduleType: true,
        subscriptionTier: true,
        dailyCommitmentMinutes: true,
        weakestSkill: true,
        studyPlanJson: true,
        createdAt: true,
      },
    });
    if (!user) throw new UnauthorizedException('User not found');
    return user;
  }

  generateAccessToken(user: {
    id: string;
    email: string;
    role: Role;
    name: string;
  }): string {
    const expiresIn = process.env.JWT_EXPIRES_IN || '15m';
    return jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
      },
      this.getSecret(),
      { expiresIn: expiresIn as jwt.SignOptions['expiresIn'] },
    );
  }

  getSecret(): string {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET environment variable is not configured');
    }
    return secret;
  }

  private async issueTokens(user: {
    id: string;
    email: string;
    role: Role;
    name: string;
  }): Promise<TokenPair> {
    const accessToken = this.generateAccessToken(user);
    const refreshToken = crypto.randomBytes(48).toString('base64url');
    const expiresAt = this.refreshExpiry();
    await this.prisma.refreshToken.create({
      data: {
        tokenHash: this.hashToken(refreshToken),
        userId: user.id,
        familyId: crypto.randomUUID(),
        expiresAt,
      },
    });
    return { accessToken, refreshToken, refreshTokenExpiresAt: expiresAt };
  }

  private refreshExpiry(): Date {
    // Read lazily (not at module scope): ConfigModule loads .env during module
    // init, so import-time reads race the env contract and silently fall back.
    const days = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 7);
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  private hashToken(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  private async revokeFamily(familyId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
