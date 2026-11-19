import {
  Injectable,
  Logger,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ToolRegistryService } from './tools/tool-registry.service';
import { ZaiProvider } from '../ai/zai.provider';
import { runSpeakingScoringGraph } from './langgraph/speaking-scoring.graph';
import type { SpeakingScore } from './langgraph/speaking-scoring.graph';
import { clampToBand } from '../common/band.utils';
import { isInfraFailure } from '../common/ai-error.utils';
import { Prisma } from '@prisma/client';

/** WAV 16 kHz mono 16-bit ≈ 32 KB/s — used to estimate segment duration. */
const WAV_BYTES_PER_SECOND = 16_000 * 2;
const MIN_TOTAL_TRANSCRIPT_WORDS = 10;
/** ASR accepts ≤30 s per file; allow a small header/tolerance margin. */
const MAX_SEGMENT_SECONDS = 32;

interface GraphRun {
  score: SpeakingScore;
  gate: 'PUBLISH' | 'REVIEW';
  tokenUsage: { input: number; output: number; total: number } | null;
}

/**
 * SPEAKING_SCORING agent — real audio in, honest IELTS band out.
 *
 * Pipeline: GLM-ASR transcription of each recorded WAV segment →
 * LangGraph speaking rubric (two independent passes when confidence is low) →
 * publish with a full audit trail. There is no human reviewer in the SaaS.
 */
@Injectable()
export class SpeakingScoringAgent {
  private readonly logger = new Logger(SpeakingScoringAgent.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly toolRegistry: ToolRegistryService,
    private readonly zaiProvider: ZaiProvider,
  ) {}

