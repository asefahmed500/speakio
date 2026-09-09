import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AttemptsService } from '../attempts/attempts.service';
import { AttemptStatus, SkillType } from '@prisma/client';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attemptsService: AttemptsService,
  ) {}

  async getStats(userId: string) {
    const { perSkill, overall } = await this.attemptsService.latestBandsPerSkill(userId);

    const [attemptCount, completedCount, certificates, recentAttempts, user] = await Promise.all([
      this.prisma.attempt.count({ where: { userId } }),
      this.prisma.attempt.count({ where: { userId, status: AttemptStatus.COMPLETED } }),
      this.prisma.certificate.findMany({ where: { userId }, orderBy: { issuedAt: 'desc' } }),
      this.prisma.attempt.findMany({
        where: { userId },
        orderBy: { startedAt: 'desc' },
        take: 5,
        include: {
          testSet: { select: { id: true, title: true, skill: true } },
          scores: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      }),
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { targetBand: true, examDate: true, studyPlanJson: true, weakestSkill: true },
      }),
    ]);

    const studyPlan = Array.isArray(user.studyPlanJson)
      ? (user.studyPlanJson as Array<{ id: string; isCompleted?: boolean }>)
      : [];
    const milestonesCompleted = studyPlan.filter((m) => m.isCompleted).length;

    return {
      overallBand: overall,
      targetBand: user.targetBand,
      examDate: user.examDate,
      weakestSkill: user.weakestSkill,
      perSkill,
      totals: {
        attempts: attemptCount,
        completed: completedCount,
        certificates: certificates.length,
        milestonesCompleted,
        milestonesTotal: studyPlan.length,
      },
      recentAttempts: recentAttempts.map((a) => ({
        id: a.id,
        status: a.status,
        title: a.testSet.title,
        skill: a.testSet.skill,
        submittedAt: a.submittedAt,
        bandScore: a.scores[0]?.bandScore ?? null,
      })),
      activeCertificate: certificates.find((c) => c.status === 'ACTIVE') ?? null,
    };
  }

  /** Per-skill best/latest band summary used by the skills practice pages. */
  async getSkillSummary(userId: string, skill: SkillType) {
    const [attempts, latestBand] = await Promise.all([
      this.prisma.attempt.findMany({
        where: { userId, testSet: { skill } },
        orderBy: { startedAt: 'desc' },
        take: 10,
        include: {
          testSet: { select: { id: true, title: true } },
          scores: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      }),
      this.prisma.score.findFirst({
        where: { attempt: { userId }, skill },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const bands = await this.prisma.score.findMany({
      where: { attempt: { userId }, skill },
      orderBy: { createdAt: 'asc' },
      select: { bandScore: true, createdAt: true },
    });

    return {
      latestBand: latestBand?.bandScore ?? null,
      attemptsCount: attempts.length,
      attempts: attempts.map((a) => ({
        id: a.id,
        title: a.testSet.title,
        status: a.status,
        submittedAt: a.submittedAt,
        bandScore: a.scores[0]?.bandScore ?? null,
      })),
      bandHistory: bands.map((b) => ({ band: b.bandScore, date: b.createdAt })),
    };
  }
}
