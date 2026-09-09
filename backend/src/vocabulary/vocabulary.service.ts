import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { z } from 'zod';

export const vocabularyItemSchema = z.object({
  word: z.string().trim().min(1, 'Word is required').max(80),
  phonetic: z.string().trim().max(120).optional().nullable(),
  partOfSpeech: z.enum(['verb', 'noun', 'adjective', 'adverb', 'collocation', 'idiom']),
  definition: z.string().trim().min(1, 'Definition is required').max(1000),
  bandTarget: z.number().refine((v) => v >= 6 && v <= 9 && (v * 2) % 1 === 0, {
    message: 'Band target must be between 6.0 and 9.0 in 0.5 steps',
  }),
  topic: z.string().trim().min(1).max(60),
  collocations: z.array(z.string().trim().min(1).max(120)).max(20),
  synonyms: z.array(z.string().trim().min(1).max(80)).max(20),
  exampleSentence: z.string().trim().min(1, 'Example sentence is required').max(1000),
});

@Injectable()
export class VocabularyService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    return this.prisma.vocabularyItem.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(userId: string, body: z.infer<typeof vocabularyItemSchema>) {
    return this.prisma.vocabularyItem.create({
      data: {
        userId,
        word: body.word,
        phonetic: body.phonetic ?? null,
        partOfSpeech: body.partOfSpeech,
        definition: body.definition,
        bandTarget: body.bandTarget,
        topic: body.topic,
        collocations: body.collocations,
        synonyms: body.synonyms,
        exampleSentence: body.exampleSentence,
      },
    });
  }

  async remove(userId: string, id: string) {
    const item = await this.prisma.vocabularyItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Vocabulary item not found');
    if (item.userId !== userId) throw new ForbiddenException('You do not own this vocabulary item');
    await this.prisma.vocabularyItem.delete({ where: { id } });
    return { deleted: true };
  }
}
