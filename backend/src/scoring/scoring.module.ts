import { Module } from '@nestjs/common';
import { ScoringController } from './scoring.controller';
import { AgentsModule } from '../agents/agents.module';

@Module({
  imports: [AgentsModule],
  controllers: [ScoringController],
})
export class ScoringModule {}
