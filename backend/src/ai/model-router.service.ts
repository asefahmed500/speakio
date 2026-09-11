import { Injectable } from '@nestjs/common';

export type AiTaskType =
  'REASONING_EVAL' | 'COACH_ADVISOR' | 'FAST_CLASSIFY' | 'EXTRACTION';

@Injectable()
export class ModelRouterService {
  getModelForTask(taskType: AiTaskType): string {
    switch (taskType) {
      case 'REASONING_EVAL':
        return process.env.ZAI_MODEL_REASONING || 'glm-5';
      case 'COACH_ADVISOR':
      case 'EXTRACTION':
        return process.env.ZAI_MODEL_GENERAL || 'glm-4.5-air';
      case 'FAST_CLASSIFY':
        return process.env.ZAI_MODEL_FAST || 'glm-5.3-flash';
      default:
        return process.env.ZAI_MODEL_GENERAL || 'glm-4.5-air';
    }
  }

  getFallbackModel(primaryModel: string): string {
    if (primaryModel === (process.env.ZAI_MODEL_REASONING || 'glm-5')) {
      return process.env.ZAI_MODEL_GENERAL || 'glm-4.5-air';
    }
    return process.env.ZAI_MODEL_FAST || 'glm-5.3-flash';
  }
}
