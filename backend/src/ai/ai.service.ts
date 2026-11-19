import { Injectable, Logger } from '@nestjs/common';
import { ZaiProvider, ChatMessage, GenerateResult } from './zai.provider';
import { ModelRouterService, AiTaskType } from './model-router.service';
import { invokeWithBackoff } from '../common/free-tier-backoff';

function isRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /rate ?limit|too many requests|\b429\b|temporarily overloaded/i.test(
    message,
  );
}

function isTransientNetworkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /request timed out|connection error|econnreset|econnrefused|enotfound|socket hang up|fetch failed/i.test(
    message,
  );
}

export interface StructuredGenerateOptions<T> {
  taskType: AiTaskType;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: { type: 'json_object' | 'text' };
  /** Per-request provider timeout override. */
  timeoutMs?: number;
  validator?: (data: unknown) => T;
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
    options?: {
      temperature?: number;
      maxTokens?: number;
      responseFormat?: { type: 'json_object' | 'text' };
      timeoutMs?: number;
    },
  ): Promise<GenerateResult> {
    const primaryModel = this.modelRouter.getModelForTask(taskType);
    // Escalation chain: primary -> fallback -> fallback of the fallback, and
    // ALWAYS the reasoning model as the last resort — account entitlements
    // differ per model (a key may only be provisioned for one), so a chain
    // that can never reach the reasoning model would hard-fail on 429s.
    const reasoningModel = process.env.ZAI_MODEL_REASONING || 'glm-5';
    const chain = [primaryModel];
    let next = this.modelRouter.getFallbackModel(primaryModel);
    while (chain.length < 3 && !chain.includes(next)) {
      chain.push(next);
      next = this.modelRouter.getFallbackModel(next);
    }
    if (!chain.includes(reasoningModel)) chain.push(reasoningModel);

    let lastError: unknown;
    for (let attempt = 0; attempt < chain.length; attempt++) {
      const model = chain[attempt];
      try {
        const startTime = Date.now();
        const result = await this.zaiProvider.generate({
          model,
          messages,
          temperature: options?.temperature ?? 0.2,
          maxTokens: options?.maxTokens ?? 2048,
          responseFormat: options?.responseFormat,
          timeoutMs: options?.timeoutMs,
        });
        const duration = Date.now() - startTime;
        this.logger.log(
          `Task ${taskType} executed on ${model} in ${duration}ms, tokens: ${result.totalTokens}`,
        );
        return result;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Attempt ${attempt + 1} failed on model ${model}: ${message}`,
        );
        if (attempt < chain.length - 1) {
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * (attempt + 1)),
          );
        }
      }
    }

    // The free tier (e.g. glm-4.7-flash) runs on shared capacity: expect 429
    // bursts and dropped connections. When the whole chain fails transiently,
    // retry the primary model with escalating backoff — bounded so callers
    // never hang indefinitely.
    if (isRateLimitError(lastError) || isTransientNetworkError(lastError)) {
      return invokeWithBackoff(
        () =>
          this.zaiProvider.generate({
            model: chain[0],
            messages,
            temperature: options?.temperature ?? 0.2,
            maxTokens: options?.maxTokens ?? 2048,
            responseFormat: options?.responseFormat,
            timeoutMs: options?.timeoutMs,
          }),
        {
          onRetry: (attempt, waitMs, message) =>
            this.logger.warn(
              `Transient failure on ${taskType} (${message.slice(0, 80)}) — retry ${attempt} in ${waitMs / 1000}s`,
            ),
        },
      );
    }

    if (lastError instanceof Error) throw lastError;
    throw new Error(`Execution failed after retries for task ${taskType}`);
  }

  async executeStructuredTask<T>(
    options: StructuredGenerateOptions<T>,
  ): Promise<{ data: T; result: GenerateResult }> {
    const baseMessages: ChatMessage[] = [
      ...options.messages,
      {
        role: 'system',
        content:
          'IMPORTANT: Respond strictly with valid JSON conforming to the requested schema. Do not enclose in markdown ticks if possible, or use standard ```json blocks.',
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

      const generateResult = await this.executeTask(
        options.taskType,
        corrective,
        {
          temperature: options.temperature ?? 0.1,
          maxTokens: options.maxTokens ?? 4000,
          responseFormat: options.responseFormat,
          timeoutMs: options.timeoutMs,
        },
      );

      let raw = generateResult.content.trim();
      // Robust JSON block extraction: matches fenced ```json ... ``` or extracts substring between outermost { } or [ ]
      const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) {
        raw = fenceMatch[1].trim();
      } else {
        const firstBrace = raw.indexOf('{');
        const lastBrace = raw.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          raw = raw.slice(firstBrace, lastBrace + 1);
        } else {
          const firstBracket = raw.indexOf('[');
          const lastBracket = raw.lastIndexOf(']');
          if (firstBracket !== -1 && lastBracket > firstBracket) {
            raw = raw.slice(firstBracket, lastBracket + 1);
          }
        }
      }

      try {
        const parsed: unknown = JSON.parse(raw);
        const validatedData = options.validator
          ? options.validator(parsed)
          : (parsed as T);
        return { data: validatedData, result: generateResult };
      } catch (parseError) {
        lastParseError =
          parseError instanceof Error
            ? parseError
            : new Error(String(parseError));
        parseAttempt++;
        this.logger.warn(
          `Structured output parse/validation failed (attempt ${parseAttempt}/${maxParseRetries + 1}) for task ${options.taskType}: ${lastParseError.message}`,
        );
      }
    }

    this.logger.error(
      `Structured output failed after ${maxParseRetries + 1} attempts for task ${options.taskType}`,
    );
    throw new Error(
      `Failed to obtain valid structured output from model after ${maxParseRetries + 1} attempts: ${lastParseError?.message ?? 'unknown error'}`,
    );
  }
}
