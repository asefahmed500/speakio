import { Module } from '@nestjs/common';
import { ZaiProvider } from './zai.provider';
import { ModelRouterService } from './model-router.service';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';

@Module({
  controllers: [AiController],
  providers: [ZaiProvider, ModelRouterService, AiService],
  exports: [ZaiProvider, ModelRouterService, AiService],
})
export class AiModule {}
