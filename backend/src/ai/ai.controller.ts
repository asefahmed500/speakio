import { Body, Controller, Post, UseGuards, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { AiService } from './ai.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

const paraphraseSchema = z.object({
  text: z.string().trim().min(10, 'Provide at least a sentence to paraphrase').max(2000),
});

@Controller('ai')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('paraphrase')
  async paraphrase(
    @Body(new ZodValidationPipe(paraphraseSchema)) body: z.infer<typeof paraphraseSchema>,
    @Req() req: any,
  ) {
    const { data } = await this.aiService.executeStructuredTask<{ rewrites: string[] }>({
      taskType: 'COACH_ADVISOR',
      responseFormat: { type: 'json_object' },
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
          ? parsed.rewrites.filter((r): r is string => typeof r === 'string' && r.trim().length > 0).slice(0, 3)
          : [];
        if (rewrites.length === 0) {
          throw new Error('Model returned no usable rewrites');
        }
        return { rewrites };
      },
    });

    return { rewrites: data.rewrites, requestedBy: req.user.sub };
  }
}
