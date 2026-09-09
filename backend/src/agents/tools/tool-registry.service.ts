import { Injectable, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface ToolDefinition {
  name: string;
  description: string;
  riskLevel: RiskLevel;
  requiredRole?: string[];
  handler: (args: any, userContext: { userId: string; role: string }) => Promise<any>;
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
      handler: async (args: { attemptId: string }, userContext) => {
        const attempt = await this.prisma.attempt.findUnique({
          where: { id: args.attemptId },
          include: { testSet: true, user: true },
        });
        if (!attempt) throw new Error(`Attempt not found: ${args.attemptId}`);
        // Authorization: owner or instructor/admin
        if (attempt.userId !== userContext.userId && !['INSTRUCTOR', 'ADMIN', 'SUPER_ADMIN'].includes(userContext.role)) {
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
      description: 'Calculates IELTS overall band score applying official rounding rules',
      riskLevel: 'LOW',
      handler: async (args: { criteriaScores: number[] }) => {
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
      description: 'Routes an AI-scored submission below confidence threshold to the instructor review queue',
      riskLevel: 'MEDIUM',
      handler: async (args: { attemptId: string; skill: any; proposedBand: number; notes: string }) => {
        const existing = await this.prisma.reviewQueueItem.findUnique({
          where: { attemptId: args.attemptId },
        });
        // Never reopen an item an examiner has already resolved.
        if (existing && existing.status !== 'PENDING') {
          return existing;
        }
        return this.prisma.reviewQueueItem.upsert({
          where: { attemptId: args.attemptId },
          update: {
            proposedBand: args.proposedBand,
            instructorNotes: args.notes,
            status: 'PENDING',
          },
          create: {
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
    this.logger.log(`Registered agent tool [${tool.name}] with risk level ${tool.riskLevel}`);
  }

  async executeTool(name: string, args: any, userContext: { userId: string; role: string }) {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Tool ${name} not found in registry`);

    if (tool.requiredRole && !tool.requiredRole.includes(userContext.role)) {
      throw new ForbiddenException(`User with role ${userContext.role} cannot execute tool ${name}`);
    }

    this.logger.log(`Executing tool [${name}] by user ${userContext.userId} (${userContext.role})`);
    return tool.handler(args, userContext);
  }
}
