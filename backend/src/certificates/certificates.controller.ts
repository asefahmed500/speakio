import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  UseGuards,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from 'zod';
import { CertificatesService } from './certificates.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

const revokeSchema = z.object({
  reason: z.string().trim().max(300).optional(),
});

@Controller('certificates')
export class CertificatesController {
  constructor(private readonly certificatesService: CertificatesService) {}

  private uid(req: any): string {
    if (!req?.user?.sub) throw new UnauthorizedException('User context missing');
    return req.user.sub;
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get()
  async listMine(@Req() req: any) {
    return this.certificatesService.listMine(this.uid(req));
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post()
  async issue(@Req() req: any) {
    return this.certificatesService.issue(this.uid(req));
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(':id/revoke')
  async revoke(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(revokeSchema)) body: z.infer<typeof revokeSchema>,
    @Req() req: any,
  ) {
    return this.certificatesService.revoke(this.uid(req), id, body.reason);
  }

  /** Public verification endpoint — no authentication. */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('verify/:code')
  async verify(@Param('code') code: string, @Res({ passthrough: true }) res: Response) {
    const result = await this.certificatesService.verifyByCode(code);
    if (!result) {
      res.status(404);
      return { status: 'NOT_FOUND', message: 'No certificate matches this verification code' };
    }
    return result;
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get(':id/pdf')
  async downloadPdf(@Param('id') id: string, @Req() req: any, @Res() res: Response) {
    const pdf = await this.certificatesService.generatePdf(this.uid(req), id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="speakio-certificate.pdf"');
    res.setHeader('Content-Length', pdf.length);
    res.end(pdf);
  }
}
