import { Injectable, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SkillType } from '@prisma/client';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface ToolContext {
  userId: string;
  role: string;
}

/**
 * A registered agent tool. `run` receives untyped arguments (the calling
 * agent owns the contract) and must validate them before use — returning
 * `unknown` keeps unsafe values from leaking into callers.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  riskLevel: RiskLevel;
  requiredRole?: string[];
  run: (args: unknown, userContext: ToolContext) => unknown;
}

interface AttemptLookupArgs {
  attemptId: string;
}

interface BandScoreArgs {
  criteriaScores: number[];
}

interface ReviewDecisionArgs {
  attemptId: string;
  skill: SkillType;
  proposedBand: number;
  finalBand: number;
  status: string;
  notes: string;
}

function expectArgs<T>(args: unknown): T {
  if (args === null || typeof args !== 'object') {
    throw new Error('Tool arguments must be an object');
  }
  return args as T;
}

@Injectable()
export class ToolRegistryService {
  private readonly logger = new Logger(ToolRegistryService.name);
  private tools = new Map<string, ToolDefinition>();

  constructor(private readonly prisma: PrismaService) {
    this.registerCoreTools();
  }

  private registerCoreTools() {
    // Tool 1: getAttemptSubmission (LOW risk)
    this.registerTool({
      name: 'getAttemptSubmission',
      description: 'Fetches student submission text for an attempt',
      riskLevel: 'LOW',
      run: async (rawArgs, userContext) => {
        const args = expectArgs<AttemptLookupArgs>(rawArgs);
        const attempt = await this.prisma.attempt.findUnique({
          where: { id: args.attemptId },
          include: { testSet: true, user: true },
        });
        if (!attempt) throw new Error(`Attempt not found: ${args.attemptId}`);
        // Authorization: owner or instructor/admin
        if (
          attempt.userId !== userContext.userId &&
          !['ADMIN'].includes(userContext.role)
        ) {
          throw new ForbiddenException('Unauthorized access to attempt');
        }
        return {
          id: attempt.id,
          skill: attempt.testSet.skill,
          answers: attempt.answersJson,
          submittedAt: attempt.submittedAt,
        };
      },
    });

    // Tool 2: calculateBandScore (LOW risk)
    this.registerTool({
      name: 'calculateBandScore',
      description:
        'Calculates IELTS overall band score applying official rounding rules',
      riskLevel: 'LOW',
      run: (rawArgs) => {
        const args = expectArgs<BandScoreArgs>(rawArgs);
        if (
          !Array.isArray(args.criteriaScores) ||
          args.criteriaScores.length === 0
        ) {
          throw new Error(
            'criteriaScores must be a non-empty array of numbers',
          );
        }
        const sum = args.criteriaScores.reduce((acc, val) => acc + val, 0);
        const avg = sum / args.criteriaScores.length;
        // IELTS rounding: e.g. 6.125 -> 6.0, 6.25 -> 6.5, 6.75 -> 7.0
        const rounded = Math.round(avg * 2) / 2;
        return { average: avg, bandScore: rounded };
      },
    });

    // Tool 3: recordReviewDecision (MEDIUM risk) — the AI review agents'
    // audit trail. Every automated band decision is persisted for the admin
    // AI-review monitor; admins may override afterwards.
    this.registerTool({
      name: 'recordReviewDecision',
      description:
        'Persists an AI review decision (proposed band, final band, confidence notes) to the review audit trail',
      riskLevel: 'MEDIUM',
      run: async (rawArgs) => {
        const args = expectArgs<ReviewDecisionArgs>(rawArgs);
        const existing = await this.prisma.reviewQueueItem.findUnique({
          where: { attemptId: args.attemptId },
        });
        const data = {
          skill: args.skill,
          status: args.status,
          proposedBand: args.proposedBand,
          finalBand: args.finalBand,
          instructorNotes: args.notes,
          reviewedAt: new Date(),
        };
        if (existing && ['OVERRIDDEN'].includes(existing.status)) {
          // An admin override is final — AI must not rewrite it.
          return existing;
        }
        if (existing) {
          const updated = await this.prisma.reviewQueueItem.updateMany({
            where: { id: existing.id, status: { not: 'OVERRIDDEN' } },
            data,
          });
          if (updated.count === 0) {
            return this.prisma.reviewQueueItem.findUnique({
              where: { id: existing.id },
            });
          }
          return this.prisma.reviewQueueItem.findUnique({
            where: { id: existing.id },
          });
        }
        try {
          return await this.prisma.reviewQueueItem.create({
            data: { attemptId: args.attemptId, ...data },
          });
        } catch (error) {
          // Lost a create race against a concurrent audit write for the same
          // attempt — fall through to the guarded update instead of failing
          // the whole scoring run with P2002.
          if ((error as { code?: string }).code === 'P2002') {
            const updated = await this.prisma.reviewQueueItem.updateMany({
              where: {
                attemptId: args.attemptId,
                status: { not: 'OVERRIDDEN' },
              },
              data,
            });
            if (updated.count === 0) {
              return this.prisma.reviewQueueItem.findUnique({
                where: { attemptId: args.attemptId },
              });
            }
            return this.prisma.reviewQueueItem.findUnique({
              where: { attemptId: args.attemptId },
            });
          }
          throw error;
        }
      },
    });
  }

  registerTool(tool: ToolDefinition) {
    this.tools.set(tool.name, tool);
    this.logger.log(
      `Registered agent tool [${tool.name}] with risk level ${tool.riskLevel}`,
    );
  }

  executeTool(name: string, args: unknown, userContext: ToolContext): unknown {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Tool ${name} not found in registry`);

    if (tool.requiredRole && !tool.requiredRole.includes(userContext.role)) {
      throw new ForbiddenException(
        `User with role ${userContext.role} cannot execute tool ${name}`,
      );
    }

    this.logger.log(
      `Executing tool [${name}] by user ${userContext.userId} (${userContext.role})`,
    );
    return tool.run(args, userContext);
  }
}
