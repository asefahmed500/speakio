import { BadRequestException, Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { SkillType } from '@prisma/client';
import { TestsService } from './tests.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

@Controller('tests')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TestsController {
  constructor(private readonly testsService: TestsService) {}

  @Get()
  async list(@Query('skill') skill?: string) {
    // Validate the query param explicitly — an unknown value must be a 400,
    // not a Prisma validation error surfacing as a 500.
    if (skill !== undefined && !(Object.values(SkillType) as string[]).includes(skill)) {
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
}
