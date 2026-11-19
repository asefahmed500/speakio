import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

export interface GeneratedQuestion {
  prompt: string;
  options: string[];
  correctAnswer: string;
  category: string;
  difficulty: 'easy' | 'medium' | 'hard';
}

export interface GenerationContext {
  count: number;
  category?: number;
  difficulty?: 'easy' | 'medium' | 'hard';
  /** Fingerprints already present in the local pool — provider results are filtered against these. */
  excludedFingerprints?: Set<string>;
  fingerprint: (prompt: string) => string;
}

/**
 * Abstraction so the external provider can be swapped without touching the
 * assessment system. Providers must never be called at exam time — generated
 * questions are validated and persisted into the local question pool.
 */
export interface QuestionGenerator {
  generateQuestions(ctx: GenerationContext): Promise<GeneratedQuestion[]>;
}

interface OpenTdbResult {
  question: string;
  correct_answer: string;
  incorrect_answers: string[];
  category: string;
  difficulty: string;
}

/**
 * Base URL is read lazily (see baseUrl()) — a module-level constant would
 * capture process.env before @nestjs/config loads the .env file, silently
 * ignoring QUESTION_GENERATION_API_URL set only there.
 */
@Injectable()
export class OpenTdbQuestionGenerator implements QuestionGenerator {
  private readonly logger = new Logger(OpenTdbQuestionGenerator.name);
  private token: { value: string; createdAt: number } | null = null;
  // Concurrent admin imports share one in-flight token request instead of
  // burning the provider's limited session tokens.
  private tokenRequest: Promise<string> | null = null;
  private static readonly TOKEN_TTL_MS = 5 * 60 * 60 * 1000;

  private get baseUrl(): string {
    return process.env.QUESTION_GENERATION_API_URL ?? 'https://opentdb.com';
  }

  private decode(value: string): string {
    // encode=url3986 keeps payloads ASCII-safe; decode here.
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  private async requestSessionToken(): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api_token.php?command=request`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new ServiceUnavailableException(
        `Question provider rejected the token request (HTTP ${res.status})`,
      );
    }
    const body = (await res.json()) as { token?: string };
    if (!body.token)
      throw new ServiceUnavailableException(
        'Question provider did not issue a session token',
      );
    return body.token;
  }

  private async getToken(): Promise<string> {
    if (
      this.token &&
      Date.now() - this.token.createdAt < OpenTdbQuestionGenerator.TOKEN_TTL_MS
    ) {
      return this.token.value;
    }
    if (!this.tokenRequest) {
      this.tokenRequest = this.requestSessionToken().finally(() => {
        this.tokenRequest = null;
      });
    }
    const value = await this.tokenRequest;
    this.token = { value, createdAt: Date.now() };
    return value;
  }

  private async resetToken(): Promise<void> {
    if (this.token) {
      await fetch(
        `${this.baseUrl}/api_token.php?command=reset&token=${this.token.value}`,
        { signal: AbortSignal.timeout(15_000) },
      ).catch(() => {});
    }
    this.token = null;
  }

  async generateQuestions(
    ctx: GenerationContext,
  ): Promise<GeneratedQuestion[]> {
    const token = await this.getToken();
    const params = new URLSearchParams({
      amount: String(ctx.count),
      type: 'multiple',
      encode: 'url3986',
      token,
    });
    if (ctx.category) params.set('category', String(ctx.category));
    if (ctx.difficulty) params.set('difficulty', ctx.difficulty);

    let body = await this.call(params.toString());
    // Code 4: token exhausted all questions for this query — reset once and retry.
    if (body.response_code === 4) {
      await this.resetToken();
      const fresh = await this.getToken();
      params.set('token', fresh);
      body = await this.call(params.toString());
    }
    if (body.response_code !== 0 || !Array.isArray(body.results)) {
      throw new ServiceUnavailableException(
        'The question provider has no questions for this configuration right now. Try a different category or difficulty.',
      );
    }

    const mapped = body.results.map((r) => {
      const correct = this.decode(r.correct_answer);
      const options = [
        correct,
        ...r.incorrect_answers.map((a) => this.decode(a)),
      ];
      // Deterministic-enough shuffle so the correct answer is not always first.
      for (let i = options.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [options[i], options[j]] = [options[j], options[i]];
      }
      return {
        prompt: this.decode(r.question),
        options,
        correctAnswer: correct,
        category: this.decode(r.category),
        difficulty: (['easy', 'medium', 'hard'].includes(r.difficulty)
          ? r.difficulty
          : 'medium') as GeneratedQuestion['difficulty'],
      };
    });

    const excluded = ctx.excludedFingerprints;
    const filtered = excluded
      ? mapped.filter((q) => !excluded.has(ctx.fingerprint(q.prompt)))
      : mapped;
    if (mapped.length > 0 && filtered.length === 0) {
      throw new ServiceUnavailableException(
        'All generated questions already exist in the pool. Try a different category or difficulty.',
      );
    }
    return filtered;
  }

  private async call(
    query: string,
  ): Promise<{ response_code: number; results?: OpenTdbResult[] }> {
    // Provider rate limit: 1 request / 5s per IP — retry once after a pause on failure.
    const doFetch = async () => {
      const res = await fetch(`${this.baseUrl}/api.php?${query}`, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        // A 429/500 with an HTML body would make res.json() throw and escape
        // as a raw TypeError; surface it as a proper 503 instead.
        throw new ServiceUnavailableException(
          `Question provider returned HTTP ${res.status}. Try again in a moment.`,
        );
      }
      return (await res.json()) as {
        response_code: number;
        results?: OpenTdbResult[];
      };
    };
    try {
      return await doFetch();
    } catch (error) {
      // Never pause-and-retry an explicit HTTP status failure — the provider
      // already told us to back off; only retry transient network errors.
      if (error instanceof ServiceUnavailableException) throw error;
      this.logger.warn(
        'Question provider call failed — retrying once after rate-limit pause',
      );
      await new Promise((r) => setTimeout(r, 5_500));
      try {
        return await doFetch();
      } catch (retryError) {
        // A timeout / dropped connection on the final attempt is a provider
        // outage — surface a clean 503, never a raw 500.
        const message =
          retryError instanceof Error ? retryError.message : String(retryError);
        throw new ServiceUnavailableException(
          `The question provider did not respond in time (${message}). Try again shortly.`,
        );
      }
    }
  }
}
