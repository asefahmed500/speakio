import {
  Injectable,
  Logger,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ToolRegistryService } from './tools/tool-registry.service';
import { runWritingScoringGraph } from './langgraph/writing-scoring.graph';
import type { WritingScore } from './langgraph/writing-scoring.graph';
import { clampToBand } from '../common/band.utils';
import { isInfraFailure } from '../common/ai-error.utils';
import { Prisma, AgentRunStatus } from '@prisma/client';

export interface WritingScoreOutput {
  taskAchievement: number;
  coherenceCohesion: number;
  lexicalResource: number;
  grammaticalAccuracy: number;
  overallBand: number;
  confidence: number;
  criterionFeedback: {
    taskAchievement: string;
    coherenceCohesion: string;
    lexicalResource: string;
    grammaticalAccuracy: string;
  };
  overallFeedback: string;
  inlineCorrections: Array<{
    originalText: string;
    correctedText: string;
    explanation: string;
  }>;
}

interface GraphRun {
  score: WritingScore;
  gate: 'PUBLISH' | 'REVIEW';
  tokenUsage: { input: number; output: number; total: number } | null;
}

@Injectable()
export class WritingScoringAgent {
  private readonly logger = new Logger(WritingScoringAgent.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly toolRegistry: ToolRegistryService,
  ) {}

  async scoreEssay(params: {
    attemptId: string;
    questionPrompt: string;
    taskType: 'TASK_1' | 'TASK_2';
    studentEssay: string;
    userContext: { userId: string; role: string };
  }): Promise<{
    scoreId: string | null;
    runId: string;
    status: string;
    output: WritingScoreOutput;
  }> {
    const startTime = Date.now();
    this.logger.log(
      `Starting WritingScoringAgent (LangGraph) for attempt ${params.attemptId}`,
    );

    const agentRun = await this.prisma.agentRun.create({
      data: {
        agentType: 'WRITING_SCORING',
        attemptId: params.attemptId,
        status: 'RUNNING',
        inputPayloadJson: {
          taskType: params.taskType,
          essayLength: params.studentEssay.split(/\s+/).length,
        },
      },
    });

    try {
      // Pipeline: score pass 1 (Z.AI GLM, structured output). A PUBLISH gate
      // finishes immediately; a REVIEW gate triggers an INDEPENDENT second
      // pass by the AI review agent — there is no human queue in this SaaS.
      let totalTokens = 0;
      const first = await runWritingScoringGraph({
        taskType: params.taskType,
        questionPrompt: params.questionPrompt,
        essay: params.studentEssay,
      });
      totalTokens += first.tokenUsage?.total ?? 0;

      let published: WritingScore = first.score;
      let scoredBy = 'AI_GLM_LANGGRAPH';
      const finalStatus: AgentRunStatus = 'COMPLETED';
      let auditStatus = 'AI_APPROVED';
      let reviewNote: string | null = null;

      if (first.gate === 'REVIEW') {
        // ---- AI review agent: independent second opinion ----
        let second: GraphRun | null = null;
        try {
          second = await runWritingScoringGraph({
            taskType: params.taskType,
            questionPrompt: params.questionPrompt,
            essay: params.studentEssay,
          });
          totalTokens += second.tokenUsage?.total ?? 0;
        } catch (reviewError) {
          this.logger.warn(
            `AI review second pass failed for attempt ${params.attemptId}: ${reviewError instanceof Error ? reviewError.message : reviewError}`,
          );
        }

        if (second) {
          published = this.combinePasses(first.score, second.score);
          scoredBy = 'AI_REVIEW_GLM';
          auditStatus =
            published.confidence >= 0.7 ? 'AI_APPROVED' : 'AI_ESCALATED';
          reviewNote =
            `Two-pass AI review: pass1 ${first.score.overallBand} (conf ${first.score.confidence.toFixed(2)}), ` +
            `pass2 ${second.score.overallBand} (conf ${second.score.confidence.toFixed(2)}) -> final ${published.overallBand}. ` +
            `${second.score.overallFeedback}`;
        } else if (first.score.confidence >= 0.5) {
          // Second pass unavailable: publish the first pass honestly with its
          // own confidence and escalate for admin attention.
          scoredBy = 'AI_GLM_LANGGRAPH';
          auditStatus = 'AI_ESCALATED';
          reviewNote = `Second AI pass unavailable; published pass1 ${first.score.overallBand} (conf ${first.score.confidence.toFixed(2)}). Admin may override.`;
        } else {
          // Low confidence AND no second pass: never fabricate a result.
          throw new Error(
            'AI scoring confidence too low and the review pass is unavailable — attempt kept recoverable',
          );
        }
      }

      const scoreId = await this.publishScore(
        params.attemptId,
        published,
        scoredBy,
      );

      await this.prisma.attempt.update({
        where: { id: params.attemptId },
        data: { status: 'COMPLETED' },
      });

      // Audit trail + run telemetry are BEST-EFFORT: a telemetry failure must
      // never regress an attempt that is already scored and COMPLETED.
      try {
        await this.toolRegistry.executeTool(
          'recordReviewDecision',
          {
            attemptId: params.attemptId,
            skill: 'WRITING',
            proposedBand: first.score.overallBand,
            finalBand: published.overallBand,
            status: auditStatus,
            notes:
              reviewNote ??
              `AI scored ${published.overallBand} (confidence ${published.confidence.toFixed(2)}). ${published.overallFeedback}`,
          },
          params.userContext,
        );
      } catch (auditError) {
        this.logger.error(
          `Review audit write failed for attempt ${params.attemptId}: ${auditError instanceof Error ? auditError.message : auditError}`,
        );
      }

      const totalDuration = Date.now() - startTime;
      try {
        await this.prisma.agentRun.update({
          where: { id: agentRun.id },
          data: {
            status: finalStatus,
            confidence: published.confidence,
            outputPayloadJson: published satisfies Prisma.InputJsonValue,
            costTokens: totalTokens,
            durationMs: totalDuration,
            completedAt: new Date(),
          },
        });
      } catch (runError) {
        this.logger.error(
          `AgentRun telemetry update failed for run ${agentRun.id}: ${runError instanceof Error ? runError.message : runError}`,
        );
      }

      return {
        scoreId,
        runId: agentRun.id,
        status: finalStatus,
        output: published,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`WritingScoringAgent failed: ${message}`, stack);
      await this.prisma.agentRun.update({
        where: { id: agentRun.id },
        data: {
          status: 'FAILED',
          error: message,
          completedAt: new Date(),
        },
      });
      // Distinguish "you did something wrong" from "our infrastructure is
      // down": missing env config, provider outages, rate limits and quota
      // exhaustion are all 503s, never a client 400.
      throw isInfraFailure(message)
        ? new ServiceUnavailableException(
            'The AI scoring service is temporarily unavailable. Your submission is saved — please retry in a moment.',
          )
        : new BadRequestException(
            'The scoring agent could not complete this run. Use retry — the attempt is kept intact.',
          );
    }
  }

