import { Module } from '@nestjs/common';
import { TestsController } from './tests.controller';
import { TestsService } from './tests.service';
import { QuestionUniquenessService } from './question-uniqueness.service';
import { OpenTdbQuestionGenerator } from './external-question-generator.service';

@Module({
  controllers: [TestsController],
  providers: [
    TestsService,
    QuestionUniquenessService,
    OpenTdbQuestionGenerator,
  ],
  exports: [QuestionUniquenessService],
})
export class TestsModule {}
