import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { WritingScoringAgent } from '../agents/writing-scoring.agent';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { withHttpDeadline } from '../common/http-deadline';
import { isValidBand } from '../common/band.utils';
import type { AuthenticatedRequest } from '../auth/authenticated-request';

const scoreWritingSchema = z.object({
  attemptId: z.string().min(1).max(100),
  // Accepted for backwards compatibility only — the server always derives the
  // prompt and task type from the bound question row (see below).
  questionPrompt: z.string().max(5000).optional(),
  taskType: z.enum(['TASK_1', 'TASK_2']).optional(),
  studentEssay: z
    .string()
    .refine((v) => v.trim().split(/\s+/).filter(Boolean).length >= 20, {
      message:
        'Student essay must contain at least 20 words for rubric evaluation',
    })
    .refine((v) => v.trim().split(/\s+/).filter(Boolean).length <= 1500, {
      message: 'Student essay exceeds the maximum of 1500 words',
    }),
});

const overrideSchema = z.object({
  finalBand: z.number().refine(isValidBand, {
    message:
      'finalBand must be a valid IELTS score between 0.0 and 9.0 in 0.5 increments',
  }),
  instructorNotes: z.string().trim().max(2000).optional(),
});

@Controller('scoring')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ScoringController {
  constructor(
    private readonly writingAgent: WritingScoringAgent,
    private readonly prisma: PrismaService,
  ) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('writing')
  async scoreWriting(
    @Body(new ZodValidationPipe(scoreWritingSchema))
    body: z.infer<typeof scoreWritingSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    // Ownership check: students may only score their own attempts.
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: body.attemptId },
      include: { testSet: true },
    });
    if (!attempt)
      throw new NotFoundException(`Attempt ${body.attemptId} not found`);
    const privileged = ['ADMIN'].includes(req.user.role);
    if (attempt.userId !== req.user.sub && !privileged) {
      throw new NotFoundException(`Attempt ${body.attemptId} not found`);
    }

    // Status gate: students may only trigger scoring on a freshly submitted
    // attempt. Finalized / human-owned states can never be overwritten by a
    // student re-rolling the model; INSTRUCTOR+ may rescore deliberately.
    if (!privileged) {
      if (attempt.status !== 'SUBMITTED') {
        throw new ConflictException(
          `Scoring is not available for this attempt (current status: ${attempt.status}). ` +
            'Only submissions awaiting scoring can be scored.',
        );
      }
      if (attempt.testSet.skill !== 'WRITING') {
        throw new BadRequestException(
          'Only writing attempts can be scored through this endpoint',
        );
      }
    }

    // Prompt and task type are derived server-side from the bound question —
    // the client can never shape the rubric context seen by the model.
    const writingQuestion = await this.prisma.question.findFirst({
      where: { testSetId: attempt.testSetId },
      orderBy: { orderIndex: 'asc' },
    });
    if (!writingQuestion) {
      throw new BadRequestException(
        'Attempt has no writing prompt to score against',
      );
    }
    // partNumber is the source of truth (seeded Task 1 chart questions carry
    // no metadata.taskType); metadata is only a legacy hint.
    const metadata =
      (writingQuestion.metadata as Record<string, unknown>) ?? {};
    const taskType =
      writingQuestion.partNumber === 1 || metadata.taskType === 'TASK_1'
        ? 'TASK_1'
        : 'TASK_2';

    // The agent can run two full LLM passes and retries, far longer than the
    // edge limit. Bound the awaited HTTP work so a slow provider yields a 503
    // instead of a 524; scoring itself continues and publishes in background.
    return withHttpDeadline(
      this.writingAgent.scoreEssay({
        attemptId: body.attemptId,
        questionPrompt: writingQuestion.passage
          ? `${writingQuestion.prompt}\n\nDATA SUMMARY: ${writingQuestion.passage}`
          : writingQuestion.prompt,
        taskType,
        studentEssay: body.studentEssay,
        userContext: { userId: req.user.sub, role: req.user.role },
      }),
      'writing scoring',
    );
  }

  @Get('runs')
  @Roles('ADMIN')
  async getAgentRuns() {
    return this.prisma.agentRun.findMany({
      take: 50,
      orderBy: { createdAt: 'desc' },
      include: { steps: true },
    });
  }

  @Get('runs/:id')
  @Roles('ADMIN')
  async getAgentRun(@Param('id') id: string) {
    const run = await this.prisma.agentRun.findUnique({
      where: { id },
      include: { steps: { orderBy: { createdAt: 'asc' } } },
    });
    if (!run) throw new NotFoundException(`Agent run ${id} not found`);
    return run;
  }

  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post('runs/:id/retry')
  @Roles('ADMIN')
  async retryAgentRun(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const run = await this.prisma.agentRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException(`Agent run ${id} not found`);
    const STALE_RUN_MS = 5 * 60 * 1000;
    const isRetryable =
      run.status === 'FAILED' ||
      (run.status === 'RUNNING' &&
        Date.now() - run.createdAt.getTime() > STALE_RUN_MS);
    if (!isRetryable) {
      throw new ConflictException(
        run.status === 'RUNNING'
          ? 'This run is still in progress. It becomes retryable if it stays RUNNING for more than 5 minutes.'
          : `Only FAILED or stale RUNNING runs can be retried (current status: ${run.status})`,
      );
    }
    if (run.agentType !== 'WRITING_SCORING' || !run.attemptId) {
      throw new BadRequestException(
        'Only writing-scoring runs bound to an attempt can be retried',
      );
    }
    if (run.status === 'RUNNING') {
      // Reclaim the wedged run so its state never lies about reality.
      await this.prisma.agentRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          error: 'Released by admin retry after staleness timeout',
        },
      });
    }

    const attempt = await this.prisma.attempt.findUnique({
      where: { id: run.attemptId },
      include: { testSet: true },
    });
    if (!attempt) throw new NotFoundException('Bound attempt no longer exists');
    if (attempt.status === 'SCORING') {
      // Release the wedged attempt back to SUBMITTED so scoring can proceed.
      await this.prisma.attempt.update({
        where: { id: attempt.id },
        data: { status: 'SUBMITTED' },
      });
    }
    const answers = (attempt.answersJson as Record<string, string>) ?? {};
    // Pick the essay in the attempt's served-question order (mirrors the
    // submit path) instead of arbitrary object-key order.
    const snapshotIds = Array.isArray(attempt.questionIdsJson)
      ? (attempt.questionIdsJson as string[])
      : null;
    const orderedQuestions = await this.prisma.question.findMany({
      where: {
        testSetId: attempt.testSetId,
        ...(snapshotIds ? { id: { in: snapshotIds } } : {}),
      },
      orderBy: { orderIndex: 'asc' },
      select: { id: true },
    });
    const essayEntry = orderedQuestions
      .map((q) => answers[q.id])
      .find((v) => typeof v === 'string' && v.trim().length > 0);
    if (!essayEntry)
      throw new BadRequestException('Attempt has no essay content to score');

    // Derive the real prompt/task from the bound question, not placeholders.
    const writingQuestion = await this.prisma.question.findFirst({
      where: { testSetId: attempt.testSetId },
      orderBy: { orderIndex: 'asc' },
    });
    if (!writingQuestion)
      throw new BadRequestException(
        'Attempt has no writing prompt to score against',
      );
    const metadata =
      (writingQuestion.metadata as Record<string, unknown>) ?? {};

    const result = await withHttpDeadline(
      this.writingAgent.scoreEssay({
        attemptId: attempt.id,
        questionPrompt: writingQuestion.passage
          ? `${writingQuestion.prompt}\n\nDATA SUMMARY: ${writingQuestion.passage}`
          : writingQuestion.prompt,
        taskType:
          metadata.taskType === 'TASK_1' || writingQuestion.partNumber === 1
            ? 'TASK_1'
            : 'TASK_2',
        studentEssay: essayEntry,
        userContext: { userId: req.user.sub, role: req.user.role },
      }),
      'run retry',
    );
    return { retriedFrom: run.id, ...result };
  }

  @Get('review-queue')
  @Roles('ADMIN')
  async getReviewQueue(@Query('status') status?: string) {
    // The queue is the AI review AUDIT trail — every automated decision.
    // An unknown filter returns an empty list, never the unfiltered trail.
    const valid = [
      'PENDING',
      'AI_APPROVED',
      'AI_ESCALATED',
      'APPROVED',
      'OVERRIDDEN',
    ];
    const where = status
      ? valid.includes(status)
        ? { status }
        : { id: '__none__' }
      : {};
    return this.prisma.reviewQueueItem.findMany({
      where,
      include: {
        attempt: {
          include: {
            user: { select: { id: true, name: true, email: true } },
            testSet: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /**
   * ADMIN override of an AI review decision. AI agents finalize every band
   * automatically; this endpoint is the single human lever — it overwrites
   * the published score and marks the audit item OVERRIDDEN.
   */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('review-queue/:id/override')
  @Roles('ADMIN')
  async overrideReview(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(overrideSchema))
    body: z.infer<typeof overrideSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    const item = await this.prisma.reviewQueueItem.findUnique({
      where: { id },
      include: { attempt: true },
    });
    if (!item) {
      throw new NotFoundException(`Review queue item ${id} not found`);
    }
    if (!item.attempt) {
      throw new BadRequestException('Review item is not bound to an attempt');
    }

    const transaction = await this.prisma.$transaction(async (tx) => {
      // Conditional update: two concurrent overrides — only the first wins.
      const claim = await tx.reviewQueueItem.updateMany({
        where: { id, status: { not: 'OVERRIDDEN' } },
        data: {
          status: 'OVERRIDDEN',
          finalBand: body.finalBand,
          instructorNotes:
            body.instructorNotes ??
            `${item.instructorNotes ?? ''}\n[ADMIN OVERRIDE] Band set to ${body.finalBand}.`.trim(),
          reviewedById: req.user.sub,
          reviewedAt: new Date(),
        },
      });
      if (claim.count === 0) {
        throw new ConflictException(
          'Review item was just overridden by another admin',
        );
      }
      const updated = await tx.reviewQueueItem.findUnique({ where: { id } });

      // One final score per (attempt, skill) — overriding twice never duplicates.
      await tx.score.upsert({
        where: {
          attemptId_skill: { attemptId: item.attemptId, skill: item.skill },
        },
        update: {
          bandScore: body.finalBand,
          feedbackSummary:
            body.instructorNotes || 'Admin override of the AI review band.',
          scoredBy: 'ADMIN_OVERRIDE',
          confidence: 1.0,
        },
        create: {
          attemptId: item.attemptId,
          skill: item.skill,
          bandScore: body.finalBand,
          feedbackSummary:
            body.instructorNotes || 'Admin override of the AI review band.',
          scoredBy: 'ADMIN_OVERRIDE',
          confidence: 1.0,
        },
      });

      // updateMany (not update): an unexpected IN_PROGRESS attempt must not
      // throw P2025 and roll back the whole override — skip it harmlessly.
      await tx.attempt.updateMany({
        where: { id: item.attemptId, status: { not: 'IN_PROGRESS' } },
        data: { status: 'COMPLETED' },
      });

      return updated;
    });

    return transaction;
  }
}
