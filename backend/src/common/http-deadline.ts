import { ServiceUnavailableException } from '@nestjs/common';

/**
 * Hard ceiling for AI work that an HTTP request awaits. The edge proxy kills
 * requests at 100 s and surfaces that as an opaque 524. Fail fast and honestly
 * with a 503 instead; the underlying work is left to finish in the background.
 */
export const HTTP_AI_DEADLINE_MS = 95_000;

export function withHttpDeadline<T>(
  work: Promise<T>,
  label: string,
  deadlineMs: number = HTTP_AI_DEADLINE_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new ServiceUnavailableException(
            `The AI ${label} is taking too long to respond. Please try again shortly.`,
          ),
        ),
      deadlineMs,
    );
  });

  return Promise.race([work, deadline]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
