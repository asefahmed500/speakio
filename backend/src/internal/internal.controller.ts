import {
  Controller,
  Headers,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { AttemptsService } from '../attempts/attempts.service';

/** Constant-time comparison — a plain string === leaks timing information. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Internal maintenance route. There is deliberately NO JWT guard — the caller
 * is the Cloudflare cron trigger, not a user. Access is controlled by a shared
 * secret header that is fail-closed when unconfigured.
 */
@Controller('internal')
export class InternalController {
  private readonly logger = new Logger(InternalController.name);

  constructor(private readonly attempts: AttemptsService) {}

  @Post('process-pending')
  async processPending(@Headers('x-cron-secret') provided?: string) {
    const expected = process.env.CRON_SECRET;
    // Fail closed: an unconfigured secret must never open an internal route.
    if (!expected) {
      throw new UnauthorizedException('Cron processing is not configured');
    }
    if (!provided || !secretMatches(provided, expected)) {
      throw new UnauthorizedException();
    }

    const result = await this.attempts.processPendingScoring(1);
    if (result.processed.length > 0) {
      this.logger.log(
        `Cron scored ${result.processed.filter((r) => r.ok).length}/${result.processed.length} pending attempt(s)`,
      );
    }
    return result;
  }
}
