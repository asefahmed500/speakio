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
  private client: OpenAI;

  constructor() {
    const apiKey = process.env.ZAI_API_KEY;
    if (!apiKey) {
      this.logger.error('ZAI_API_KEY environment variable is not configured');
      throw new Error('ZAI_API_KEY environment variable is required');
    }
    const baseURL = process.env.ZAI_BASE_URL || 'https://api.z.ai/api/paas/v4';

    this.client = new OpenAI({
      apiKey,
      baseURL,
      timeout: 90_000,
      maxRetries: 0,
    });
    this.logger.log(`Initialized Z.AI Provider pointing to ${baseURL}`);
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    try {
      const response = await this.client.chat.completions.create({
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
    } catch (error: any) {
      this.logger.error(`Z.AI generation failed on model ${options.model}: ${error.message}`, error.stack);
      throw error;
    }
  }

  async *stream(options: GenerateOptions): AsyncGenerator<string, void, unknown> {
    try {
      const stream = await this.client.chat.completions.create({
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
    } catch (error: any) {
      this.logger.error(`Z.AI stream failed: ${error.message}`, error.stack);
      throw error;
    }
  }
}
