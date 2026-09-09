import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { ToolRegistryService } from './tools/tool-registry.service';
import { clampToBand } from '../common/band.utils';

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
    private readonly aiService: AiService,
    private readonly toolRegistry: ToolRegistryService,
  ) {}

  async scoreEssay(params: {
    attemptId: string;
    questionPrompt: string;
    taskType: 'TASK_1' | 'TASK_2';
    studentEssay: string;
    userContext: { userId: string; role: string };
  }): Promise<{ scoreId: string | null; runId: string; status: string; output: WritingScoreOutput }> {
    const startTime = Date.now();
    this.logger.log(`Starting WritingScoringAgent for attempt ${params.attemptId}`);

    // Create AgentRun record
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
      // Step 1: Prompt Construction with strict IELTS Rubric
      const systemPrompt = `You are a certified IELTS Senior Examiner. Evaluate the following ${params.taskType} essay strictly using the official IELTS Band Descriptors (0 to 9 in half-band increments).

Assess 4 criteria:
1. Task Achievement (for Task 1) / Task Response (for Task 2)
2. Coherence and Cohesion
3. Lexical Resource
4. Grammatical Range and Accuracy

Spelling rules (mandatory):
- Spelling accuracy is scored as part of Lexical Resource, per the official descriptors ("errors in spelling and/or word formation"). Every misspelled word must lower Lexical Resource proportionally to its frequency and severity.
- List EVERY misspelled word in "inlineCorrections" using the exact original fragment, the corrected spelling, and an explanation that begins with "Spelling:".
- Do not invent errors; quote the student's text exactly as written.

Output rules (mandatory):
- All feedback, corrections and explanations MUST be written in polished, correctly spelled, grammatically clean English. Never include spelling or grammar mistakes in your own output text.
- Keep each criterionFeedback to 2-3 sentences, specific to this essay, quoting the student's exact words where relevant.

Calculate overall band score: (TR + CC + LR + GRA) / 4 rounded to nearest 0.5.
Calculate self-assessed confidence score between 0.00 and 1.00 based on certainty of rubric application.

Return strictly JSON matching this structure:
{
  "taskAchievement": number (0-9, e.g. 7.0),
  "coherenceCohesion": number (0-9, e.g. 6.5),
  "lexicalResource": number (0-9, e.g. 7.0),
  "grammaticalAccuracy": number (0-9, e.g. 6.0),
  "overallBand": number (0-9, e.g. 6.5),
  "confidence": number (0.0 to 1.0, e.g. 0.92),
  "criterionFeedback": {
    "taskAchievement": "string",
    "coherenceCohesion": "string",
    "lexicalResource": "string",
    "grammaticalAccuracy": "string"
  },
  "overallFeedback": "Summary string with constructive exam tips",
  "inlineCorrections": [
    {
      "originalText": "exact sentence fragment from essay",
      "correctedText": "refined academic phrasing",
      "explanation": "grammatical, lexical or spelling rationale"
    }
  ]
}`;

      const userMessage = `PROMPT:\n${params.questionPrompt}\n\nSTUDENT ESSAY:\n${params.studentEssay}`;

      // Step 2: Call Z.AI through AiService with strict output validation
      const { data: rawScoringData, result: genResult } =
        await this.aiService.executeStructuredTask<WritingScoreOutput>({
          taskType: 'REASONING_EVAL',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          temperature: 0.1,
          responseFormat: { type: 'json_object' },
          validator: (data: unknown): WritingScoreOutput => {
            if (!data || typeof data !== 'object') {
              throw new BadRequestException('Model returned malformed scoring payload');
            }
            const d = data as Record<string, any>;
            return {
              taskAchievement: clampToBand(d.taskAchievement),
              coherenceCohesion: clampToBand(d.coherenceCohesion),
              lexicalResource: clampToBand(d.lexicalResource),
              grammaticalAccuracy: clampToBand(d.grammaticalAccuracy),
              overallBand: clampToBand(d.overallBand),
              confidence:
                typeof d.confidence === 'number' && Number.isFinite(d.confidence)
                  ? Math.min(1, Math.max(0, d.confidence))
                  : 0, // missing confidence = least confident -> human review
              criterionFeedback: {
                taskAchievement: String(d.criterionFeedback?.taskAchievement ?? ''),
                coherenceCohesion: String(d.criterionFeedback?.coherenceCohesion ?? ''),
                lexicalResource: String(d.criterionFeedback?.lexicalResource ?? ''),
                grammaticalAccuracy: String(d.criterionFeedback?.grammaticalAccuracy ?? ''),
              },
              overallFeedback: String(d.overallFeedback ?? ''),
              inlineCorrections: Array.isArray(d.inlineCorrections)
                ? d.inlineCorrections.slice(0, 20).map((c: any) => ({
                    originalText: String(c?.originalText ?? ''),
                    correctedText: String(c?.correctedText ?? ''),
                    explanation: String(c?.explanation ?? ''),
                  }))
                : [],
            };
          },
        });
      const scoringData = rawScoringData;

      // Record Step
      await this.prisma.agentStep.create({
        data: {
          agentRunId: agentRun.id,
          stepName: 'ZAI_GLM_RUBRIC_EVALUATION',
          status: 'SUCCESS',
          durationMs: Date.now() - startTime,
          toolInputJson: { essayWordCount: params.studentEssay.split(/\s+/).length },
          toolOutputJson: scoringData as any,
        },
      });

      let scoreId: string | null = null;
      let finalStatus = 'COMPLETED';

      // Confidence Gate: >= 0.85 auto-publishes; < 0.85 routes to review queue
      if (scoringData.confidence >= 0.85) {
        // Idempotent: one score per (attempt, skill) — retries replace, never duplicate.
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
            inlineFeedbackJson: scoringData.inlineCorrections as any,
            scoredBy: 'AI_GLM',
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
            inlineFeedbackJson: scoringData.inlineCorrections as any,
            scoredBy: 'AI_GLM',
            confidence: scoringData.confidence,
          },
        });
        scoreId = score.id;

        await this.prisma.attempt.update({
          where: { id: params.attemptId },
          data: { status: 'COMPLETED' },
        });
      } else {
        // Below confidence threshold: route to review queue
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

      // Finalize AgentRun
      const totalDuration = Date.now() - startTime;
      await this.prisma.agentRun.update({
        where: { id: agentRun.id },
        data: {
          status: finalStatus as any,
          confidence: scoringData.confidence,
          outputPayloadJson: scoringData as any,
          costTokens: genResult.totalTokens,
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
    } catch (error: any) {
      this.logger.error(`WritingScoringAgent failed: ${error.message}`, error.stack);
      await this.prisma.agentRun.update({
        where: { id: agentRun.id },
        data: {
          status: 'FAILED',
          error: error.message,
          completedAt: new Date(),
        },
      });
      throw error;
    }
  }
}
