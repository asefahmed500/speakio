import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { TestsController } from './tests.controller';
import { TestsService } from './tests.service';
import { QuestionUniquenessService } from './question-uniqueness.service';
import { OpenTdbQuestionGenerator } from './external-question-generator.service';
import { AiQuestionGeneratorService } from './ai-question-generator.service';
import { PoolAutomationService } from './pool-automation.service';

@Module({
  imports: [AiModule],
  controllers: [TestsController],
  providers: [
    TestsService,
    QuestionUniquenessService,
    OpenTdbQuestionGenerator,
    AiQuestionGeneratorService,
    PoolAutomationService,
  ],
  exports: [QuestionUniquenessService, PoolAutomationService, TestsService],
})
export class TestsModule {}
