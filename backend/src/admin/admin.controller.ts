import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { UsersService } from '../users/users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

const rosterQuerySchema = z.object({
  query: z.string().trim().max(100).optional(),
});

/** Admin oversight of the learner body: roster and per-learner detail. */
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminController {
  constructor(private readonly usersService: UsersService) {}

  @Get('students')
  async listStudents(
    @Query(new ZodValidationPipe(rosterQuerySchema))
    query: z.infer<typeof rosterQuerySchema>,
  ) {
    return this.usersService.listStudents(query.query);
  }

  @Get('students/:id')
  async getStudent(@Param('id') id: string) {
    return this.usersService.getStudentDetail(id);
  }
}
