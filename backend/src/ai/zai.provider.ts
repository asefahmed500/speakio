import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerateOptions {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: { type: 'json_object' | 'text' };
}

export interface GenerateResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model: string;
}

@Injectable()
export class ZaiProvider {
  private readonly logger = new Logger(ZaiProvider.name);
  private client: OpenAI | null = null;

  /**
   * Lazily constructs the OpenAI-compatible client. Validating in the
   * constructor made a missing ZAI_API_KEY a hard bootstrap failure that
   * killed the whole app (auth, tests, everything) even when AI features
   * were unused — now only the AI call paths fail, with a clear error.
   */
  private getClient(): OpenAI {
    if (!this.client) {
      const apiKey = process.env.ZAI_API_KEY;
      if (!apiKey) {
        throw new Error('ZAI_API_KEY environment variable is required');
      }
      const baseURL =
        process.env.ZAI_BASE_URL || 'https://api.z.ai/api/paas/v4';
      this.client = new OpenAI({
        apiKey,
        baseURL,
        timeout: 90_000,
        maxRetries: 0,
      });
      this.logger.log(`Initialized Z.AI Provider pointing to ${baseURL}`);
    }
    return this.client;
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    try {
      const response = await this.getClient().chat.completions.create({
        model: options.model,
        messages: options.messages,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens ?? 2048,
        response_format: options.responseFormat,
      });

      const choice = response.choices[0];
      const usage = response.usage;

      return {
        content: choice?.message?.content || '',
        promptTokens: usage?.prompt_tokens ?? 0,
        completionTokens: usage?.completion_tokens ?? 0,
        totalTokens: usage?.total_tokens ?? 0,
        model: response.model,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Z.AI generation failed on model ${options.model}: ${message}`,
        stack,
      );
      throw error;
    }
  }

  async *stream(
    options: GenerateOptions,
  ): AsyncGenerator<string, void, unknown> {
    try {
      const stream = await this.getClient().chat.completions.create({
        model: options.model,
        messages: options.messages,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens ?? 2048,
        stream: true,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || '';
        if (delta) {
          yield delta;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Z.AI stream failed: ${message}`, stack);
      throw error;
    }
  }
}
