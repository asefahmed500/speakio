import {
  Body,
  Controller,
  Patch,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { AuthenticatedRequest } from '../auth/authenticated-request';

const milestoneSchema = z.object({
  id: z.string().min(1).max(100),
  day: z.number().int().min(1).max(365),
  title: z.string().min(1).max(200),
  skill: z.enum(['LISTENING', 'READING', 'WRITING', 'SPEAKING', 'MOCK']),
  durationMinutes: z.number().int().min(5).max(300),
  isCompleted: z.boolean(),
  taskDetails: z.string().max(1000),
});

const updateMeSchema = z.object({
  targetBand: z.number().min(4).max(9).optional(),
  examDate: z.string().datetime({ offset: true }).nullable().optional(),
  moduleType: z.enum(['ACADEMIC', 'GENERAL']).optional(),
  dailyCommitmentMinutes: z
    .number()
    .int()
    .min(10)
    .max(600)
    .nullable()
    .optional(),
  weakestSkill: z
    .enum(['LISTENING', 'READING', 'WRITING', 'SPEAKING'])
    .nullable()
    .optional(),
  studyPlan: z.array(milestoneSchema).max(60).optional(),
});

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Patch('me')
  async updateMe(
    @Body(new ZodValidationPipe(updateMeSchema))
    body: z.infer<typeof updateMeSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!req?.user?.sub)
      throw new UnauthorizedException('User context missing');
    return this.usersService.updateProfile(req.user.sub, body);
  }
}
