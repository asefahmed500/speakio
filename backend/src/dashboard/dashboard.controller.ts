import {
  BadRequestException,
  Controller,
  Get,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { SkillType } from '@prisma/client';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequest } from '../auth/authenticated-request';

const VALID_SKILLS = new Set(Object.values(SkillType));

@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('stats')
  async stats(@Req() req: AuthenticatedRequest) {
    return this.dashboardService.getStats(req.user.sub);
  }

  @Get('skills/:skill')
  async skillSummary(
    @Param('skill') skill: string,
    @Req() req: AuthenticatedRequest,
  ) {
    // 400 (consistent with GET /tests?skill=…) instead of a silent empty 200.
    if (!VALID_SKILLS.has(skill as SkillType)) {
      throw new BadRequestException(`Invalid skill: ${skill}`);
    }
    return this.dashboardService.getSkillSummary(
      req.user.sub,
      skill as SkillType,
    );
  }
}
