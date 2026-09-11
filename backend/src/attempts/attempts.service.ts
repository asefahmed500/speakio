import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  ServiceUnavailableException,
  HttpException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WritingScoringAgent } from '../agents/writing-scoring.agent';
import { QuestionUniquenessService } from '../tests/question-uniqueness.service';
import { QUESTIONS_PER_ATTEMPT } from '../tests/tests.service';
import { rawToBand, overallBandOf } from '../common/band.utils';
import { AttemptStatus, Prisma, SkillType, Attempt } from '@prisma/client';

const MAX_AUDIO_BASE64_BYTES = 6 * 1024 * 1024;

@Injectable()
export class AttemptsService {
  private readonly logger = new Logger(AttemptsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly writingAgent: WritingScoringAgent,
    private readonly uniqueness: QuestionUniquenessService,
  ) {}

  async start(userId: string, testSetId: string) {
    const testSet = await this.prisma.testSet.findUnique({
      where: { id: testSetId },
    });
    if (!testSet)
      throw new NotFoundException(`Test set ${testSetId} not found`);

    // Resume: if an in-progress attempt already exists for this user+test, return it.
    // Its question snapshot is immutable — a refresh never re-rolls the questions.
    const existing = await this.prisma.attempt.findFirst({
      where: { userId, testSetId, status: AttemptStatus.IN_PROGRESS },
      orderBy: { startedAt: 'desc' },
    });
    if (existing) {
      return { ...existing, resumed: true };
    }

    const pool = await this.prisma.question.findMany({
      where: { testSetId },
      orderBy: { orderIndex: 'asc' },
    });
    // Adaptive selection: serve a never-seen subset when the pool is larger
    // than one attempt's worth of questions; otherwise the full fixed set.
    const selected =
      pool.length > QUESTIONS_PER_ATTEMPT
        ? await this.uniqueness.selectForUser(
            userId,
            pool,
            QUESTIONS_PER_ATTEMPT,
          )
        : pool;
    const questionIds = selected.map((q) => q.id);

    let attempt: Attempt;
    try {
      attempt = await this.prisma.attempt.create({
        data: {
          userId,
          testSetId,
          status: AttemptStatus.IN_PROGRESS,
          timeRemainingSeconds: testSet.timeLimitMinutes * 60,
          answersJson: {},
          questionIdsJson: questionIds,
        },
      });
    } catch (error) {
      // Lost the race against a concurrent start (double tab, double click):
      // the partial unique index on (userId, testSetId) WHERE IN_PROGRESS
      // rejects the duplicate — resume the winner's attempt instead of 500ing.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const winner = await this.prisma.attempt.findFirst({
          where: { userId, testSetId, status: AttemptStatus.IN_PROGRESS },
          orderBy: { startedAt: 'desc' },
        });
        if (winner) return { ...winner, resumed: true };
      }
      throw error;
    }

    // Persist what this user has now seen so no future attempt (here or in any
    // other test) serves these questions while fresh ones remain.
    await this.uniqueness.recordShown(userId, questionIds);
    return attempt;
  }

  async autosave(
    userId: string,
    attemptId: string,
    answers: Record<string, string>,
    timeRemainingSeconds?: number,
  ) {
    const attempt = await this.getOwnedAttempt(userId, attemptId);
    if (attempt.status !== AttemptStatus.IN_PROGRESS) {
      throw new ConflictException(
        `Attempt is ${attempt.status} and can no longer be modified`,
      );
    }
    const mergedAnswers = {
      ...(attempt.answersJson as Record<string, string>),
      ...answers,
    };
    // Conditional update: the attempt must still be IN_PROGRESS when the write
    // lands. An autosave racing a submit can no longer clobber graded answers.
    const result = await this.prisma.attempt.updateMany({
      where: { id: attemptId, status: AttemptStatus.IN_PROGRESS },
      data: {
        answersJson: mergedAnswers,
        ...(typeof timeRemainingSeconds === 'number'
          ? {
              timeRemainingSeconds: Math.max(
                0,
                Math.min(6 * 60 * 60, Math.floor(timeRemainingSeconds)),
              ),
            }
          : {}),
      },
    });
    if (result.count === 0) {
      throw new ConflictException(
        'Attempt is no longer in progress and was not modified',
      );
    }
    return this.getOwnedAttempt(userId, attemptId);
  }

  /**
   * Submits an attempt. Idempotent per attempt state: only IN_PROGRESS attempts
   * can be submitted. WRITING runs the AI scoring agent inline; LISTENING/READING
   * are auto-graded server-side; SPEAKING routes to human review.
   */
  async submit(
    userId: string,
    attemptId: string,
    answers: Record<string, string>,
    timeRemainingSeconds?: number,
  ) {
    const attempt = await this.getOwnedAttempt(userId, attemptId, true);

    if (attempt.status !== AttemptStatus.IN_PROGRESS) {
      throw new ConflictException(
        `Attempt is already ${attempt.status}. Retake the test to submit a new attempt.`,
      );
    }

    const testSet = attempt.testSet;
    // Grade against the attempt's question snapshot — the exact set this user
    // was served — never the whole (possibly larger) adaptive pool.
    const snapshotIds = Array.isArray(attempt.questionIdsJson)
      ? (attempt.questionIdsJson as string[])
      : null;
    const questions = await this.prisma.question.findMany({
      where: {
        testSetId: testSet.id,
        ...(snapshotIds ? { id: { in: snapshotIds } } : {}),
      },
      orderBy: { orderIndex: 'asc' },
    });
    if (questions.length === 0) {
      throw new BadRequestException('This test set has no questions to grade');
    }
    if (testSet.skill === SkillType.FULL_MOCK) {
      // Reject BEFORE the status transition — throwing after committing
      // SUBMITTED would strand the attempt forever (no path back).
      throw new BadRequestException(
        'Full mock submission is not supported yet. Please take the individual skill tests.',
      );
    }

    // Merge over the autosaved answers: clients submit the full current map,
    // but a partial body must never silently destroy earlier autosaves.
    const mergedAnswers = {
      ...((attempt.answersJson as Record<string, string>) ?? {}),
      ...answers,
    };

    // Persist the final answers + timer atomically and mark SUBMITTED.
    // The status precondition makes submit single-winner: a second concurrent
    // submit (double click, two tabs) updates 0 rows and is rejected below.
    const transition = await this.prisma.attempt.updateMany({
      where: { id: attemptId, status: AttemptStatus.IN_PROGRESS },
      data: {
        answersJson: mergedAnswers,
        timeRemainingSeconds:
          typeof timeRemainingSeconds === 'number'
            ? Math.max(0, Math.floor(timeRemainingSeconds))
            : undefined,
        submittedAt: new Date(),
        status: AttemptStatus.SUBMITTED,
      },
    });
    if (transition.count === 0) {
      throw new ConflictException(
        'This attempt was already submitted. Retake the test to start a new attempt.',
      );
    }

    switch (testSet.skill) {
      case SkillType.LISTENING:
      case SkillType.READING:
        return this.autoGrade(
          attemptId,
          testSet.skill,
          questions,
          mergedAnswers,
        );
      case SkillType.WRITING:
        return this.scoreWriting(attempt, questions, mergedAnswers);
      case SkillType.SPEAKING:
        return this.routeSpeakingToReview(attemptId, questions, mergedAnswers);
      default:
        // Exhaustive over the non-FULL_MOCK SkillType union.
        throw new BadRequestException(
          `Unsupported skill: ${String(testSet.skill)}`,
        );
    }
  }

  private async autoGrade(
    attemptId: string,
    skill: SkillType,
    questions: Array<{
      id: string;
      questionType: string;
      metadata: Prisma.JsonValue | null;
    }>,
    answers: Record<string, string>,
  ) {
    const perQuestion = questions.map((q) => {
      const given = (answers[q.id] ?? '').trim();
      const meta = (q.metadata ?? {}) as Record<string, unknown>;
      let correct = false;
      let expected: string | undefined;

      if (q.questionType === 'MCQ') {
        expected =
          typeof meta.correctAnswer === 'string'
            ? meta.correctAnswer
            : undefined;
        correct = !!expected && given.toLowerCase() === expected.toLowerCase();
      } else {
        const accepted = Array.isArray(meta.acceptedAnswers)
          ? (meta.acceptedAnswers as string[])
          : typeof meta.correctAnswer === 'string'
            ? [meta.correctAnswer]
            : [];
        expected = accepted[0];
        correct = accepted.some((a) => a.toLowerCase() === given.toLowerCase());
      }
      return {
        questionId: q.id,
        given,
        correct,
        expected: correct ? undefined : expected,
      };
    });

    const correctCount = perQuestion.filter((r) => r.correct).length;
    const band = rawToBand(correctCount, questions.length);

    await this.prisma.score.upsert({
      where: { attemptId_skill: { attemptId, skill } },
      update: {
        bandScore: band,
        feedbackSummary: `${correctCount}/${questions.length} correct (auto-graded)`,
        inlineFeedbackJson: {
          perQuestion,
          correctCount,
          total: questions.length,
        },
        scoredBy: 'AUTO_GRADER',
        confidence: 1.0,
      },
      create: {
        attemptId,
        skill,
        bandScore: band,
        feedbackSummary: `${correctCount}/${questions.length} correct (auto-graded)`,
        inlineFeedbackJson: {
          perQuestion,
          correctCount,
          total: questions.length,
        },
        scoredBy: 'AUTO_GRADER',
        confidence: 1.0,
      },
    });

    const updated = await this.prisma.attempt.update({
      where: { id: attemptId },
      data: { status: AttemptStatus.COMPLETED },
      include: { scores: true },
    });

    return {
      attemptId,
      status: updated.status,
      bandScore: band,
      correctCount,
      total: questions.length,
      perQuestion,
    };
  }

  private async scoreWriting(
    attempt: { id: string; testSetId: string },
    questions: Array<{
      id: string;
      prompt: string;
      passage: string | null;
      partNumber: number;
    }>,
    answers: Record<string, string>,
  ) {
    const essayQuestion =
      questions.find((q) => (answers[q.id] ?? '').trim().length > 0) ??
      questions[0];
    const essay = (answers[essayQuestion.id] ?? '').trim();
    const wordCount = essay ? essay.split(/\s+/).filter(Boolean).length : 0;

    if (wordCount < 20) {
      // Roll the attempt back so the student can continue working.
      await this.prisma.attempt.update({
        where: { id: attempt.id },
        data: { status: AttemptStatus.IN_PROGRESS },
      });
      throw new BadRequestException(
        `Essay must contain at least 20 words for rubric evaluation (received ${wordCount})`,
      );
    }

    await this.prisma.attempt.update({
      where: { id: attempt.id },
      data: { status: AttemptStatus.SCORING },
    });

    try {
      const result = await this.writingAgent.scoreEssay({
        attemptId: attempt.id,
        questionPrompt: essayQuestion.passage
          ? `${essayQuestion.prompt}\n\nDATA SUMMARY: ${essayQuestion.passage}`
          : essayQuestion.prompt,
        taskType: essayQuestion.partNumber === 1 ? 'TASK_1' : 'TASK_2',
        studentEssay: essay,
        userContext: { userId: '', role: 'SYSTEM_ATTEMPT' },
      });
      return {
        attemptId: attempt.id,
        status: result.status,
        scoreId: result.scoreId,
        bandScore: result.output.overallBand,
        needsReview: result.status === 'WAITING_FOR_APPROVAL',
      };
    } catch (error) {
      // Keep the attempt in SUBMITTED so it can be re-scored; never fake a result.
      await this.prisma.attempt.update({
        where: { id: attempt.id },
        data: { status: AttemptStatus.SUBMITTED },
      });
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `AI scoring failed for attempt ${attempt.id}: ${message}`,
        stack,
      );
      // Pass through HTTP exceptions (e.g. the agent's 503 for provider
      // outages, or its 400 for content problems) instead of flattening every
      // failure into a misleading client error.
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(
        'AI scoring pipeline is temporarily unavailable. Your submission is saved — please retry scoring in a moment.',
      );
    }
  }

  private async routeSpeakingToReview(
    attemptId: string,
    questions: Array<{ id: string }>,
    answers: Record<string, string>,
  ) {
    const firstQuestion = questions[0];
    const audioBase64 = answers[firstQuestion?.id ?? ''] ?? '';
    if (audioBase64.length * 0.75 > MAX_AUDIO_BASE64_BYTES) {
      await this.prisma.attempt.update({
        where: { id: attemptId },
        data: { status: AttemptStatus.IN_PROGRESS },
      });
      throw new BadRequestException(
        'Recording exceeds the 6MB limit. Please record a shorter response.',
      );
    }
    if (!audioBase64) {
      await this.prisma.attempt.update({
        where: { id: attemptId },
        data: { status: AttemptStatus.IN_PROGRESS },
      });
      throw new BadRequestException(
        'A recorded response is required before submission',
      );
    }

    const existingItem = await this.prisma.reviewQueueItem.findUnique({
      where: { attemptId },
    });
    if (!existingItem || existingItem.status === 'PENDING') {
      // updateMany (not upsert-update) so a race with an instructor resolving
      // the item can never reopen an already-resolved review.
      const reopened = await this.prisma.reviewQueueItem.updateMany({
        where: { attemptId, status: 'PENDING' },
        data: {
          instructorNotes: 'Awaiting examiner evaluation of recorded response.',
        },
      });
      if (!existingItem && reopened.count === 0) {
        await this.prisma.reviewQueueItem.create({
          data: {
            attemptId,
            skill: SkillType.SPEAKING,
            status: 'PENDING',
            proposedBand: null,
            instructorNotes:
              'Awaiting examiner evaluation of recorded response.',
          },
        });
      }
    }

    await this.prisma.attempt.update({
      where: { id: attemptId },
      data: { status: AttemptStatus.NEEDS_REVIEW },
    });

    return {
      attemptId,
      status: AttemptStatus.NEEDS_REVIEW,
      message:
        'Recording submitted. A certified examiner will evaluate your response.',
    };
  }

  /** A scoring run wedged in RUNNING for longer than this is considered dead. */
  private static readonly STALE_RUN_MS = 5 * 60 * 1000;

  async rescore(userId: string, attemptId: string) {
    const attempt = await this.getOwnedAttempt(userId, attemptId, true);
    if (attempt.status === AttemptStatus.SCORING) {
      // Recovery path for a wedged run (process crash / deploy mid-scoring):
      // allow re-scoring when the latest run is FAILED or stale-RUNNING.
      const latestRun = await this.prisma.agentRun.findFirst({
        where: { attemptId },
        orderBy: { createdAt: 'desc' },
      });
      const runIsStale =
        !latestRun ||
        latestRun.status === 'FAILED' ||
        (latestRun.status === 'RUNNING' &&
          Date.now() - latestRun.createdAt.getTime() >
            AttemptsService.STALE_RUN_MS);
      if (!runIsStale) {
        throw new ConflictException(
          'Scoring is currently in progress for this attempt. Please wait for it to finish.',
        );
      }
      await this.prisma.agentRun.updateMany({
        where: { id: latestRun?.id ?? '', status: 'RUNNING' },
        data: {
          status: 'FAILED',
          error: 'Run timed out and was released for retry',
        },
      });
    } else if (attempt.status === AttemptStatus.COMPLETED) {
      // A COMPLETED attempt without any score row is a grading gap (e.g. the
      // scorer crashed post-transition) — allow the student to re-drive it.
      // COMPLETED *with* a score is final and must not be overwritten here.
      const scoreCount = await this.prisma.score.count({
        where: { attemptId },
      });
      if (scoreCount > 0) {
        throw new ConflictException('Attempt is COMPLETED and already scored');
      }
    } else if (attempt.status !== AttemptStatus.SUBMITTED) {
      throw new ConflictException(
        `Attempt is ${attempt.status}; only SUBMITTED, stuck SCORING, or score-less COMPLETED attempts can be re-scored`,
      );
    }
    // Grade against the attempt's question snapshot — the exact set this user
    // was served — never the whole (possibly larger) adaptive pool.
    const snapshotIds = Array.isArray(attempt.questionIdsJson)
      ? (attempt.questionIdsJson as string[])
      : null;
    const questions = await this.prisma.question.findMany({
      where: {
        testSetId: attempt.testSetId,
        ...(snapshotIds ? { id: { in: snapshotIds } } : {}),
      },
      orderBy: { orderIndex: 'asc' },
    });
    const answers = (attempt.answersJson as Record<string, string>) ?? {};
    if (attempt.testSet.skill === SkillType.WRITING) {
      return this.scoreWriting(attempt, questions, answers);
    }
    if (
      attempt.testSet.skill === SkillType.LISTENING ||
      attempt.testSet.skill === SkillType.READING
    ) {
      return this.autoGrade(
        attemptId,
        attempt.testSet.skill,
        questions,
        answers,
      );
    }
    if (attempt.testSet.skill === SkillType.SPEAKING) {
      return this.routeSpeakingToReview(attemptId, questions, answers);
    }
    throw new BadRequestException(
      'Full mock re-scoring is not supported yet. Please take the individual skill tests.',
    );
  }

  async listMine(userId: string) {
    const attempts = await this.prisma.attempt.findMany({
      where: { userId },
      orderBy: { startedAt: 'desc' },
      include: {
        testSet: {
          select: {
            id: true,
            title: true,
            skill: true,
            timeLimitMinutes: true,
          },
        },
        scores: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      take: 100,
    });
    return attempts.map((a) => ({
      id: a.id,
      status: a.status,
      testSet: a.testSet,
      startedAt: a.startedAt,
      submittedAt: a.submittedAt,
      bandScore: a.scores[0]?.bandScore ?? null,
    }));
  }

  async getResult(userId: string, userRole: string, attemptId: string) {
    const isPrivileged = ['INSTRUCTOR', 'ADMIN', 'SUPER_ADMIN'].includes(
      userRole,
    );
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: {
        testSet: { include: { questions: { orderBy: { orderIndex: 'asc' } } } },
        scores: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!attempt) throw new NotFoundException(`Attempt ${attemptId} not found`);
    if (attempt.userId !== userId && !isPrivileged) {
      throw new ForbiddenException('You do not have access to this attempt');
    }

    const score = attempt.scores[0] ?? null;
    return {
      id: attempt.id,
      status: attempt.status,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
      testSet: {
        id: attempt.testSet.id,
        title: attempt.testSet.title,
        skill: attempt.testSet.skill,
        timeLimitMinutes: attempt.testSet.timeLimitMinutes,
      },
      score: score
        ? {
            bandScore: score.bandScore,
            skill: score.skill,
            taskAchievement: score.taskAchievement,
            coherenceCohesion: score.coherenceCohesion,
            lexicalResource: score.lexicalResource,
            grammaticalAccuracy: score.grammaticalAccuracy,
            feedbackSummary: score.feedbackSummary,
            inlineFeedbackJson: score.inlineFeedbackJson,
            scoredBy: score.scoredBy,
            confidence: score.confidence,
            createdAt: score.createdAt,
          }
        : null,
      questions: attempt.testSet.questions.map((q) => ({
        id: q.id,
        partNumber: q.partNumber,
        questionType: q.questionType,
        prompt: q.prompt,
        passage: q.passage,
      })),
      answerText: this.extractPrimaryAnswer(attempt.answersJson),
    };
  }

  /** Overall band across the user's latest score per skill. */
  async latestBandsPerSkill(userId: string) {
    const scores = await this.prisma.score.findMany({
      where: { attempt: { userId } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const latest = new Map<SkillType, number>();
    for (const s of scores) {
      if (!latest.has(s.skill)) latest.set(s.skill, s.bandScore);
    }
    const bands: Partial<Record<SkillType, number>> = {};
    latest.forEach((band, skill) => (bands[skill] = band));
    const fourSkills = [
      SkillType.LISTENING,
      SkillType.READING,
      SkillType.WRITING,
      SkillType.SPEAKING,
    ]
      .map((s) => latest.get(s))
      .filter((b): b is number => typeof b === 'number');
    return { perSkill: bands, overall: overallBandOf(fourSkills) };
  }

  private extractPrimaryAnswer(
    answersJson: Prisma.JsonValue | null,
  ): string | null {
    if (!answersJson || typeof answersJson !== 'object') return null;
    const values = Object.values(answersJson as Record<string, unknown>);
    const longestText = values
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .sort((a, b) => b.length - a.length)[0];
    return longestText ?? null;
  }

  private async getOwnedAttempt(
    userId: string,
    attemptId: string,
    includeTestSet = false,
  ) {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: { testSet: includeTestSet },
    });
    if (!attempt) throw new NotFoundException(`Attempt ${attemptId} not found`);
    if (attempt.userId !== userId) {
      // Do not reveal existence of other users' attempts.
      throw new ForbiddenException('You do not have access to this attempt');
    }
    return attempt;
  }
}
