import { Injectable } from '@nestjs/common';

export type AiTaskType =
  'REASONING_EVAL' | 'COACH_ADVISOR' | 'FAST_CLASSIFY' | 'EXTRACTION';

@Injectable()
export class ModelRouterService {
  getModelForTask(taskType: AiTaskType): string {
    switch (taskType) {
      case 'REASONING_EVAL':
        return process.env.ZAI_MODEL_REASONING || '@cf/zai-org/glm-4.7-flash';
      case 'COACH_ADVISOR':
      case 'EXTRACTION':
        return process.env.ZAI_MODEL_GENERAL || '@cf/zai-org/glm-4.7-flash';
      case 'FAST_CLASSIFY':
        return process.env.ZAI_MODEL_FAST || '@cf/zai-org/glm-4.7-flash';
      default:
        return process.env.ZAI_MODEL_GENERAL || '@cf/zai-org/glm-4.7-flash';
    }
  }

  getFallbackModel(primaryModel: string): string {
    if (primaryModel === (process.env.ZAI_MODEL_REASONING || '@cf/zai-org/glm-4.7-flash')) {
      return process.env.ZAI_MODEL_GENERAL || '@cf/zai-org/glm-4.7-flash';
    }
    return process.env.ZAI_MODEL_FAST || '@cf/zai-org/glm-4.7-flash';
  }
}
