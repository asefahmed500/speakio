import { Injectable, Logger } from '@nestjs/common';
import { ZaiProvider, ChatMessage, GenerateResult } from './zai.provider';
import { ModelRouterService, AiTaskType } from './model-router.service';

export interface StructuredGenerateOptions<T> {
  taskType: AiTaskType;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: { type: 'json_object' | 'text' };
  validator?: (data: any) => T;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly zaiProvider: ZaiProvider,
    private readonly modelRouter: ModelRouterService,
  ) {}

  async executeTask(
    taskType: AiTaskType,
    messages: ChatMessage[],
    options?: { temperature?: number; maxTokens?: number; responseFormat?: { type: 'json_object' | 'text' } },
  ): Promise<GenerateResult> {
    const primaryModel = this.modelRouter.getModelForTask(taskType);
    let attempts = 0;
    const maxRetries = 2;

    while (attempts <= maxRetries) {
      const model = attempts === 0 ? primaryModel : this.modelRouter.getFallbackModel(primaryModel);
      try {
        const startTime = Date.now();
        const result = await this.zaiProvider.generate({
          model,
          messages,
          temperature: options?.temperature ?? 0.2,
          maxTokens: options?.maxTokens ?? 2048,
          responseFormat: options?.responseFormat,
        });
        const duration = Date.now() - startTime;
        this.logger.log(`Task ${taskType} executed on ${model} in ${duration}ms, tokens: ${result.totalTokens}`);
        return result;
      } catch (error: any) {
        attempts++;
        this.logger.warn(`Attempt ${attempts} failed on model ${model}: ${error.message}`);
        if (attempts > maxRetries) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempts));
      }
    }

    throw new Error(`Execution failed after retries for task ${taskType}`);
  }

  async executeStructuredTask<T>(options: StructuredGenerateOptions<T>): Promise<{ data: T; result: GenerateResult }> {
    const primaryModel = this.modelRouter.getModelForTask(options.taskType);
    const baseMessages: ChatMessage[] = [
      ...options.messages,
      {
        role: 'system',
        content: 'IMPORTANT: Respond strictly with valid JSON conforming to the requested schema. Do not enclose in markdown ticks if possible, or use standard ```json blocks.',
      },
    ];

    // Malformed model JSON is the most common LLM failure mode, so the
    // generate → parse → validate loop lives inside a bounded retry budget
    // instead of throwing away an entire generation on the first bad parse.
    const maxParseRetries = 2;
    let parseAttempt = 0;
    let lastParseError: Error | null = null;

    while (parseAttempt <= maxParseRetries) {
      const corrective: ChatMessage[] =
        parseAttempt > 0 && lastParseError
          ? [
              ...baseMessages,
              {
                role: 'user',
                content: `Your previous response was not usable: ${lastParseError.message}. Respond again with strictly valid JSON matching the requested schema and no extra text.`,
              },
            ]
          : baseMessages;

      const generateResult = await this.executeTask(options.taskType, corrective, {
        temperature: options.temperature ?? 0.1,
        maxTokens: options.maxTokens ?? 2500,
        responseFormat: options.responseFormat,
      });

      let raw = generateResult.content.trim();
      if (raw.startsWith('```json')) {
        raw = raw.replace(/^```json/, '').replace(/```$/, '').trim();
      } else if (raw.startsWith('```')) {
        raw = raw.replace(/^```/, '').replace(/```$/, '').trim();
      }

      try {
        const parsed = JSON.parse(raw);
        const validatedData = options.validator ? options.validator(parsed) : (parsed as T);
        return { data: validatedData, result: generateResult };
      } catch (parseError: any) {
        lastParseError = parseError;
        parseAttempt++;
        this.logger.warn(
          `Structured output parse/validation failed (attempt ${parseAttempt}/${maxParseRetries + 1}) for task ${options.taskType}: ${parseError.message}`,
        );
      }
    }

    this.logger.error(`Structured output failed after ${maxParseRetries + 1} attempts for task ${options.taskType}`);
    throw new Error(
      `Failed to obtain valid structured output from model after ${maxParseRetries + 1} attempts: ${lastParseError?.message ?? 'unknown error'}`,
    );
  }
}
