import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TestsService, QUESTIONS_PER_ATTEMPT } from './tests.service';
import type { GeneratableSkill } from './ai-question-generator.service';

/** Pool ceilings per skill — content-heavy skills keep bigger banks. */
const TARGET_POOL: Record<GeneratableSkill, number> = {
  LISTENING: QUESTIONS_PER_ATTEMPT * 3,
  READING: QUESTIONS_PER_ATTEMPT * 3,
  WRITING: 6,
  SPEAKING: 6,
};

const COOLDOWN_MS = 10 * 60 * 1000;
const MAX_CONCURRENT_RUNS = 2;

/**
 * QUESTION_GENERATION automation: when a student starts a test whose question
 * pool is running low, the system quietly tops the pool up in the background
 * so the next attempts keep serving fresh, never-before-seen questions.
 *
 * Never blocks or fails attempt starts — every path is best-effort with
 * in-flight + cooldown + global-concurrency guards.
 */
@Injectable()
export class PoolAutomationService {
  private readonly logger = new Logger(PoolAutomationService.name);
  private readonly inFlight = new Set<string>();
  private readonly lastTopUpAt = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly testsService: TestsService,
  ) {}

  maybeTopUp(testSetId: string): void {
    void this.run(testSetId).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Background pool top-up for ${testSetId} failed: ${message}`,
      );
    });
  }

  private async run(testSetId: string): Promise<void> {
    if (!process.env.ZAI_API_KEY) return; // AI disabled — seeded pools only
    if (this.inFlight.has(testSetId)) return;

    const lastTime = this.lastTopUpAt.get(testSetId);
    if (lastTime && Date.now() - lastTime < COOLDOWN_MS) return;

    const activeRuns = await this.prisma.agentRun.count({
      where: {
        agentType: 'QUESTION_GENERATION',
        status: { in: ['QUEUED', 'RUNNING'] },
      },
    });
    if (activeRuns >= MAX_CONCURRENT_RUNS) return;

    const testSet = await this.prisma.testSet.findUnique({
      where: { id: testSetId },
      select: { id: true, skill: true, title: true },
    });
    if (
      !testSet ||
      testSet.skill === 'FULL_MOCK' ||
      !(testSet.skill in TARGET_POOL)
    ) {
      return;
    }
    const skill = testSet.skill;
    const currentCount = await this.prisma.question.count({
      where: { testSetId },
    });
    const target = TARGET_POOL[skill];
    if (currentCount >= target) return;

    const count = Math.min(4, target - currentCount);
    // Cooldown is stamped only when a top-up will actually run — skipped
    // checks must not burn the window.
    this.lastTopUpAt.set(testSetId, Date.now());
    this.inFlight.add(testSetId);
    try {
      this.logger.log(
        `Pool low for ${testSet.title} (${currentCount}/${target}) — generating ${count} ${skill} questions`,
      );
      await this.testsService.generateAiQuestions({
        actorId: 'SYSTEM_POOL_AUTOMATION',
        skill,
        count,
        targetTestSetId: testSetId,
      });
      this.logger.log(`Pool top-up complete for ${testSet.title}`);
    } finally {
      this.inFlight.delete(testSetId);
    }
  }
}
