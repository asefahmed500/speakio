import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WritingScoringAgent } from '../agents/writing-scoring.agent';
import { SpeakingScoringAgent } from '../agents/speaking-scoring.agent';
import { CertificatesService } from '../certificates/certificates.service';
import { Inject } from '@nestjs/common';
import { forwardRef } from '@nestjs/common';
import { QuestionUniquenessService } from '../tests/question-uniqueness.service';
import { QUESTIONS_PER_ATTEMPT } from '../tests/tests.service';
import { PoolAutomationService } from '../tests/pool-automation.service';
import { rawToBand, overallBandOf } from '../common/band.utils';
import { AttemptStatus, Prisma, SkillType, Attempt } from '@prisma/client';

const MAX_AUDIO_BASE64_BYTES = 6 * 1024 * 1024;

@Injectable()
export class AttemptsService implements OnModuleInit {
  private readonly logger = new Logger(AttemptsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly writingAgent: WritingScoringAgent,
    private readonly speakingAgent: SpeakingScoringAgent,
    private readonly uniqueness: QuestionUniquenessService,
    private readonly poolAutomation: PoolAutomationService,
    @Inject(forwardRef(() => CertificatesService))
    private readonly certificatesService: CertificatesService,
  ) {}

  /**
   * Startup recovery: a process restart can strand attempts in SCORING after
   * the background agent promise was lost. Reset those older than 10 minutes
   * to SUBMITTED so the student's retry/rescore path can recover them.
   */
  async onModuleInit(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - AttemptsService.STALE_RUN_MS * 2);
      const recovered = await this.prisma.attempt.updateMany({
        where: { status: AttemptStatus.SCORING, startedAt: { lt: cutoff } },
        data: { status: AttemptStatus.SUBMITTED },
      });
      if (recovered.count > 0) {
        this.logger.warn(
          `Recovered ${recovered.count} stranded SCORING attempts after startup`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Startup recovery failed: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

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

    // Automation hook: while the student answers this attempt, the system may
    // quietly generate fresh questions so future attempts keep rotating.
    // Fire-and-forget — it can never delay or fail the start.
    this.poolAutomation.maybeTopUp(testSetId);
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
        return this.scoreWriting(userId, attempt, questions, mergedAnswers);
      case SkillType.SPEAKING:
        return this.scoreSpeaking(userId, attemptId, questions, mergedAnswers);
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
    userId: string,
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

    // Run the AI pipeline in the background: under 10k concurrent users the
    // HTTP request must never hold an LLM call open. The results page already
    // polls while status is SCORING, and a background failure rolls the
    // attempt back to SUBMITTED for the retry/rescore path.
    void this.writingAgent
      .scoreEssay({
        attemptId: attempt.id,
        questionPrompt: essayQuestion.passage
          ? `${essayQuestion.prompt}\n\nDATA SUMMARY: ${essayQuestion.passage}`
          : essayQuestion.prompt,
        taskType: essayQuestion.partNumber === 1 ? 'TASK_1' : 'TASK_2',
        studentEssay: essay,
        userContext: { userId: '', role: 'SYSTEM_ATTEMPT' },
      })
      .then(async () => {
        // Milestone hook: certificate issuance belongs to the moment all four
        // skills complete — with async scoring that moment lives here.
        await this.certificatesService.issue(userId).catch((issueError: unknown) => {
          this.logger.error(
            `Background certificate issuance failed for ${userId}: ${issueError instanceof Error ? issueError.message : issueError}`,
          );
        });
      })
      .catch(async (error: unknown) => {
        // A scored attempt (post-publish telemetry failure) must NEVER
        // regress — the result is real and COMPLETED stays truthful.
        const scored = await this.prisma.score.count({
          where: { attemptId: attempt.id },
        });
        await this.prisma.attempt.update({
          where: { id: attempt.id },
          data: {
            status:
              scored === 0 ? AttemptStatus.SUBMITTED : AttemptStatus.COMPLETED,
          },
        });
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Background AI scoring failed for attempt ${attempt.id}: ${message}`,
        );
      });

    return {
      attemptId: attempt.id,
      status: AttemptStatus.SCORING,
      message:
        'Your essay is being scored by AI review agents — your band appears on the results page automatically.',
    };
  }

  /**
   * SPEAKING: real audio → AI agents only. Segments are WAV data URLs joined
   * by '|'; the speaking agent transcribes (GLM-ASR) and scores with a
   * two-pass review. No human reviewer exists in this SaaS.
   */
  private async scoreSpeaking(
    userId: string,
    attemptId: string,
    questions: Array<{ id: string; prompt: string; passage: string | null }>,
    answers: Record<string, string>,
  ) {
    const firstQuestion = questions[0];
    const joined = answers[firstQuestion?.id ?? ''] ?? '';
    const audioSegments = joined && joined.startsWith('data:audio')
      ? joined.split('|')
      : [];
    const typedAnswer = joined && !joined.startsWith('data:audio')
      ? joined.trim()
      : '';
    const typedWordCount = typedAnswer
      ? typedAnswer.split(/\s+/).filter(Boolean).length
      : 0;

    if (
      audioSegments.length === 0 &&
      (typedWordCount < 40 || !firstQuestion)
    ) {
      await this.prisma.attempt.update({
        where: { id: attemptId },
        data: { status: AttemptStatus.IN_PROGRESS },
      });
      throw new BadRequestException(
        'Record a response, or type at least 40 words for a free text-based speaking review.',
      );
    }
    if (typedAnswer && typedWordCount > 1500) {
      await this.prisma.attempt.update({
        where: { id: attemptId },
        data: { status: AttemptStatus.IN_PROGRESS },
      });
      throw new BadRequestException('Typed response exceeds 1500 words.');
    }
    const totalBinaryBytes = audioSegments.reduce(
      (sum, seg) =>
        sum + Math.floor((seg.length - seg.indexOf(',') - 1) * 0.75),
      0,
    );
    if (totalBinaryBytes > MAX_AUDIO_BASE64_BYTES) {
      await this.prisma.attempt.update({
        where: { id: attemptId },
        data: { status: AttemptStatus.IN_PROGRESS },
      });
      throw new BadRequestException(
        'Recording exceeds the 6MB limit. Please record a shorter response.',
      );
    }

    await this.prisma.attempt.update({
      where: { id: attemptId },
      data: { status: AttemptStatus.SCORING },
    });

    // Background AI pipeline (see scoreWriting): the HTTP request returns
    // immediately; the results page polls while SCORING. Content rejections
    // roll back to IN_PROGRESS (re-recordable), infrastructure failures to
    // SUBMITTED (rescore path).
    void this.speakingAgent
      .scoreRecording({
        attemptId,
        cueCardPrompt: firstQuestion.passage
          ? `${firstQuestion.prompt}\n\nFOLLOW-UP: ${firstQuestion.passage}`
          : firstQuestion.prompt,
        audioSegments,
        textAnswer: typedAnswer || undefined,
        userContext: { userId: '', role: 'SYSTEM_ATTEMPT' },
      })
      .then(async () => {
        await this.certificatesService.issue(userId).catch((issueError: unknown) => {
          this.logger.error(
            `Background certificate issuance failed for ${userId}: ${issueError instanceof Error ? issueError.message : issueError}`,
          );
        });
      })
      .catch(async (error: unknown) => {
        const scored = await this.prisma.score.count({ where: { attemptId } });
        const rollbackStatus =
          error instanceof BadRequestException
            ? scored === 0
              ? AttemptStatus.IN_PROGRESS
              : AttemptStatus.COMPLETED
            : scored === 0
              ? AttemptStatus.SUBMITTED
              : AttemptStatus.COMPLETED;
        await this.prisma.attempt.update({
          where: { id: attemptId },
          data: { status: rollbackStatus },
        });
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Background AI speaking review failed for attempt ${attemptId}: ${message}`,
        );
      });

    return {
      attemptId,
      status: AttemptStatus.SCORING,
      message:
        'Your recording is being transcribed and reviewed by AI agents — your band appears on the results page automatically.',
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
      return this.scoreWriting(userId, attempt, questions, answers);
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
      return this.scoreSpeaking(userId, attemptId, questions, answers);
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
    const isPrivileged = ['ADMIN'].includes(userRole);
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
    // Review shows exactly what the student was served — the attempt's question
    // snapshot — never the whole (possibly larger) adaptive pool.
    const snapshotIds = Array.isArray(attempt.questionIdsJson)
      ? (attempt.questionIdsJson as string[])
      : null;
    const answers = (attempt.answersJson as Record<string, string>) ?? {};
    const servedQuestions = snapshotIds
      ? attempt.testSet.questions.filter((q) => snapshotIds.includes(q.id))
      : attempt.testSet.questions;

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
            fluencyCoherence: score.fluencyCoherence,
            pronunciation: score.pronunciation,
            feedbackSummary: score.feedbackSummary,
            inlineFeedbackJson: score.inlineFeedbackJson,
            scoredBy: score.scoredBy,
            confidence: score.confidence,
            createdAt: score.createdAt,
          }
        : null,
      questions: servedQuestions.map((q) => ({
        id: q.id,
        partNumber: q.partNumber,
        questionType: q.questionType,
        prompt: q.prompt,
        passage: q.passage,
        options: Array.isArray(
          ((q.metadata ?? {}) as Record<string, unknown>).options,
        )
          ? (((q.metadata ?? {}) as Record<string, unknown>)
              .options as string[])
          : undefined,
      })),
      // Per-question answers so the review can show what the student gave.
      answers,
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
      .filter(
        (v): v is string =>
          typeof v === 'string' && v.length > 0 && !v.startsWith('data:'),
      )
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
