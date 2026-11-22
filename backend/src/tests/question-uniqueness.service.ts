import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { Question } from '@prisma/client';

/** Cross-system question uniqueness + per-user adaptive selection. */
@Injectable()
export class QuestionUniquenessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Normalized fingerprint for similarity detection: two prompts that differ
   * only in case, punctuation or extra whitespace map to the same fingerprint,
   * so "What is cloud computing?" and "what is cloud computing." collide.
   */
  fingerprint(prompt: string): string {
    const normalized = prompt
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return createHash('sha1').update(normalized).digest('hex').slice(0, 16);
  }

  /**
   * Selects up to `take` questions for a user:
   * 1. never shown to this user (UserQuestionHistory)
   * 2. no fingerprint the user has already seen (semantic dedup)
   * 3. pool exhausted -> least-recently-seen fallback so an attempt is never empty
   */
  async selectForUser(
    userId: string,
    questions: Question[],
    take: number,
  ): Promise<Question[]> {
    if (questions.length <= take) return questions;

    const history = await this.prisma.userQuestionHistory.findMany({
      where: { userId, questionId: { in: questions.map((q) => q.id) } },
      orderBy: { shownAt: 'desc' },
    });
    const seenIds = new Set(history.map((h) => h.questionId));

    const allHistory = await this.prisma.userQuestionHistory.findMany({
      where: { userId },
      select: { questionId: true },
    });
    const seenQuestionIds = allHistory.map((h) => h.questionId);
    const seenPrompts =
      seenQuestionIds.length > 0
        ? await this.prisma.question.findMany({
            where: { id: { in: seenQuestionIds } },
            select: { prompt: true },
          })
        : [];
    const seenFingerprints = new Set(
      seenPrompts.map((p) => this.fingerprint(p.prompt)),
    );

    const fresh = questions.filter(
      (q) =>
        !seenIds.has(q.id) && !seenFingerprints.has(this.fingerprint(q.prompt)),
    );
    const freshShuffled = this.shuffle(fresh);
    if (freshShuffled.length >= take) {
      // Guarantee: while unseen questions remain, a user is never served ones
      // they have already answered — the previous code shuffled seen questions
      // back into the pick and broke this contract.
      return freshShuffled.slice(0, take);
    }

    // Pool exhausted: fill the remainder with the least-recently-seen first.
    // Sort by the recorded shownAt timestamp (oldest first), not by the
    // arbitrary orderIndex of the source pool.
    const lastShown = new Map(history.map((h) => [h.questionId, h.shownAt.getTime()]));
    const rest = questions
      .filter((q) => !fresh.includes(q))
      .sort(
        (a, b) =>
          (lastShown.get(a.id) ?? 0) - (lastShown.get(b.id) ?? 0),
      );
    return [...freshShuffled, ...rest].slice(0, take);
  }

  shuffle<T>(items: T[]): T[] {
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  async recordShown(userId: string, questionIds: string[]): Promise<void> {
    if (questionIds.length === 0) return;
    await this.prisma.userQuestionHistory.createMany({
      data: questionIds.map((questionId) => ({ userId, questionId })),
      skipDuplicates: true,
    });
  }
}
