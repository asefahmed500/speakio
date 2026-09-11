import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { VocabularyService, vocabularyItemSchema } from './vocabulary.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../auth/authenticated-request';

@Controller('vocabulary')
@UseGuards(JwtAuthGuard, RolesGuard)
export class VocabularyController {
  constructor(private readonly vocabularyService: VocabularyService) {}

  @Get()
  async list(@Req() req: AuthenticatedRequest) {
    return this.vocabularyService.list(this.uid(req));
  }

  @Post()
  async create(
    @Body(new ZodValidationPipe(vocabularyItemSchema))
    body: z.infer<typeof vocabularyItemSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.vocabularyService.create(this.uid(req), body);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.vocabularyService.remove(this.uid(req), id);
  }

  private uid(req: AuthenticatedRequest): string {
    if (!req?.user?.sub)
      throw new UnauthorizedException('User context missing');
    return req.user.sub;
  }
}
