import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

export type UserStatus = 'ACTIVE' | 'SUSPENDED';

const LIST_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  status: true,
  targetBand: true,
  subscriptionTier: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

interface ActivityStat {
  attemptsCount: number;
  completedCount: number;
  avgBand: number | null;
  lastActivityAt: Date | null;
}

/**
 * True totals in one aggregate query. The previous roster loaded EVERY attempt
 * (with nested scores) for EVERY user just to count them — memory scaled with
 * all historical activity. COUNT(DISTINCT) avoids score-join multiplication.
 */
async function activityStats(
  prisma: PrismaService,
  userIds: string[],
): Promise<Map<string, ActivityStat>> {
  const result = new Map<string, ActivityStat>();
  if (userIds.length === 0) return result;
  const rows = await prisma.$queryRaw<
    Array<{
      userId: string;
      attemptsCount: number;
      completedCount: number;
      avgBand: number | null;
      lastActivityAt: Date | null;
    }>
  >(Prisma.sql`
    SELECT u.id AS "userId",
      COUNT(DISTINCT a.id)::int AS "attemptsCount",
      COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'COMPLETED')::int AS "completedCount",
      MAX(a."startedAt") AS "lastActivityAt",
      ROUND(AVG(s."bandScore")::numeric, 1) AS "avgBand"
    FROM users u
    LEFT JOIN attempts a ON a."userId" = u.id
    LEFT JOIN scores s ON s."attemptId" = a.id
    WHERE u.id = ANY(${userIds}::text[])
    GROUP BY u.id
  `);
  for (const r of rows) {
    result.set(r.userId, {
      attemptsCount: Number(r.attemptsCount),
      completedCount: Number(r.completedCount),
      avgBand: r.avgBand == null ? null : Number(r.avgBand),
      lastActivityAt: r.lastActivityAt,
    });
  }
  return result;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async updateProfile(
    userId: string,
    body: {
      name?: string;
      targetBand?: number;
      examDate?: string | null;
      moduleType?: 'ACADEMIC' | 'GENERAL';
      dailyCommitmentMinutes?: number | null;
      weakestSkill?: 'LISTENING' | 'READING' | 'WRITING' | 'SPEAKING' | null;
      studyPlan?: Array<{
        id: string;
        day: number;
        title: string;
        skill: string;
        durationMinutes: number;
        isCompleted: boolean;
        taskDetails: string;
      }>;
    },
  ) {
    const data: Prisma.UserUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.targetBand !== undefined) data.targetBand = body.targetBand;
    if (body.examDate !== undefined) {
      data.examDate = body.examDate === null ? null : new Date(body.examDate);
    }
    if (body.moduleType !== undefined) data.moduleType = body.moduleType;
    if (body.dailyCommitmentMinutes !== undefined)
      data.dailyCommitmentMinutes = body.dailyCommitmentMinutes;
    if (body.weakestSkill !== undefined) {
      data.weakestSkill = body.weakestSkill === null ? null : body.weakestSkill;
    }
    if (body.studyPlan !== undefined) {
      data.studyPlanJson = body.studyPlan;
    }

    const user = await this.prisma.user
      .update({
        where: { id: userId },
        data,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          targetBand: true,
          examDate: true,
          moduleType: true,
          dailyCommitmentMinutes: true,
          weakestSkill: true,
          studyPlanJson: true,
        },
      })
      .catch((error) => {
        // A valid JWT for a deleted user is an auth problem, not a 500.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2025'
        ) {
          throw new UnauthorizedException('User not found');
        }
        throw error;
      });
    return user;
  }

  /** Changes the caller's own password and revokes every active session. */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true },
    });
    if (!user) throw new UnauthorizedException('User not found');

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      throw new BadRequestException('Current password is incorrect');
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    // Revoking all refresh tokens logs out every device; access tokens die
    // within their short TTL.
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return { success: true };
  }

  /** Admin: paginated roster with per-user activity stats. */
  async listUsers(params: {
    query?: string;
    role?: Role;
    status?: UserStatus;
    take?: number;
  }) {
    const take = Math.min(Math.max(params.take ?? 100, 1), 200);
    const users = await this.prisma.user.findMany({
      where: {
        ...(params.role ? { role: params.role } : {}),
        ...(params.status ? { status: params.status } : {}),
        ...(params.query
          ? {
              OR: [
                { email: { contains: params.query, mode: 'insensitive' } },
                { name: { contains: params.query, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: LIST_SELECT,
      orderBy: { createdAt: 'desc' },
      take,
    });

    const stats = await activityStats(this.prisma, users.map((u) => u.id));
    return users.map((u) => {
      const s = stats.get(u.id);
      return {
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        status: u.status,
        targetBand: u.targetBand,
        subscriptionTier: u.subscriptionTier,
        createdAt: u.createdAt,
        attemptsCount: s?.attemptsCount ?? 0,
        completedCount: s?.completedCount ?? 0,
        avgBand: s?.avgBand ?? null,
        lastActivityAt: s?.lastActivityAt ?? null,
      };
    });
  }

  /** Admin: platform-wide KPI counters for the overview dashboard. */
  async getPlatformStats() {
    const [
      users,
      learners,
      admins,
      attempts,
      completed,
      pendingReviews,
      agentRuns,
      questions,
      certificates,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { role: Role.USER } }),
      this.prisma.user.count({ where: { role: Role.ADMIN } }),
      this.prisma.attempt.count(),
      this.prisma.attempt.count({ where: { status: 'COMPLETED' } }),
      // In the AI-only model nothing waits for humans — the admin-attention
      // set is what the agents ESCALATED.
      this.prisma.reviewQueueItem.count({ where: { status: 'AI_ESCALATED' } }),
      this.prisma.agentRun.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.question.count(),
      this.prisma.certificate.count(),
    ]);
    return {
      users: {
        total: users,
        learners,
        admins,
        suspended: await this.prisma.user.count({
          where: { status: 'SUSPENDED' },
        }),
      },
      attempts: { total: attempts, completed },
      pendingReviews,
      agentRuns: agentRuns.map((g) => ({
        status: g.status,
        count: g._count._all,
      })),
      questions,
      certificates,
    };
  }

  /**
   * Role-based promotion/demotion in the two-role model: USER <-> ADMIN.
   * Nobody changes their own role; the last active ADMIN cannot be demoted
   * (that would lock every admin-only surface).
   */
  async changeRole(
    actor: { sub: string; role: string },
    targetUserId: string,
    newRole: Role,
  ) {
    if (actor.sub === targetUserId) {
      throw new ConflictException('You cannot change your own role');
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, role: true, status: true },
    });
    if (!target) throw new NotFoundException('User not found');
    if (target.role === newRole) {
      throw new ConflictException(`User already has role ${newRole}`);
    }

    if (
      target.role === Role.ADMIN &&
      newRole !== Role.ADMIN &&
      target.status === 'ACTIVE'
    ) {
      // A suspended admin is not counted in activeAdmins, so demoting one can
      // never remove the last ACTIVE admin — skip the guard in that case.
      // Serialize concurrent admin demotions: lock all active admin rows
      // first, then re-check the count inside the same transaction — two
      // simultaneous demotions can never both pass the guard.
      const demoted = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "users" WHERE role = 'ADMIN' AND status = 'ACTIVE' FOR UPDATE`;
        const activeAdmins = await tx.user.count({
          where: { role: Role.ADMIN, status: 'ACTIVE' },
        });
        if (activeAdmins <= 1) return null;
        const claimed = await tx.user.updateMany({
          where: { id: targetUserId, role: Role.ADMIN },
          data: { role: newRole },
        });
        if (claimed.count === 0) return null;
        return tx.user.findUnique({
          where: { id: targetUserId },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            status: true,
          },
        });
      });
      if (!demoted) {
        throw new ConflictException('Cannot demote the last active ADMIN');
      }
      await this.revokeSessions(targetUserId);
      return demoted;
    }

    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { role: newRole },
      select: { id: true, email: true, name: true, role: true, status: true },
    });
    await this.revokeSessions(targetUserId);
    return updated;
  }

  /** Role changes sign out every session so the new role applies on re-login. */
  private async revokeSessions(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    JwtAuthGuard.invalidateStatus(userId);
  }

  /**
   * Suspend / reactivate an account. Suspending revokes every refresh token
   * and immediately invalidates the guard cache, locking the account out on
   * its very next request.
   */
  async setStatus(
    actor: { sub: string; role: string },
    targetUserId: string,
    status: UserStatus,
  ) {
    if (actor.sub === targetUserId) {
      throw new ConflictException('You cannot change your own account status');
    }
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, role: true, status: true },
    });
    if (!target) throw new NotFoundException('User not found');
    if (target.status === status) {
      throw new ConflictException(`User is already ${status}`);
    }

    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { status },
      select: { id: true, email: true, name: true, role: true, status: true },
    });

    // Suspending revokes every refresh token (revokeSessions) so the account
    // is locked out immediately; the guard cache is invalidated too.
    await this.revokeSessions(targetUserId);
    return updated;
  }

  /** Admin: full activity record for one learner. */
  async getStudentDetail(studentId: string) {
    const student = await this.prisma.user.findFirst({
      where: { id: studentId, role: Role.USER },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        targetBand: true,
        examDate: true,
        moduleType: true,
        weakestSkill: true,
        dailyCommitmentMinutes: true,
        createdAt: true,
        attempts: {
          orderBy: { startedAt: 'desc' },
          take: 50,
          select: {
            id: true,
            status: true,
            startedAt: true,
            submittedAt: true,
            testSet: { select: { id: true, title: true, skill: true } },
            scores: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: {
                bandScore: true,
                scoredBy: true,
                feedbackSummary: true,
              },
            },
          },
        },
      },
    });
    if (!student) throw new NotFoundException('Student not found');

    // Counters must describe the whole history, not the 50 rows rendered below.
    const stats = (await activityStats(this.prisma, [studentId])).get(studentId);
    const allScores = await this.prisma.score.findMany({
      where: { attempt: { userId: studentId } },
      orderBy: { createdAt: 'desc' },
      select: { skill: true, bandScore: true },
    });
    const latestPerSkill: Record<string, number> = {};
    for (const s of allScores) {
      if (!(s.skill in latestPerSkill)) latestPerSkill[s.skill] = s.bandScore;
    }

    return {
      ...student,
      stats: {
        attemptsCount: stats?.attemptsCount ?? 0,
        completedCount: stats?.completedCount ?? 0,
        avgBand: stats?.avgBand ?? null,
        latestPerSkill,
      },
    };
  }

  /** Admin: learner roster with engagement stats. */
  async listStudents(query?: string) {
    const students = await this.prisma.user.findMany({
      where: {
        role: Role.USER,
        ...(query
          ? {
              OR: [
                { email: { contains: query, mode: 'insensitive' } },
                { name: { contains: query, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: LIST_SELECT,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const stats = await activityStats(this.prisma, students.map((u) => u.id));
    return students.map((u) => {
      const s = stats.get(u.id);
      return {
        id: u.id,
        email: u.email,
        name: u.name,
        status: u.status,
        targetBand: u.targetBand,
        createdAt: u.createdAt,
        attemptsCount: s?.attemptsCount ?? 0,
        completedCount: s?.completedCount ?? 0,
        avgBand: s?.avgBand ?? null,
        lastActivityAt: s?.lastActivityAt ?? null,
      };
    });
  }
}
