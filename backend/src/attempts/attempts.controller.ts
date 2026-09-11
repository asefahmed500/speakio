import {
  Body,
  Controller,
  Get,
  Inject,
  Logger,
  Param,
  Patch,
  Post,
  UseGuards,
  Req,
  UnauthorizedException,
  forwardRef,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { AttemptsService } from './attempts.service';
import { CertificatesService } from '../certificates/certificates.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { AuthenticatedRequest } from '../auth/authenticated-request';

// Text answers are short; speaking answers arrive as base64 data URLs sized
// for the service's 6MB binary audio budget (×4/3 encoding + URL prefix).
const MAX_TEXT_ANSWER_CHARS = 200_000;
const MAX_AUDIO_DATA_URL_CHARS = 8_400_000;

const answerValueSchema = z.string().superRefine((value, ctx) => {
  const isAudio = value.startsWith('data:audio');
  const cap = isAudio ? MAX_AUDIO_DATA_URL_CHARS : MAX_TEXT_ANSWER_CHARS;
  if (value.length > cap) {
    ctx.addIssue({
      code: z.ZodIssueCode.too_big,
      origin: 'string',
      type: 'string',
      inclusive: true,
      maximum: cap,
      message: isAudio
        ? 'Recording exceeds the 6MB limit. Please record a shorter response.'
        : 'Answer exceeds the maximum allowed length.',
    });
  }
});

const answersSchema = z.record(z.string(), answerValueSchema);

const startSchema = z.object({
  testSetId: z.string().min(1).max(100),
});

const autosaveSchema = z.object({
  answers: answersSchema,
  timeRemainingSeconds: z.number().int().min(0).max(21_600).optional(),
});

const submitSchema = z.object({
  answers: answersSchema,
  timeRemainingSeconds: z.number().int().min(0).max(21_600).optional(),
});

@Controller('attempts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AttemptsController {
  private readonly logger = new Logger(AttemptsController.name);

  constructor(
    private readonly attemptsService: AttemptsService,
    @Inject(forwardRef(() => CertificatesService))
    private readonly certificatesService: CertificatesService,
  ) {}

  private userId(req: AuthenticatedRequest): string {
    if (!req?.user?.sub)
      throw new UnauthorizedException('User context missing');
    return req.user.sub;
  }

  @Post()
  async start(
    @Body(new ZodValidationPipe(startSchema)) body: z.infer<typeof startSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.attemptsService.start(this.userId(req), body.testSetId);
  }

  @Get()
  async listMine(@Req() req: AuthenticatedRequest) {
    return this.attemptsService.listMine(this.userId(req));
  }

  @Get(':id')
  async getResult(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.attemptsService.getResult(this.userId(req), req.user.role, id);
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Patch(':id')
  async autosave(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(autosaveSchema))
    body: z.infer<typeof autosaveSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.attemptsService.autosave(
      this.userId(req),
      id,
      body.answers,
      body.timeRemainingSeconds,
    );
    return { saved: true };
  }

  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @Post(':id/submit')
  async submit(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(submitSchema))
    body: z.infer<typeof submitSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    const result = await this.attemptsService.submit(
      this.userId(req),
      id,
      body.answers,
      body.timeRemainingSeconds,
    );
    // Milestone hook: the moment any skill completes, the backend (never the
    // client) decides whether all four are done and issues the certificate.
    // Fire-and-forget — issuance must never block or fail the submission.
    void this.certificatesService
      .issue(this.userId(req))
      .catch((error: unknown) => {
        // Silent swallowing made issuance failures invisible; log them so
        // missing certificates can be diagnosed.
        this.logger.error(
          `Background certificate issuance failed for user ${this.userId(req)}: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    return result;
  }

  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post(':id/rescore')
  async rescore(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.attemptsService.rescore(this.userId(req), id);
  }
}
