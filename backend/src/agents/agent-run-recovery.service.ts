import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Self-healing for the agent run log. A worker restart, aborted HTTP request or
 * crashed generation can leave a run in RUNNING forever. Those runs are not
 * retryable from the admin UI (it only retries failed writing runs), so they
 * poison the Ops dashboard. Sweep them to FAILED so the state is truthful and
 * the failure is observable.
 */
@Injectable()
export class AgentRunRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentRunRecoveryService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Runs older than this with no terminal state are considered dead. */
  static readonly STALE_RUN_MS = 10 * 60 * 1000;
  private static readonly SWEEP_INTERVAL_MS = 5 * 60 * 1000;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    void this.sweep();
    this.timer = setInterval(() => void this.sweep(), AgentRunRecoveryService.SWEEP_INTERVAL_MS);
    // A timer must never keep a serverless process or test runner alive.
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async sweep(): Promise<number> {
    try {
      const cutoff = new Date(Date.now() - AgentRunRecoveryService.STALE_RUN_MS);
      const result = await this.prisma.agentRun.updateMany({
        where: { status: 'RUNNING', createdAt: { lt: cutoff } },
        data: {
          status: 'FAILED',
          error: 'Run exceeded its execution window after a worker interruption',
          completedAt: new Date(),
        },
      });
      if (result.count > 0) {
        this.logger.warn(`Released ${result.count} stale RUNNING agent run(s) for retry`);
      }
      return result.count;
    } catch (error) {
      this.logger.error(
        `Agent run sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }
}
