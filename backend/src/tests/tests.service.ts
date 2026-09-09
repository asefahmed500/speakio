import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SkillType } from '@prisma/client';

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
  constructor(private readonly prisma: PrismaService) {}

  async list(skill?: SkillType) {
    const testSets = await this.prisma.testSet.findMany({
      where: skill ? { skill } : undefined,
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
        options: Array.isArray(meta.options) ? (meta.options as string[]) : undefined,
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
}
