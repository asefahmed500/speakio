/**
 * Free-tier resilience: the free GLM models (e.g. glm-4.7-flash) run on
 * shared capacity and frequently answer `429 The service may be temporarily
 * overloaded`. Retry with escalating waits so production flows survive
 * bursts, while non-transient errors fail immediately.
 */
const TRANSIENT_RE =
  /\b429\b|rate ?limit|too many requests|temporarily overloaded|request timed out|connection error|econnreset|socket hang up|fetch failed/i;

// Two escalating waits keep the worst case (parse-retry × backoff layers)
// bounded to a few minutes while still riding out saturation bursts.
const DEFAULT_WAITS_MS = [15_000, 30_000];

export async function invokeWithBackoff<T>(
  fn: () => Promise<T>,
  options?: {
    waitsMs?: number[];
    onRetry?: (attempt: number, waitMs: number, message: string) => void;
  },
): Promise<T> {
  const waits = options?.waitsMs ?? DEFAULT_WAITS_MS;
  let lastError: unknown;
  for (let attempt = 0; attempt <= waits.length; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= waits.length || !TRANSIENT_RE.test(message)) {
        throw error;
      }
      options?.onRetry?.(attempt + 1, waits[attempt], message);
      await new Promise((resolve) => setTimeout(resolve, waits[attempt]));
    }
  }
  throw lastError;
}
