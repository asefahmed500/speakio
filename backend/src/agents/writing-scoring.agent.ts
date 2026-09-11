import {
  Injectable,
  Logger,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ToolRegistryService } from './tools/tool-registry.service';
import { runWritingScoringGraph } from './langgraph/writing-scoring.graph';
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
      // LangGraph pipeline: loadSubmission → scoreEssay (Z.AI GLM, structured
      // output) → validateAndClamp → confidenceGate. DB writes stay here so the
      // persistence contract is independent of the graph implementation.
      const {
        score: scoringData,
        gate,
        steps,
      } = await runWritingScoringGraph({
        taskType: params.taskType,
        questionPrompt: params.questionPrompt,
        essay: params.studentEssay,
      });

      for (const step of steps) {
        await this.prisma.agentStep.create({
          data: {
            agentRunId: agentRun.id,
            stepName: step.name.toUpperCase(),
            status: 'SUCCESS',
            durationMs: step.durationMs,
            toolInputJson: {
              essayWordCount: params.studentEssay.split(/\s+/).length,
            },
            toolOutputJson: {
              summary: step.summary,
            } satisfies Prisma.InputJsonValue,
          },
        });
      }

      let scoreId: string | null = null;
      let finalStatus: AgentRunStatus = 'COMPLETED';

      if (gate === 'PUBLISH') {
        // Idempotent: one score per (attempt, skill) — retries replace, never duplicate.
        // inlineFeedbackJson carries BOTH the per-criterion examiner text and the
        // inline corrections so the results page can render the full AI feedback.
        const inlineFeedback = {
          criterionFeedback: scoringData.criterionFeedback,
          inlineCorrections: scoringData.inlineCorrections,
        } satisfies Prisma.InputJsonValue;
        const score = await this.prisma.score.upsert({
          where: {
            attemptId_skill: { attemptId: params.attemptId, skill: 'WRITING' },
          },
          update: {
            bandScore: scoringData.overallBand,
            taskAchievement: scoringData.taskAchievement,
            coherenceCohesion: scoringData.coherenceCohesion,
            lexicalResource: scoringData.lexicalResource,
            grammaticalAccuracy: scoringData.grammaticalAccuracy,
            feedbackSummary: scoringData.overallFeedback,
            inlineFeedbackJson: inlineFeedback,
            scoredBy: 'AI_GLM_LANGGRAPH',
            confidence: scoringData.confidence,
          },
          create: {
            attemptId: params.attemptId,
            skill: 'WRITING',
            bandScore: scoringData.overallBand,
            taskAchievement: scoringData.taskAchievement,
            coherenceCohesion: scoringData.coherenceCohesion,
            lexicalResource: scoringData.lexicalResource,
            grammaticalAccuracy: scoringData.grammaticalAccuracy,
            feedbackSummary: scoringData.overallFeedback,
            inlineFeedbackJson: inlineFeedback,
            scoredBy: 'AI_GLM_LANGGRAPH',
            confidence: scoringData.confidence,
          },
        });
        scoreId = score.id;

        await this.prisma.attempt.update({
          where: { id: params.attemptId },
          data: { status: 'COMPLETED' },
        });
      } else {
        finalStatus = 'WAITING_FOR_APPROVAL';
        await this.toolRegistry.executeTool(
          'flagForInstructorReview',
          {
            attemptId: params.attemptId,
            skill: 'WRITING',
            proposedBand: scoringData.overallBand,
            notes: `AI confidence (${scoringData.confidence.toFixed(2)}) below 0.85 threshold. Examiner manual confirmation required.`,
          },
          params.userContext,
        );

        await this.prisma.attempt.update({
          where: { id: params.attemptId },
          data: { status: 'NEEDS_REVIEW' },
        });
      }

      const totalDuration = Date.now() - startTime;
      await this.prisma.agentRun.update({
        where: { id: agentRun.id },
        data: {
          status: finalStatus,
          confidence: scoringData.confidence,
          outputPayloadJson: scoringData satisfies Prisma.InputJsonValue,
          costTokens: 0,
          durationMs: totalDuration,
          completedAt: new Date(),
        },
      });

      return {
        scoreId,
        runId: agentRun.id,
        status: finalStatus,
        output: scoringData,
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
      // down": missing env config or a provider outage is a 503, not a 400.
      const isInfraFailure =
        /ZAI_|api key|base ?url|fetch failed|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|timed? ?out|rate ?limit|status code 5\d\d/i.test(
          message,
        );
      throw isInfraFailure
        ? new ServiceUnavailableException(
            'The AI scoring service is temporarily unavailable. Your submission is saved — please retry in a moment.',
          )
        : new BadRequestException(
            'The scoring agent could not complete this run. Use retry — the attempt is kept intact.',
          );
    }
  }
}
