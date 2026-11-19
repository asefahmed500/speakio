import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
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
  name: z.string().trim().min(2).max(100).optional(),
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

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required').max(128),
    newPassword: z
      .string()
      .min(8, 'New password must be at least 8 characters')
      .max(128),
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'New password must be different from the current password',
    path: ['newPassword'],
  });

const listUsersQuerySchema = z.object({
  query: z.string().trim().max(100).optional(),
  role: z.enum(['USER', 'ADMIN']).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
});

const roleChangeSchema = z.object({
  role: z.enum(['USER', 'ADMIN']),
});

const statusChangeSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED']),
});

function requireUser(req: AuthenticatedRequest) {
  if (!req?.user?.sub) throw new UnauthorizedException('User context missing');
  return { sub: req.user.sub, role: req.user.role };
}

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
    const user = requireUser(req);
    return this.usersService.updateProfile(user.sub, body);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('me/password')
  async changePassword(
    @Body(new ZodValidationPipe(changePasswordSchema))
    body: z.infer<typeof changePasswordSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    const user = requireUser(req);
    return this.usersService.changePassword(
      user.sub,
      body.currentPassword,
      body.newPassword,
    );
  }

  /** Platform KPIs for the admin overview dashboard. */
  @Get('stats')
  @Roles('ADMIN')
  async getPlatformStats() {
    return this.usersService.getPlatformStats();
  }

  @Get()
  @Roles('ADMIN')
  async listUsers(
    @Query(new ZodValidationPipe(listUsersQuerySchema))
    query: z.infer<typeof listUsersQuerySchema>,
  ) {
    return this.usersService.listUsers({
      query: query.query,
      role: query.role,
      status: query.status,
    });
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Patch(':id/role')
  @Roles('ADMIN')
  async changeRole(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(roleChangeSchema))
    body: z.infer<typeof roleChangeSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = requireUser(req);
    return this.usersService.changeRole(
      { sub: actor.sub, role: actor.role },
      id,
      body.role,
    );
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Patch(':id/status')
  @Roles('ADMIN')
  async setStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(statusChangeSchema))
    body: z.infer<typeof statusChangeSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    const actor = requireUser(req);
    return this.usersService.setStatus(
      { sub: actor.sub, role: actor.role },
      id,
      body.status,
    );
  }

  /** Kept for API completeness — user deletion is soft (suspend) in practice. */
  @Delete(':id')
  @Roles('ADMIN')
  async deleteUser(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const actor = requireUser(req);
    // Route through the suspend path: hard deletes would cascade attempts,
    // scores and certificates — irreversible destruction is SUPER_ADMIN-only.
    return this.usersService.setStatus(
      { sub: actor.sub, role: actor.role },
      id,
      'SUSPENDED',
    );
  }
}
