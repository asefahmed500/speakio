import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ToolRegistryService } from './tools/tool-registry.service';
import { WritingScoringAgent } from './writing-scoring.agent';

@Module({
  imports: [AiModule],
  providers: [ToolRegistryService, WritingScoringAgent],
  exports: [ToolRegistryService, WritingScoringAgent],
})
export class AgentsModule {}
