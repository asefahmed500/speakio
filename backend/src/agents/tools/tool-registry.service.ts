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

interface FlagReviewArgs {
  attemptId: string;
  skill: SkillType;
  proposedBand: number;
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
          !['INSTRUCTOR', 'ADMIN', 'SUPER_ADMIN'].includes(userContext.role)
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

    // Tool 3: flagForInstructorReview (MEDIUM risk)
    this.registerTool({
      name: 'flagForInstructorReview',
      description:
        'Routes an AI-scored submission below confidence threshold to the instructor review queue',
      riskLevel: 'MEDIUM',
      run: async (rawArgs) => {
        const args = expectArgs<FlagReviewArgs>(rawArgs);
        const existing = await this.prisma.reviewQueueItem.findUnique({
          where: { attemptId: args.attemptId },
        });
        // Never reopen an item an examiner has already resolved.
        if (existing && existing.status !== 'PENDING') {
          return existing;
        }
        if (existing) {
          // Conditional update (not an upsert with a PENDING write): a rescore
          // racing an examiner's resolve must not flip a resolved item back to
          // PENDING — the status precondition makes that race impossible.
          const reopened = await this.prisma.reviewQueueItem.updateMany({
            where: { id: existing.id, status: 'PENDING' },
            data: {
              proposedBand: args.proposedBand,
              instructorNotes: args.notes,
            },
          });
          if (reopened.count === 0) {
            const resolved = await this.prisma.reviewQueueItem.findUnique({
              where: { id: existing.id },
            });
            return resolved;
          }
          return this.prisma.reviewQueueItem.findUnique({
            where: { id: existing.id },
          });
        }
        return this.prisma.reviewQueueItem.create({
          data: {
            attemptId: args.attemptId,
            skill: args.skill,
            proposedBand: args.proposedBand,
            instructorNotes: args.notes,
            status: 'PENDING',
          },
        });
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
