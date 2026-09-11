import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';
import { Prisma, Role, User } from '@prisma/client';

/** Refresh-token lifetime in days (REFRESH_TOKEN_TTL_DAYS). */
const REFRESH_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 7);

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
  constructor(private readonly prisma: PrismaService) {}

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
          role: Role.STUDENT,
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
      },
    });
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isValid = await bcrypt.compare(data.password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Invalid email or password');
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
      select: PROFILE_SELECT,
    });
    if (!user) {
      await this.revokeFamily(stored.familyId);
      throw new UnauthorizedException('Account no longer exists');
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
    return new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
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