  async scoreRecording(params: {
    attemptId: string;
    cueCardPrompt: string;
    /** One or more `data:audio/wav;base64,...` segments (≤30 s each). */
    audioSegments: string[];
    /** Free fallback: typed response scored without paid transcription. */
    textAnswer?: string;
    userContext: { userId: string; role: string };
  }): Promise<{
    scoreId: string | null;
    runId: string;
    output: SpeakingScore;
  }> {
    const startTime = Date.now();
    const agentRun = await this.prisma.agentRun.create({
      data: {
        agentType: 'SPEAKING_SCORING',
        attemptId: params.attemptId,
        status: 'RUNNING',
        inputPayloadJson: {
          segments: params.audioSegments.length,
          estimatedSeconds: params.audioSegments.reduce(
            (s, seg) =>
              s + Math.round(this.base64Bytes(seg) / WAV_BYTES_PER_SECOND),
            0,
          ),
        } satisfies Prisma.InputJsonValue,
      },
    });

    try {
      // 1. Transcribe every segment (GLM-ASR), in order — or use the free
      // typed-answer path, which needs no transcription service at all.
      const transcripts: string[] = [];
      if (params.textAnswer) {
        transcripts.push(params.textAnswer);
      } else {
        for (const segment of params.audioSegments) {
          const commaIdx = segment.indexOf(',');
        if (commaIdx === -1) {
          throw new BadRequestException(
            'A recorded segment is malformed. Please record your response again.',
          );
        }
        const header = parseWavDuration(segment.slice(commaIdx + 1));
        if (header && header.durationSeconds > MAX_SEGMENT_SECONDS) {
          throw new BadRequestException(
            'A recording segment exceeds the 30-second limit. Please record again.',
          );
        }
        const base64 = segment.slice(commaIdx + 1);
          transcripts.push(await this.zaiProvider.transcribe(base64));
        }
      }
      const transcript = transcripts.join(' ').replace(/\s+/g, ' ').trim();
      if (
        transcript.split(/\s+/).filter(Boolean).length <
        MIN_TOTAL_TRANSCRIPT_WORDS
      ) {
        throw new BadRequestException(
          'The recording was too short or unclear to transcribe. Please record a longer response.',
        );
      }

      const audioDurationSeconds = params.audioSegments.reduce(
        (s, seg) => s + this.base64Bytes(seg) / WAV_BYTES_PER_SECOND,
        0,
      );

      // 2. First scoring pass.
      const first = await runSpeakingScoringGraph({
        cueCardPrompt: params.cueCardPrompt,
        transcript,
        audioDurationSeconds,
      });
      let totalTokens = first.tokenUsage?.total ?? 0;

      // 3. Low confidence → independent second pass (AI review agent).
      let published = first.score;
      let scoredBy = 'AI_GLM_LANGGRAPH';
      let auditStatus = 'AI_APPROVED';
      let reviewNote: string | null = null;

      if (first.gate === 'REVIEW') {
        let second: GraphRun | null = null;
        try {
          second = await runSpeakingScoringGraph({
            cueCardPrompt: params.cueCardPrompt,
            transcript,
            audioDurationSeconds,
          });
          totalTokens += second.tokenUsage?.total ?? 0;
        } catch (reviewError) {
          this.logger.warn(
            `Speaking review second pass failed for attempt ${params.attemptId}: ${reviewError instanceof Error ? reviewError.message : reviewError}`,
          );
        }

        if (second) {
          published = this.combinePasses(first.score, second.score);
          scoredBy = 'AI_REVIEW_GLM';
          auditStatus =
            published.confidence >= 0.7 ? 'AI_APPROVED' : 'AI_ESCALATED';
          reviewNote =
            `Two-pass AI review: pass1 ${first.score.overallBand} (conf ${first.score.confidence.toFixed(2)}), ` +
            `pass2 ${second.score.overallBand} (conf ${second.score.confidence.toFixed(2)}) -> final ${published.overallBand}.`;
        } else if (first.score.confidence >= 0.5) {
          auditStatus = 'AI_ESCALATED';
          reviewNote = `Second AI pass unavailable; published pass1 ${first.score.overallBand} (conf ${first.score.confidence.toFixed(2)}). Admin may override.`;
        } else {
          throw new Error(
            'Speaking confidence too low and the review pass is unavailable — attempt kept recoverable',
          );
        }
      }

      // 4. Publish + audit + complete. Telemetry is BEST-EFFORT: a failure
      // here must never regress an attempt that is already scored COMPLETED.
      const inlineFeedback = {
        criterionFeedback: published.criterionFeedback,
        transcript,
      } satisfies Prisma.InputJsonValue;
      const score = await this.prisma.score.upsert({
        where: {
          attemptId_skill: { attemptId: params.attemptId, skill: 'SPEAKING' },
        },
        update: {
          bandScore: published.overallBand,
          fluencyCoherence: published.fluencyCoherence,
          lexicalResource: published.lexicalResource,
          grammaticalAccuracy: published.grammaticalAccuracy,
          pronunciation: published.pronunciation,
          feedbackSummary: published.overallFeedback,
          inlineFeedbackJson: inlineFeedback,
          scoredBy,
          confidence: published.confidence,
        },
        create: {
          attemptId: params.attemptId,
          skill: 'SPEAKING',
          bandScore: published.overallBand,
          fluencyCoherence: published.fluencyCoherence,
          lexicalResource: published.lexicalResource,
          grammaticalAccuracy: published.grammaticalAccuracy,
          pronunciation: published.pronunciation,
          feedbackSummary: published.overallFeedback,
          inlineFeedbackJson: inlineFeedback,
          scoredBy,
          confidence: published.confidence,
        },
      });

      await this.prisma.attempt.update({
        where: { id: params.attemptId },
        data: { status: 'COMPLETED' },
      });

      try {
        await this.toolRegistry.executeTool(
          'recordReviewDecision',
          {
            attemptId: params.attemptId,
            skill: 'SPEAKING',
            proposedBand: first.score.overallBand,
            finalBand: published.overallBand,
            status: auditStatus,
            notes:
              reviewNote ??
              `AI speaking review: ${published.overallBand} (confidence ${published.confidence.toFixed(2)}). ${published.overallFeedback}`,
          },
          params.userContext,
        );
      } catch (auditError) {
        this.logger.error(
          `Review audit write failed for attempt ${params.attemptId}: ${auditError instanceof Error ? auditError.message : auditError}`,
        );
      }

      try {
        await this.prisma.agentRun.update({
          where: { id: agentRun.id },
          data: {
            status: 'COMPLETED',
            confidence: published.confidence,
            outputPayloadJson: published satisfies Prisma.InputJsonValue,
            costTokens: totalTokens,
            durationMs: Date.now() - startTime,
            completedAt: new Date(),
          },
        });
      } catch (runError) {
        this.logger.error(
          `AgentRun telemetry update failed for run ${agentRun.id}: ${runError instanceof Error ? runError.message : runError}`,
        );
      }

      return { scoreId: score.id, runId: agentRun.id, output: published };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`SpeakingScoringAgent failed: ${message}`);
      await this.prisma.agentRun.update({
        where: { id: agentRun.id },
        data: {
          status: 'FAILED',
          error: message,
          completedAt: new Date(),
          durationMs: Date.now() - startTime,
        },
      });
      // Re-throw HTTP exceptions as-is (BadRequest for content problems);
      // wrap everything else by type so attempts.service keeps its contract.
      if (error instanceof BadRequestException) throw error;
      throw isInfraFailure(message)
        ? new ServiceUnavailableException(
            'The AI speaking-review service is temporarily unavailable. Your submission is saved — please retry in a moment.',
          )
        : new BadRequestException(
            'The speaking agent could not complete this run. Use retry — the attempt is kept intact.',
          );
    }
  }

  /** Same policy as the writing agent: converge → mean, diverge → conservative. */
  private combinePasses(
    first: SpeakingScore,
    second: SpeakingScore,
  ): SpeakingScore {
    const delta = Math.abs(first.overallBand - second.overallBand);
    const overallBand =
      delta <= 1.0
        ? clampToBand((first.overallBand + second.overallBand) / 2)
        : Math.min(first.overallBand, second.overallBand);
    return {
      fluencyCoherence: clampToBand(
        (first.fluencyCoherence + second.fluencyCoherence) / 2,
      ),
      lexicalResource: clampToBand(
        (first.lexicalResource + second.lexicalResource) / 2,
      ),
      grammaticalAccuracy: clampToBand(
        (first.grammaticalAccuracy + second.grammaticalAccuracy) / 2,
      ),
      pronunciation: clampToBand(
        (first.pronunciation + second.pronunciation) / 2,
      ),
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
    };
  }

  private base64Bytes(dataUrl: string): number {
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    return Math.floor((base64.length * 3) / 4);
  }
}

/**
 * Parses the actual duration from a WAV header (fmt + data chunks) so the
 * rubric's speech-rate input and the 30 s ASR limit are enforced on facts,
 * not byte estimates. Returns null for anything that is not a PCM WAV.
 */
export function parseWavDuration(
  base64: string,
): { durationSeconds: number } | null {
  try {
    // 44 header bytes ≈ 60 base64 chars — decode just the head.
    const header = Buffer.from(base64.slice(0, 64), 'base64');
    if (header.length < 44) return null;
    if (header.toString('ascii', 0, 4) !== 'RIFF') return null;
    if (header.toString('ascii', 8, 12) !== 'WAVE') return null;
    const channels = header.readUInt16LE(22);
    const sampleRate = header.readUInt32LE(24);
    const bitsPerSample = header.readUInt16LE(34);
    const dataSize = header.readUInt32LE(40);
    if (!channels || !sampleRate || !bitsPerSample || !dataSize) return null;
    const bytesPerSecond = (sampleRate * channels * bitsPerSample) / 8;
    return { durationSeconds: dataSize / bytesPerSecond };
  } catch {
    return null;
  }
}
