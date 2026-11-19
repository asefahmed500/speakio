import {
  Body,
  Controller,
  Post,
  UseGuards,
  Req,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { AiService } from './ai.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { isInfraFailure } from '../common/ai-error.utils';
import type { AuthenticatedRequest } from '../auth/authenticated-request';

const paraphraseSchema = z.object({
  text: z
    .string()
    .trim()
    .min(10, 'Provide at least a sentence to paraphrase')
    .max(2000),
});

const generatedMilestoneSchema = z.object({
  day: z.number().int().min(1).max(365),
  title: z.string().trim().min(3).max(200),
  skill: z.enum(['LISTENING', 'READING', 'WRITING', 'SPEAKING', 'MOCK']),
  durationMinutes: z.number().int().min(5).max(300),
  taskDetails: z.string().trim().min(3).max(1000),
});

const generatedPlanSchema = z.object({
  summary: z.string().trim().max(600),
  milestones: z.array(generatedMilestoneSchema).min(3).max(60),
});

@Controller('ai')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly prisma: PrismaService,
  ) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('paraphrase')
  async paraphrase(
    @Body(new ZodValidationPipe(paraphraseSchema))
    body: z.infer<typeof paraphraseSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    const { data } = await this.aiService
      .executeStructuredTask<{
        rewrites: string[];
      }>({
        taskType: 'COACH_ADVISOR',
        responseFormat: { type: 'json_object' },
        // Stay under Cloudflare's 100 s edge limit: this call is awaited by
        // the HTTP request, so a longer timeout would surface as a 524.
        timeoutMs: 90_000,
        messages: [
          {
            role: 'system',
            content:
              'You are an IELTS Band 8+ academic writing coach. Rewrite the user’s sentence three different ways at Band 8+ level: precise academic vocabulary, varied grammatical structures, natural collocations. Each rewrite must preserve the original meaning. Return strictly JSON: {"rewrites": ["...", "...", "..."]}',
          },
          { role: 'user', content: body.text },
        ],
        temperature: 0.4,
        validator: (raw: unknown) => {
          const parsed = raw as { rewrites?: unknown };
          const rewrites = Array.isArray(parsed?.rewrites)
            ? parsed.rewrites
                .filter(
                  (r): r is string =>
                    typeof r === 'string' && r.trim().length > 0,
                )
                .slice(0, 3)
            : [];
          if (rewrites.length === 0) {
            throw new Error('Model returned no usable rewrites');
          }
          return { rewrites };
        },
      })
      .catch((error: unknown) => {
        // Provider outages, rotating-token 401s and exhausted quota are
        // infrastructure failures — surface them as 503, never a bare 500.
        const message = error instanceof Error ? error.message : String(error);
        if (isInfraFailure(message)) {
          throw new ServiceUnavailableException(
            'The AI service is temporarily unavailable. Please try again shortly.',
          );
        }
        throw error;
      });

    return { rewrites: data.rewrites, requestedBy: req.user.sub };
  }

  /**
   * COACH agent: generates a personalised IELTS study plan from the caller's
   * profile (target band, exam date, weakest skill, daily commitment) and
   * latest achieved bands. The client reviews it and saves via PATCH /users/me
   * — the user always stays in control of their plan.
   */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('study-plan')
  async generateStudyPlan(
    @Body(new ZodValidationPipe(z.object({}).passthrough().optional()))
    _body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!req?.user?.sub)
      throw new UnauthorizedException('User context missing');
    const userId = req.user.sub;

    const [user, bandsResult] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          targetBand: true,
          examDate: true,
          moduleType: true,
          dailyCommitmentMinutes: true,
          weakestSkill: true,
        },
      }),
      this.prisma.score
        .findMany({
          where: { attempt: { userId } },
          orderBy: { createdAt: 'desc' },
          take: 40,
          select: { skill: true, bandScore: true },
        })
        .then((scores) => {
          const latest = new Map<string, number>();
          for (const s of scores) {
            if (!latest.has(s.skill)) latest.set(s.skill, s.bandScore);
          }
          return Object.fromEntries(latest);
        }),
    ]);
    if (!user) throw new UnauthorizedException('User not found');

    const daysUntilExam = user.examDate
      ? Math.max(
          1,
          Math.ceil(
            (user.examDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
          ),
        )
      : null;

    const context = [
      `Target band: ${user.targetBand ?? 'not set (assume 7.0)'}`,
      `Module: ${user.moduleType}`,
      user.examDate
        ? `Exam in ${daysUntilExam} days`
        : 'No exam date set — assume an 14-day preparation window',
      `Daily study time: ${user.dailyCommitmentMinutes ?? 45} minutes`,
      `Self-reported weakest skill: ${user.weakestSkill ?? 'unknown'}`,
      `Latest achieved bands: ${
        Object.keys(bandsResult).length > 0
          ? JSON.stringify(bandsResult)
          : 'none yet (new student)'
      }`,
    ].join('\n');

    const { data } = await this.aiService
      .executeStructuredTask<z.infer<typeof generatedPlanSchema>>({
        taskType: 'COACH_ADVISOR',
        responseFormat: { type: 'json_object' },
        temperature: 0.4,
        // Keep output small enough to finish inside Cloudflare's 100s edge
        // limit: a long 8-14 milestone prompt overflowed 3000 tokens and the
        // reasoning model spent >100s retrying malformed/truncated JSON.
        maxTokens: 4000,
        timeoutMs: 90_000,
        messages: [
          {
            role: 'system',
            content:
              'You are an expert IELTS study-plan coach. Design a realistic, progressive plan. Return strictly one JSON object: {"summary": "<2-3 sentence strategy summary>", "milestones": [{"day": <sequential day starting at 1>, "title": "<short imperative task>", "skill": "LISTENING|READING|WRITING|SPEAKING|MOCK", "durationMinutes": <5-120, must fit the student\'s daily time>, "taskDetails": "<one short sentence with a concrete IELTS activity>"}]}. Rules: prioritise the weakest skill; alternate skills across days; day numbers start at 1 with no gaps; produce exactly 5 to 7 milestones; keep each taskDetails under 20 words so the JSON stays compact and complete.',
          },
          { role: 'user', content: `Student profile:\n${context}` },
        ],
        validator: (raw) => generatedPlanSchema.parse(raw),
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (isInfraFailure(message)) {
          throw new ServiceUnavailableException(
            'The AI coach is temporarily unavailable. Your preferences are saved — try generating again shortly.',
          );
        }
        throw error;
      });

    const milestones = data.milestones.map((m, index) => ({
      id: `ai-${Date.now()}-${index}`,
      day: m.day,
      title: m.title,
      skill: m.skill,
      durationMinutes: m.durationMinutes,
      isCompleted: false,
      taskDetails: m.taskDetails,
    }));
    return { summary: data.summary, milestones, generatedBy: 'COACH_GLM' };
  }
}
