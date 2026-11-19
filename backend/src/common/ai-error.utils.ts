/**
 * Shared AI provider failure classification. A single source of truth so the
 * writing and speaking agents can never drift: provider outages, rate limits
 * and quota exhaustion are infrastructure failures (503), never client 400s.
 */
const INFRA_FAILURE_RE =
  /ZAI_|api key|base ?url|fetch failed|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|timed? ?out|circuit open|rate ?limit|insufficient balance|\b429\b|\b401\b|\b403\b|\b5\d\d\b|too many requests|unauthoriz|authenticat|invalid token|token (?:has )?expired|transcription|internal server error|bad gateway/i;

export function isInfraFailure(message: string): boolean {
  return INFRA_FAILURE_RE.test(message);
}
