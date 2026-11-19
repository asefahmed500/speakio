import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { SkillType } from '@prisma/client';
import { z } from 'zod';
import { Throttle } from '@nestjs/throttler';
import {
  TestsService,
  createSetSchema,
  addQuestionSchema,
} from './tests.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { AuthenticatedRequest } from '../auth/authenticated-request';

const generatePoolSchema = z.object({
  mode: z.enum(['ai', 'opentdb']).default('ai'),
  skill: z.enum(['LISTENING', 'READING', 'WRITING', 'SPEAKING']),
  count: z.number().int().min(3).max(20).default(10),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  topic: z.string().trim().max(120).optional(),
  targetTestSetId: z.string().min(1).max(100).optional(),
});

const generateIntoSetSchema = z.object({
  count: z.number().int().min(1).max(20).default(5),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  topic: z.string().trim().max(120).optional(),
});

function requireUserId(req: AuthenticatedRequest): string {
  if (!req?.user?.sub) throw new UnauthorizedException('User context missing');
  return req.user.sub;
}

@Controller('tests')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TestsController {
  constructor(private readonly testsService: TestsService) {}

  @Get()
  async list(@Query('skill') skill?: string) {
    // Validate the query param explicitly — an unknown value must be a 400,
    // not a Prisma validation error surfacing as a 500.
    if (
      skill !== undefined &&
      !(Object.values(SkillType) as string[]).includes(skill)
    ) {
      throw new BadRequestException(
        `Unknown skill "${skill}". Valid values: ${Object.values(SkillType).join(', ')}`,
      );
    }
    return this.testsService.list(skill as SkillType | undefined);
  }

  /** Admin: every set incl. drafts, with attempts counts. (Before ':id'.) */
  @Get('manage')
  @Roles('ADMIN')
  async listForAdmin() {
    return this.testsService.listForAdmin();
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.testsService.getById(id);
  }

  /** Admin: full answer-key view of one set. */
  @Get(':id/full')
  @Roles('ADMIN')
  async getFullForAdmin(@Param('id') id: string) {
    return this.testsService.getForAdmin(id);
  }

  /**
   * Admin: generate new questions.
   * - mode "ai" (default): the QUESTION_GENERATION agent writes fresh IELTS
   *   content with GLM (any skill), appended to targetTestSetId when given.
   * - mode "opentdb": legacy external MCQ import (READING only).
   */
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post('generate')
  @Roles('ADMIN')
  async generatePool(
    @Body(new ZodValidationPipe(generatePoolSchema))
    body: z.infer<typeof generatePoolSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    const actorId = requireUserId(req);
    if (body.mode === 'opentdb') {
      if (body.skill !== 'READING') {
        throw new BadRequestException(
          'The external provider supports READING only — use mode "ai" for other skills',
        );
      }
      return this.testsService.generateAdaptivePool({
        skill: 'READING',
        amount: body.count,
        difficulty: body.difficulty,
      });
    }
    return this.testsService.generateAiQuestions({
      actorId,
      skill: body.skill,
      count: body.count,
      difficulty: body.difficulty,
      topic: body.topic,
      targetTestSetId: body.targetTestSetId,
    });
  }

  /** Admin: create an empty test set (draft — hidden from students until it has questions). */
  @Post()
  @Roles('ADMIN')
  async createSet(
    @Body(new ZodValidationPipe(createSetSchema))
    body: z.infer<typeof createSetSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.testsService.createSet(requireUserId(req), body);
  }

  /** Admin: hand-author one question into a set. */
  @Post(':id/questions')
  @Roles('ADMIN')
  async addQuestion(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addQuestionSchema))
    body: z.infer<typeof addQuestionSchema>,
  ) {
    return this.testsService.addQuestion(id, body);
  }

  /** Admin: AI-generate questions straight into an existing set. */
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post(':id/questions/generate')
  @Roles('ADMIN')
  async generateIntoSet(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(generateIntoSetSchema))
    body: z.infer<typeof generateIntoSetSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    const targetSet = await this.testsService.getForAdmin(id);
    return this.testsService.generateAiQuestions({
      actorId: requireUserId(req),
      skill: targetSet.skill as
        'LISTENING' | 'READING' | 'WRITING' | 'SPEAKING',
      count: body.count,
      difficulty: body.difficulty,
      topic: body.topic,
      targetTestSetId: id,
    });
  }

  @Delete(':id')
  @Roles('ADMIN')
  async deleteSet(@Param('id') id: string) {
    return this.testsService.deleteSet(id);
  }

  @Delete(':id/questions/:questionId')
  @Roles('ADMIN')
  async deleteQuestion(
    @Param('id') _id: string,
    @Param('questionId') questionId: string,
  ) {
    return this.testsService.deleteQuestion(questionId);
  }
}
