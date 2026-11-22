import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ToolRegistryService } from './tools/tool-registry.service';
import { WritingScoringAgent } from './writing-scoring.agent';
import { SpeakingScoringAgent } from './speaking-scoring.agent';
import { AgentRunRecoveryService } from './agent-run-recovery.service';

@Module({
  imports: [AiModule],
  providers: [
    ToolRegistryService,
    WritingScoringAgent,
    SpeakingScoringAgent,
    AgentRunRecoveryService,
  ],
  exports: [
    ToolRegistryService,
    WritingScoringAgent,
    SpeakingScoringAgent,
    AgentRunRecoveryService,
  ],
})
export class AgentsModule {}
