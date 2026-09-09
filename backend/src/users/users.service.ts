import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, SkillType, ModuleType } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async updateProfile(
    userId: string,
    body: {
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
    if (body.targetBand !== undefined) data.targetBand = body.targetBand;
    if (body.examDate !== undefined) {
      data.examDate = body.examDate === null ? null : new Date(body.examDate);
    }
    if (body.moduleType !== undefined) data.moduleType = body.moduleType as ModuleType;
    if (body.dailyCommitmentMinutes !== undefined) data.dailyCommitmentMinutes = body.dailyCommitmentMinutes;
    if (body.weakestSkill !== undefined) {
      data.weakestSkill = body.weakestSkill === null ? null : (body.weakestSkill as SkillType);
    }
    if (body.studyPlan !== undefined) {
      data.studyPlanJson = body.studyPlan as unknown as Prisma.InputJsonValue;
    }

    const user = await this.prisma.user.update({
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
    });
    return user;
  }
}
