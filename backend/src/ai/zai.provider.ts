import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { getAiToken, refreshAiToken } from '../common/ai-token';

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
  /** Per-request timeout override (the client default is 90s). */
  timeoutMs?: number;
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
  private clientKey = '';

  /**
   * Small in-process circuit breaker. A sustained provider outage (429 quota,
   * timeouts) opens the circuit so callers fail fast instead of spending the
   * full retry ladder on every request. Half-open probes allow recovery.
   */
  private breaker = {
    failures: 0,
    openUntil: 0,
    halfOpen: false,
  };
  private static readonly FAILURE_THRESHOLD = 5;
  private static readonly COOLDOWN_MS = 60_000;

  private assertAvailable(): void {
    const now = Date.now();
    if (this.breaker.openUntil > now) {
      throw new Error(
        `AI provider circuit open for another ${Math.ceil((this.breaker.openUntil - now) / 1000)}s`,
      );
    }
    if (this.breaker.halfOpen) return;
    if (this.breaker.failures >= ZaiProvider.FAILURE_THRESHOLD) {
      this.breaker.openUntil = now + ZaiProvider.COOLDOWN_MS;
      this.breaker.halfOpen = true;
      throw new Error('AI provider circuit opened after repeated failures');
    }
  }

  private recordSuccess(): void {
    this.breaker.failures = 0;
    this.breaker.openUntil = 0;
    this.breaker.halfOpen = false;
  }

  private recordFailure(): void {
    if (!this.breaker.halfOpen) this.breaker.failures += 1;
  }

  /**
   * Lazily constructs the OpenAI-compatible client. Validating in the
   * constructor made a missing ZAI_API_KEY a hard bootstrap failure that
   * killed the whole app (auth, tests, everything) even when AI features
   * were unused — now only the AI call paths fail, with a clear error.
   */
  private getClient(): OpenAI {
    // Rebuild when the rotating credential changes so a stale cached client
    // never keeps sending an expired OAuth token.
    const apiKey = getAiToken();
    if (!apiKey) {
      throw new Error('ZAI_API_KEY environment variable is required');
    }
    if (this.client && this.clientKey === apiKey) return this.client;

    const baseURL = process.env.ZAI_BASE_URL || 'https://api.z.ai/api/paas/v4';
    this.client = new OpenAI({
      apiKey,
      baseURL,
      timeout: 90_000,
      // The SDK's built-in exponential backoff absorbs transient network
      // blips and 429/5xx without failing the whole task chain.
      maxRetries: 2,
    });
    this.clientKey = apiKey;
    this.logger.log(`Initialized AI provider pointing to ${baseURL}`);
    return this.client;
  }

  async generate(options: GenerateOptions, retried = false): Promise<GenerateResult> {
    this.assertAvailable();
    try {
      const response = await this.getClient().chat.completions.create(
        {
          model: options.model,
          messages: options.messages,
          temperature: options.temperature ?? 0.2,
          max_tokens: options.maxTokens ?? 2048,
          response_format: options.responseFormat,
        },
        options.timeoutMs ? { timeout: options.timeoutMs } : undefined,
      );

      const choice = response.choices[0];
      const usage = response.usage;
      this.recordSuccess();

      return {
        content: choice?.message?.content || '',
        promptTokens: usage?.prompt_tokens ?? 0,
        completionTokens: usage?.completion_tokens ?? 0,
        totalTokens: usage?.total_tokens ?? 0,
        model: response.model,
      };
    } catch (error) {
      // OAuth tokens rotate; a 401 means the cached client holds a stale one.
      // Refresh through wrangler and retry exactly once.
      const status = (error as { status?: number } | null)?.status;
      if (status === 401 && !retried) {
        refreshAiToken();
        this.client = null;
        this.clientKey = '';
        return this.generate(options, true);
      }
      this.recordFailure();
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `AI generation failed on model ${options.model}: ${message}`,
        stack,
      );
      throw error;
    }
  }

  /**
   * GLM-ASR speech-to-text. `audioBase64` must be a complete WAV/MP3 file of
   * ≤30 seconds (provider limit) — segmenting happens upstream.
   */
  async transcribe(audioBase64: string): Promise<string> {
    this.assertAvailable();
    // Cloudflare Workers AI has no /audio/transcriptions endpoint — use the
    // free Whisper REST model instead (same provider, same API key).
    if (process.env.ZAI_BASE_URL?.includes('api.cloudflare.com')) {
      return this.transcribeWithWorkersAi(audioBase64);
    }
    try {
      const buffer = Buffer.from(audioBase64, 'base64');
      // Node 20+ exposes File globally; the SDK uploads it as multipart form.
      const file = new File([buffer], 'segment.wav', { type: 'audio/wav' });
      const response = await this.getClient().audio.transcriptions.create(
        {
          model: process.env.ZAI_MODEL_ASR || 'glm-asr-2512',
          file: file,
        },
        { timeout: 120_000 },
      );
      this.recordSuccess();
      return (response as { text?: string }).text?.trim() ?? '';
    } catch (error) {
      this.recordFailure();
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Z.AI transcription failed: ${message}`, stack);
      throw error;
    }
  }

  private async transcribeWithWorkersAi(audioBase64: string): Promise<string> {
    try {
      const base = process.env.ZAI_BASE_URL!.replace(/\/v1\/?$/, '');
      const model = process.env.ZAI_MODEL_ASR || '@cf/openai/whisper-large-v3-turbo';
      const response = await fetch(
        `${base}/run/${model}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${getAiToken()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ audio: audioBase64, task: 'transcribe' }),
          signal: AbortSignal.timeout(120_000),
        },
      );
      const json = (await response.json()) as {
        result?: { text?: string };
        errors?: Array<{ message?: string }>;
      };
      if (!response.ok) {
        throw new Error(
          `Workers AI transcription failed: ${json.errors?.[0]?.message ?? response.status}`,
        );
      }
      this.recordSuccess();
      return (json.result?.text ?? '').trim();
    } catch (error) {
      this.recordFailure();
      this.logger.error(
        `Workers AI transcription failed: ${error instanceof Error ? error.message : error}`,
      );
      throw error;
    }
  }

  async *stream(
    options: GenerateOptions,
  ): AsyncGenerator<string, void, unknown> {
    this.assertAvailable();
    try {
      const stream = await this.getClient().chat.completions.create(
        {
          model: options.model,
          messages: options.messages,
          temperature: options.temperature ?? 0.2,
          max_tokens: options.maxTokens ?? 2048,
          stream: true,
        },
        { timeout: options.timeoutMs ?? 90_000 },
      );

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
