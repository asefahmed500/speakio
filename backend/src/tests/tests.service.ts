import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SkillType, Prisma } from '@prisma/client';
import { z } from 'zod';
import { QuestionUniquenessService } from './question-uniqueness.service';
import { OpenTdbQuestionGenerator } from './external-question-generator.service';
import {
  AiQuestionGeneratorService,
  type GeneratableSkill,
  type GeneratedQuestion,
} from './ai-question-generator.service';

/** Attempts on adaptive pool sets serve this many questions per user. */
export const QUESTIONS_PER_ATTEMPT = 10;

/** Default time limits for AI-authored sets, per skill. */
const SKILL_TIME_LIMIT: Record<GeneratableSkill, number> = {
  LISTENING: 30,
  READING: 20,
  WRITING: 60,
  SPEAKING: 15,
};

export interface SanitizedQuestion {
  id: string;
  partNumber: number;
  questionType: string;
  prompt: string;
  passage: string | null;
  audioUrl: string | null;
  orderIndex: number;
  options?: string[];
}

export const createSetSchema = z.object({
  title: z.string().trim().min(3).max(200),
  skill: z.enum(['LISTENING', 'READING', 'WRITING', 'SPEAKING']),
  moduleType: z.enum(['ACADEMIC', 'GENERAL']).default('ACADEMIC'),
  timeLimitMinutes: z.number().int().min(5).max(180),
  isMock: z.boolean().default(false),
});

export const addQuestionSchema = z
  .object({
    questionType: z.enum(['MCQ', 'COMPLETION', 'ESSAY', 'SPEAKING_PROMPT']),
    prompt: z.string().trim().min(5).max(4000),
    passage: z.string().max(12_000).optional(),
    partNumber: z.number().int().min(1).max(4).default(1),
    options: z.array(z.string().trim().min(1).max(300)).max(6).optional(),
    correctAnswer: z.string().trim().max(300).optional(),
    acceptedAnswers: z
      .array(z.string().trim().min(1).max(200))
      .max(5)
      .optional(),
  })
  .superRefine((q, ctx) => {
    if (q.questionType === 'MCQ') {
      const options = q.options ?? [];
      if (options.length !== 4) {
        ctx.addIssue({
          code: 'custom',
          path: ['options'],
          message: 'MCQ questions require exactly 4 options',
        });
      }
      const match = options.find(
        (o) => o.toLowerCase() === (q.correctAnswer ?? '').toLowerCase(),
      );
      if (!q.correctAnswer || !match) {
        ctx.addIssue({
          code: 'custom',
          path: ['correctAnswer'],
          message: 'correctAnswer must exactly match one of the options',
        });
      }
    }
    if (q.questionType === 'COMPLETION') {
      const accepted = (q.acceptedAnswers ?? []).filter(Boolean);
      if (accepted.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['acceptedAnswers'],
          message: 'COMPLETION questions require at least one accepted answer',
        });
      }
    }
  });

export type CreateSetDto = z.infer<typeof createSetSchema>;
export type AddQuestionDto = z.infer<typeof addQuestionSchema>;

