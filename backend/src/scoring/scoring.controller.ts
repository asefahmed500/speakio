import {
  Controller,
  Post,
  Get,
  Body,
  Param,
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
import { isValidBand } from '../common/band.utils';

const scoreWritingSchema = z.object({
  attemptId: z.string().min(1).max(100),
  questionPrompt: z.string().min(1).max(5000),
  taskType: z.enum(['TASK_1', 'TASK_2']),
  studentEssay: z
    .string()
    .refine((v) => v.trim().split(/\s+/).filter(Boolean).length >= 20, {
      message: 'Student essay must contain at least 20 words for rubric evaluation',
    })
    .refine((v) => v.trim().split(/\s+/).filter(Boolean).length <= 1500, {
      message: 'Student essay exceeds the maximum of 1500 words',
    }),
});

const resolveSchema = z.object({
  action: z.enum(['APPROVE', 'OVERRIDE']),
  finalBand: z.number().refine(isValidBand, {
    message: 'finalBand must be a valid IELTS score between 0.0 and 9.0 in 0.5 increments',
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
    @Req() req: any,
  ) {
    // Ownership check: students may only score their own attempts.
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: body.attemptId },
      include: { testSet: true },
    });
    if (!attempt) throw new NotFoundException(`Attempt ${body.attemptId} not found`);
    const privileged = ['INSTRUCTOR', 'ADMIN', 'SUPER_ADMIN'].includes(req.user.role);
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
        throw new BadRequestException('Only writing attempts can be scored through this endpoint');
      }
    }

    // Prompt and task type are derived server-side from the bound question —
    // the client can never shape the rubric context seen by the model.
    const writingQuestion = await this.prisma.question.findFirst({
      where: { testSetId: attempt.testSetId },
      orderBy: { orderIndex: 'asc' },
    });
    if (!writingQuestion) {
      throw new BadRequestException('Attempt has no writing prompt to score against');
    }
    const metadata = (writingQuestion.metadata as Record<string, unknown>) ?? {};
    const taskType = metadata.taskType === 'TASK_1' ? 'TASK_1' : 'TASK_2';

    return this.writingAgent.scoreEssay({
      attemptId: body.attemptId,
      questionPrompt: writingQuestion.prompt,
      taskType,
      studentEssay: body.studentEssay,
      userContext: { userId: req.user.sub, role: req.user.role },
    });
  }

  @Get('runs')
  @Roles('ADMIN', 'SUPER_ADMIN')
  async getAgentRuns() {
    return this.prisma.agentRun.findMany({
      take: 50,
      orderBy: { createdAt: 'desc' },
      include: { steps: true },
    });
  }

  @Get('runs/:id')
  @Roles('ADMIN', 'SUPER_ADMIN')
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
  @Roles('ADMIN', 'SUPER_ADMIN')
  async retryAgentRun(@Param('id') id: string, @Req() req: any) {
    const run = await this.prisma.agentRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException(`Agent run ${id} not found`);
    const STALE_RUN_MS = 5 * 60 * 1000;
    const isRetryable =
      run.status === 'FAILED' ||
      (run.status === 'RUNNING' && Date.now() - run.createdAt.getTime() > STALE_RUN_MS);
    if (!isRetryable) {
      throw new ConflictException(
        run.status === 'RUNNING'
          ? 'This run is still in progress. It becomes retryable if it stays RUNNING for more than 5 minutes.'
          : `Only FAILED or stale RUNNING runs can be retried (current status: ${run.status})`,
      );
    }
    if (run.agentType !== 'WRITING_SCORING' || !run.attemptId) {
      throw new BadRequestException('Only writing-scoring runs bound to an attempt can be retried');
    }
    if (run.status === 'RUNNING') {
      // Reclaim the wedged run so its state never lies about reality.
      await this.prisma.agentRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', error: 'Released by admin retry after staleness timeout' },
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
    const essayEntry = Object.values(answers).find((v) => typeof v === 'string' && v.trim().length > 0);
    if (!essayEntry) throw new BadRequestException('Attempt has no essay content to score');

    // Derive the real prompt/task from the bound question, not placeholders.
    const writingQuestion = await this.prisma.question.findFirst({
      where: { testSetId: attempt.testSetId },
      orderBy: { orderIndex: 'asc' },
    });
    if (!writingQuestion) throw new BadRequestException('Attempt has no writing prompt to score against');
    const metadata = (writingQuestion.metadata as Record<string, unknown>) ?? {};

    const result = await this.writingAgent.scoreEssay({
      attemptId: attempt.id,
      questionPrompt: writingQuestion.passage
        ? `${writingQuestion.prompt}\n\nDATA SUMMARY: ${writingQuestion.passage}`
        : writingQuestion.prompt,
      taskType: metadata.taskType === 'TASK_1' || writingQuestion.partNumber === 1 ? 'TASK_1' : 'TASK_2',
      studentEssay: essayEntry,
      userContext: { userId: req.user.sub, role: req.user.role },
    });
    return { retriedFrom: run.id, ...result };
  }

  @Get('review-queue')
  @Roles('INSTRUCTOR', 'ADMIN', 'SUPER_ADMIN')
  async getReviewQueue() {
    return this.prisma.reviewQueueItem.findMany({
      where: { status: 'PENDING' },
      include: {
        attempt: {
          include: {
            user: { select: { id: true, name: true, email: true } },
            testSet: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('review-queue/:id/resolve')
  @Roles('INSTRUCTOR', 'ADMIN', 'SUPER_ADMIN')
  async resolveReview(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(resolveSchema)) body: z.infer<typeof resolveSchema>,
    @Req() req: any,
  ) {
    const item = await this.prisma.reviewQueueItem.findUnique({
      where: { id },
      include: { attempt: true },
    });
    if (!item) {
      throw new NotFoundException(`Review queue item ${id} not found`);
    }
    if (item.status !== 'PENDING') {
      throw new ConflictException(`Review item has already been resolved (${item.status})`);
    }
    if (item.skill !== 'SPEAKING' && !item.attempt) {
      throw new BadRequestException('Review item is not bound to an attempt');
    }

    // Audio responses (SPEAKING) may be large; the reviewer gets essay text only.
    const transaction = await this.prisma.$transaction(async (tx) => {
      // Conditional update inside the transaction: two concurrent resolves —
      // only the first transitions PENDING → resolved; the second conflicts.
      const claim = await tx.reviewQueueItem.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: body.action === 'APPROVE' ? 'APPROVED' : 'OVERRIDDEN',
          finalBand: body.finalBand,
          instructorNotes: body.instructorNotes,
          reviewedById: req.user.sub,
          reviewedAt: new Date(),
        },
      });
      if (claim.count === 0) {
        throw new ConflictException('Review item was just resolved by another examiner');
      }
      const updated = await tx.reviewQueueItem.findUnique({ where: { id } });

      // One final score per (attempt, skill) — resolving twice can never duplicate.
      await tx.score.upsert({
        where: { attemptId_skill: { attemptId: item.attemptId, skill: item.skill } },
        update: {
          bandScore: body.finalBand,
          feedbackSummary: body.instructorNotes || 'Instructor verified band score.',
          scoredBy: 'INSTRUCTOR',
          confidence: 1.0,
        },
        create: {
          attemptId: item.attemptId,
          skill: item.skill,
          bandScore: body.finalBand,
          feedbackSummary: body.instructorNotes || 'Instructor verified band score.',
          scoredBy: 'INSTRUCTOR',
          confidence: 1.0,
        },
      });

      await tx.attempt.update({
        where: { id: item.attemptId },
        data: { status: 'COMPLETED' },
      });

      return updated;
    });

    return transaction;
  }
}
