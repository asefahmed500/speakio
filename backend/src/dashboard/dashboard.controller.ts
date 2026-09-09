import { Controller, Get, Param, Query, UseGuards, Req, UnauthorizedException } from '@nestjs/common';
import { SkillType } from '@prisma/client';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

const VALID_SKILLS = new Set(Object.values(SkillType));

@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('stats')
  async stats(@Req() req: any) {
    return this.dashboardService.getStats(req.user.sub);
  }

  @Get('skills/:skill')
  async skillSummary(@Param('skill') skill: string, @Req() req: any) {
    if (!VALID_SKILLS.has(skill as SkillType)) {
      return { latestBand: null, attemptsCount: 0, attempts: [], bandHistory: [] };
    }
    return this.dashboardService.getSkillSummary(req.user.sub, skill as SkillType);
  }
}