@Injectable()
export class TestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uniqueness: QuestionUniquenessService,
    private readonly generator: OpenTdbQuestionGenerator,
    private readonly aiGenerator: AiQuestionGeneratorService,
  ) {}

  async list(skill?: SkillType) {
    // Only list takeable sets: an empty/draft set (0 questions) can never be
    // started, so it must not appear in any client's test list.
    const testSets = await this.prisma.testSet.findMany({
      where: { ...(skill ? { skill } : {}), questions: { some: {} } },
      orderBy: [{ skill: 'asc' }, { createdAt: 'asc' }],
      include: { _count: { select: { questions: true } } },
    });
    return testSets.map((t) => ({
      id: t.id,
      title: t.title,
      skill: t.skill,
      moduleType: t.moduleType,
      timeLimitMinutes: t.timeLimitMinutes,
      isMock: t.isMock,
      questionCount: t._count.questions,
      createdAt: t.createdAt,
    }));
  }

  /** Admin: every set (including empty drafts) with authoring metadata. */
  async listForAdmin() {
    const testSets = await this.prisma.testSet.findMany({
      orderBy: [{ skill: 'asc' }, { createdAt: 'desc' }],
      include: {
        _count: { select: { questions: true, attempts: true } },
      },
    });
    return testSets.map((t) => ({
      id: t.id,
      title: t.title,
      skill: t.skill,
      moduleType: t.moduleType,
      timeLimitMinutes: t.timeLimitMinutes,
      isMock: t.isMock,
      questionCount: t._count.questions,
      attemptsCount: t._count.attempts,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));
  }

  /** Admin: full question rows (including answer keys) for one set. */
  async getForAdmin(id: string) {
    const testSet = await this.prisma.testSet.findUnique({
      where: { id },
      include: { questions: { orderBy: { orderIndex: 'asc' } } },
    });
    if (!testSet) throw new NotFoundException(`Test set ${id} not found`);
    const attemptsCount = await this.prisma.attempt.count({
      where: { testSetId: id },
    });
    return {
      id: testSet.id,
      title: testSet.title,
      skill: testSet.skill,
      moduleType: testSet.moduleType,
      timeLimitMinutes: testSet.timeLimitMinutes,
      isMock: testSet.isMock,
      attemptsCount,
      questions: testSet.questions.map((q) => {
        const meta = (q.metadata ?? {}) as Record<string, unknown>;
        return {
          id: q.id,
          partNumber: q.partNumber,
          questionType: q.questionType,
          prompt: q.prompt,
          passage: q.passage,
          orderIndex: q.orderIndex,
          options: Array.isArray(meta.options)
            ? (meta.options as string[])
            : null,
          correctAnswer:
            typeof meta.correctAnswer === 'string' ? meta.correctAnswer : null,
          acceptedAnswers: Array.isArray(meta.acceptedAnswers)
            ? (meta.acceptedAnswers as string[])
            : null,
        };
      }),
    };
  }

  async getById(id: string) {
    const testSet = await this.prisma.testSet.findUnique({
      where: { id },
      include: { questions: { orderBy: { orderIndex: 'asc' } } },
    });
    if (!testSet) throw new NotFoundException(`Test set ${id} not found`);

    // Never leak correct answers to the client before grading.
    const questions: SanitizedQuestion[] = testSet.questions.map((q) => {
      const meta = (q.metadata ?? {}) as Record<string, unknown>;
      return {
        id: q.id,
        partNumber: q.partNumber,
        questionType: q.questionType,
        prompt: q.prompt,
        passage: q.passage,
        audioUrl: q.audioUrl,
        orderIndex: q.orderIndex,
        options: Array.isArray(meta.options)
          ? (meta.options as string[])
          : undefined,
      };
    });

    return {
      id: testSet.id,
      title: testSet.title,
      skill: testSet.skill,
      moduleType: testSet.moduleType,
      timeLimitMinutes: testSet.timeLimitMinutes,
      isMock: testSet.isMock,
      questions,
    };
  }

  async createSet(actorId: string, dto: CreateSetDto) {
    return this.prisma.testSet.create({
      data: {
        title: dto.title,
        skill: dto.skill,
        moduleType: dto.moduleType,
        timeLimitMinutes: dto.timeLimitMinutes,
        isMock: dto.isMock,
        createdById: actorId,
      },
    });
  }

  async addQuestion(testSetId: string, dto: AddQuestionDto) {
    const testSet = await this.prisma.testSet.findUnique({
      where: { id: testSetId },
      select: { id: true },
    });
    if (!testSet)
      throw new NotFoundException(`Test set ${testSetId} not found`);

    const maxOrder = await this.prisma.question.aggregate({
      where: { testSetId },
      _max: { orderIndex: true },
    });
    const nextOrder = (maxOrder._max.orderIndex ?? -1) + 1;
    const accepted = (dto.acceptedAnswers ?? []).filter(Boolean);

    return this.prisma.question.create({
      data: {
        testSetId,
        partNumber: dto.partNumber,
        questionType: dto.questionType,
        prompt: dto.prompt,
        passage: dto.passage?.trim() || null,
        orderIndex: nextOrder,
        metadata: {
          ...(dto.questionType === 'MCQ'
            ? { options: dto.options, correctAnswer: dto.correctAnswer }
            : {}),
          ...(dto.questionType === 'COMPLETION'
            ? { acceptedAnswers: accepted, correctAnswer: accepted[0] }
            : {}),
          ...(dto.questionType === 'ESSAY' ? { taskType: 'TASK_2' } : {}),
        } satisfies Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Deleting is only safe while no student history references the content.
   * The parent row is locked FOR UPDATE for the whole check+delete: inserting
   * an Attempt takes a KEY SHARE lock on that same TestSet row (FK), so a
   * concurrent attempt start cannot slip in between the count and the delete
   * and lose its history to the cascade.
   */
  private async lockTestSet(tx: Prisma.TransactionClient, testSetId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM test_sets WHERE id = ${testSetId} FOR UPDATE
    `;
    if (rows.length === 0) throw new NotFoundException('Test set not found');
  }

  async deleteSet(testSetId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockTestSet(tx, testSetId);
      const attemptsCount = await tx.attempt.count({ where: { testSetId } });
      if (attemptsCount > 0) {
        throw new ConflictException(
          `This test set has ${attemptsCount} attempt(s) and cannot be deleted — its history is part of student records.`,
        );
      }
      await tx.testSet.delete({ where: { id: testSetId } });
      return { success: true };
    });
  }

  async deleteQuestion(testSetId: string, questionId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockTestSet(tx, testSetId);
      const question = await tx.question.findFirst({
        where: { id: questionId, testSetId },
        select: { id: true },
      });
      if (!question) throw new NotFoundException('Question not found in this test set');
      const attemptsCount = await tx.attempt.count({ where: { testSetId } });
      if (attemptsCount > 0) {
        throw new ConflictException(
          'Questions inside a set that already has attempts cannot be removed.',
        );
      }
      await tx.question.delete({ where: { id: questionId } });
      return { success: true };
    });
  }

  /**
   * Imports a fresh practice pool from the external question provider into the
   * local database. Never called at exam time — students always receive
   * questions from PostgreSQL, and per-user selection (QuestionUniquenessService)
   * guarantees no user sees a question they have already answered anywhere in
   * the system while the pool still has unseen questions.
   */
  async generateAdaptivePool(dto: {
    skill: 'READING';
    amount: number;
    category?: number;
    difficulty?: 'easy' | 'medium' | 'hard';
  }) {
    const existing = await this.prisma.question.findMany({
      where: { questionType: 'MCQ' },
      select: { prompt: true },
    });
    const excludedFingerprints = new Set(
      existing.map((q) => this.uniqueness.fingerprint(q.prompt)),
    );

    const generated = await this.generator.generateQuestions({
      count: dto.amount,
      category: dto.category,
      difficulty: dto.difficulty,
      excludedFingerprints,
      fingerprint: (p) => this.uniqueness.fingerprint(p),
    });
    if (generated.length === 0) {
      throw new NotFoundException(
        'The provider returned no new questions for this configuration',
      );
    }

    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const difficultyLabel = dto.difficulty
      ? ` · ${dto.difficulty[0].toUpperCase()}${dto.difficulty.slice(1)}`
      : '';
    const topic = generated[0].category.split(':')[0];

    return this.prisma.testSet.create({
      data: {
        title: `Adaptive ${topic} Practice — ${stamp}${difficultyLabel}`,
        skill: dto.skill,
        moduleType: 'ACADEMIC',
        timeLimitMinutes: 20,
        isMock: false,
        questions: {
          create: generated.map((q, index) => ({
            partNumber: 1,
            questionType: 'MCQ',
            prompt: q.prompt,
            orderIndex: index,
            metadata: {
              options: q.options,
              correctAnswer: q.correctAnswer,
              difficulty: q.difficulty,
              source: 'opentdb',
            },
          })),
        },
      },
      include: { _count: { select: { questions: true } } },
    });
  }

  /**
   * QUESTION_GENERATION agent entry point: writes brand-new questions with
   * GLM, dedups them against everything already in the bank (fingerprint
   * level), and appends them to a set — creating one first when needed.
   * Every run is recorded as an AgentRun for the Agent Ops dashboard.
   */
  async generateAiQuestions(params: {
    actorId: string;
    skill: GeneratableSkill;
    count: number;
    difficulty?: 'easy' | 'medium' | 'hard';
    topic?: string;
    targetTestSetId?: string;
  }) {
    const startedAt = Date.now();
    // 1. Resolve or create the target set.
    let targetSet = params.targetTestSetId
      ? await this.prisma.testSet.findUnique({
          where: { id: params.targetTestSetId },
          select: { id: true, skill: true, title: true },
        })
      : null;
    if (params.targetTestSetId && !targetSet) {
      throw new NotFoundException(
        `Target test set ${params.targetTestSetId} not found`,
      );
    }
    if (targetSet && targetSet.skill !== params.skill) {
      throw new BadRequestException(
        `Set belongs to ${targetSet.skill}; cannot add ${params.skill} questions to it`,
      );
    }

    const agentRun = await this.prisma.agentRun.create({
      data: {
        agentType: 'QUESTION_GENERATION',
        status: 'RUNNING',
        inputPayloadJson: {
          skill: params.skill,
          count: params.count,
          difficulty: params.difficulty ?? null,
          topic: params.topic ?? null,
          targetTestSetId: params.targetTestSetId ?? null,
          requestedBy: params.actorId,
        } satisfies Prisma.InputJsonValue,
      },
    });

    try {
      // 2. Gather fingerprints of everything already in the bank.
      const existing = await this.prisma.question.findMany({
        where: { testSet: { skill: params.skill } },
        select: { prompt: true },
        orderBy: { createdAt: 'desc' },
        take: 1000,
      });
      const existingFingerprints = new Set(
        existing.map((q) => this.uniqueness.fingerprint(q.prompt)),
      );

      // 3. Generate with the AI agent (validated + sanitized).
      const generated = await this.aiGenerator.generate({
        skill: params.skill,
        count: params.count,
        difficulty: params.difficulty,
        topic: params.topic,
        excludeSamplePrompts: existing.map((q) => q.prompt),
      });

      // 4. Dedup within the batch and against the bank.
      const seen = new Set<string>();
      const fresh: GeneratedQuestion[] = [];
      for (const q of generated.questions) {
        const fp = this.uniqueness.fingerprint(q.prompt);
        if (existingFingerprints.has(fp) || seen.has(fp)) continue;
        seen.add(fp);
        fresh.push(q);
      }
      if (fresh.length === 0) {
        throw new ConflictException(
          'The generator returned questions that already exist in the bank. Try a different topic.',
        );
      }

      // 5. Persist: create the set lazily so a fully-duplicated generation
      //    leaves no empty set behind.
      if (!targetSet) {
        const stamp = new Date().toISOString().slice(0, 10);
        targetSet = await this.prisma.testSet.create({
          data: {
            title: `AI ${SKILL_LABEL[params.skill]} Practice — ${generated.topic} (${stamp})`,
            skill: params.skill,
            moduleType: 'ACADEMIC',
            timeLimitMinutes: SKILL_TIME_LIMIT[params.skill],
            isMock: false,
            createdById: params.actorId.startsWith('SYSTEM_')
              ? null
              : params.actorId,
          },
          select: { id: true, skill: true, title: true },
        });
      }
      const maxOrder = await this.prisma.question.aggregate({
        where: { testSetId: targetSet.id },
        _max: { orderIndex: true },
      });
      let order = (maxOrder._max.orderIndex ?? -1) + 1;

      // Shared stimulus goes on the FIRST question only — the exam UI renders
      // every question's passage in one combined "Source material" aside.
      await this.prisma.$transaction(
        fresh.map((q, index) =>
          this.prisma.question.create({
            data: {
              testSetId: targetSet!.id,
              partNumber: q.partNumber,
              questionType: q.questionType,
              prompt: q.prompt,
              passage: index === 0 ? generated.passage : null,
              orderIndex: order++,
              metadata: this.questionMetadata(
                q,
              ) satisfies Prisma.InputJsonValue,
            },
          }),
        ),
      );

      const durationMs = Date.now() - startedAt;
      await this.prisma.agentRun.update({
        where: { id: agentRun.id },
        data: {
          status: 'COMPLETED',
          confidence: 1.0,
          outputPayloadJson: {
            topic: generated.topic,
            created: fresh.length,
            duplicatesSkipped: generated.questions.length - fresh.length,
            testSetId: targetSet.id,
            testSetTitle: targetSet.title,
          } satisfies Prisma.InputJsonValue,
          durationMs,
          completedAt: new Date(),
        },
      });
      await this.prisma.agentStep.create({
        data: {
          agentRunId: agentRun.id,
          stepName: 'GENERATE_AND_PERSIST',
          status: 'SUCCESS',
          toolName: 'aiQuestionGenerator',
          toolInputJson: {
            skill: params.skill,
            requested: params.count,
          } satisfies Prisma.InputJsonValue,
          toolOutputJson: {
            created: fresh.length,
            duplicatesSkipped: generated.questions.length - fresh.length,
          } satisfies Prisma.InputJsonValue,
          durationMs,
        },
      });

      return {
        agentRunId: agentRun.id,
        testSetId: targetSet.id,
        testSetTitle: targetSet.title,
        created: fresh.length,
        duplicatesSkipped: generated.questions.length - fresh.length,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.agentRun.update({
        where: { id: agentRun.id },
        data: {
          status: 'FAILED',
          error: message,
          completedAt: new Date(),
          durationMs: Date.now() - startedAt,
        },
      });
      throw error;
    }
  }

  private questionMetadata(q: GeneratedQuestion): Prisma.InputJsonValue {
    switch (q.questionType) {
      case 'MCQ':
        return { options: q.options, correctAnswer: q.correctAnswer };
      case 'COMPLETION':
        return {
          acceptedAnswers: q.acceptedAnswers,
          correctAnswer: q.acceptedAnswers?.[0],
        };
      case 'ESSAY':
        return { taskType: q.taskType ?? 'TASK_2' };
      default:
        return {};
    }
  }
}

const SKILL_LABEL: Record<GeneratableSkill, string> = {
  LISTENING: 'Listening',
  READING: 'Reading',
  WRITING: 'Writing',
  SPEAKING: 'Speaking',
};
