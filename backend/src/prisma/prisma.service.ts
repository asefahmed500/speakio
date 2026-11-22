import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    // Managed Postgres (db.prisma.io) transiently refuses connections even
    // when the TCP port is open. A bounded retry at startup avoids needless
    // crash-loops in production AND local dev, without hiding a genuinely
    // dead database — it still throws after the last attempt.
    const attempts = 8;
    for (let i = 1; i <= attempts; i++) {
      try {
        await this.$connect();
        return;
      } catch (error) {
        if (i === attempts) throw error;
        this.logger.warn(`Database connect failed (${i}/${attempts}) — retrying`);
        await new Promise((resolve) => setTimeout(resolve, 1_000 * i));
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
