import {
  BadRequestException,
  Body,
  Controller,
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
import { TestsService } from './tests.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
const generatePoolSchema = z.object({
  skill: z.literal('READING'),
  amount: z.number().int().min(5).max(30),
  category: z.number().int().min(1).max(32).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
});

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

  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.testsService.getById(id);
  }

  /** Admin: import a fresh adaptive question pool from the external provider. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('generate')
  async generatePool(
    @Body(new ZodValidationPipe(generatePoolSchema))
    body: z.infer<typeof generatePoolSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!req?.user?.sub)
      throw new UnauthorizedException('User context missing');
    return this.testsService.generateAdaptivePool(body);
  }
}
