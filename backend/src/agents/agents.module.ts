import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ToolRegistryService } from './tools/tool-registry.service';
import { WritingScoringAgent } from './writing-scoring.agent';
import { SpeakingScoringAgent } from './speaking-scoring.agent';

@Module({
  imports: [AiModule],
  providers: [ToolRegistryService, WritingScoringAgent, SpeakingScoringAgent],
  exports: [ToolRegistryService, WritingScoringAgent, SpeakingScoringAgent],
})
export class AgentsModule {}
