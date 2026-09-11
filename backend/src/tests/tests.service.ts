import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SkillType } from '@prisma/client';
import { QuestionUniquenessService } from './question-uniqueness.service';
import { OpenTdbQuestionGenerator } from './external-question-generator.service';

/** Attempts on adaptive pool sets serve this many questions per user. */
export const QUESTIONS_PER_ATTEMPT = 10;

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

@Injectable()
export class TestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uniqueness: QuestionUniquenessService,
    private readonly generator: OpenTdbQuestionGenerator,
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
}