  /**
   * Combines two independent AI passes into the published result:
   * - scores within one band of each other -> mean (rounded to 0.5)
   * - divergent scores -> the CONSERVATIVE (lower) band
   * - confidence capped at 0.95: post-review results are stronger but never
   *   presented as certain as single-pass high-confidence scores.
   */
  private combinePasses(
    first: WritingScore,
    second: WritingScore,
  ): WritingScore {
    const criteria = (a: WritingScore, b: WritingScore) => ({
      taskAchievement: clampToBand((a.taskAchievement + b.taskAchievement) / 2),
      coherenceCohesion: clampToBand(
        (a.coherenceCohesion + b.coherenceCohesion) / 2,
      ),
      lexicalResource: clampToBand((a.lexicalResource + b.lexicalResource) / 2),
      grammaticalAccuracy: clampToBand(
        (a.grammaticalAccuracy + b.grammaticalAccuracy) / 2,
      ),
    });
    const delta = Math.abs(first.overallBand - second.overallBand);
    const overallBand =
      delta <= 1.0
        ? clampToBand((first.overallBand + second.overallBand) / 2)
        : Math.min(first.overallBand, second.overallBand);
    return {
      ...criteria(first, second),
      overallBand,
      confidence: Math.min(
        0.95,
        Math.max(first.confidence, second.confidence) + 0.05,
      ),
      criterionFeedback:
        second.confidence >= first.confidence
          ? second.criterionFeedback
          : first.criterionFeedback,
      overallFeedback: second.overallFeedback || first.overallFeedback,
      inlineCorrections:
        second.inlineCorrections.length > 0
          ? second.inlineCorrections
          : first.inlineCorrections,
    };
  }

  /** Idempotent: one score per (attempt, skill) — retries replace, never duplicate. */
  private async publishScore(
    attemptId: string,
    score: WritingScore,
    scoredBy: string,
  ): Promise<string> {
    const inlineFeedback = {
      criterionFeedback: score.criterionFeedback,
      inlineCorrections: score.inlineCorrections,
    } satisfies Prisma.InputJsonValue;
    const row = await this.prisma.score.upsert({
      where: {
        attemptId_skill: { attemptId, skill: 'WRITING' },
      },
      update: {
        bandScore: score.overallBand,
        taskAchievement: score.taskAchievement,
        coherenceCohesion: score.coherenceCohesion,
        lexicalResource: score.lexicalResource,
        grammaticalAccuracy: score.grammaticalAccuracy,
        feedbackSummary: score.overallFeedback,
        inlineFeedbackJson: inlineFeedback,
        scoredBy,
        confidence: score.confidence,
      },
      create: {
        attemptId,
        skill: 'WRITING',
        bandScore: score.overallBand,
        taskAchievement: score.taskAchievement,
        coherenceCohesion: score.coherenceCohesion,
        lexicalResource: score.lexicalResource,
        grammaticalAccuracy: score.grammaticalAccuracy,
        feedbackSummary: score.overallFeedback,
        inlineFeedbackJson: inlineFeedback,
        scoredBy,
        confidence: score.confidence,
      },
    });
    return row.id;
  }
}
