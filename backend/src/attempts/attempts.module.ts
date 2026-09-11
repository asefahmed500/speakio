import { Module, forwardRef } from '@nestjs/common';
import { AttemptsController } from './attempts.controller';
import { AttemptsService } from './attempts.service';
import { AgentsModule } from '../agents/agents.module';
import { TestsModule } from '../tests/tests.module';
import { CertificatesModule } from '../certificates/certificates.module';

@Module({
  imports: [AgentsModule, TestsModule, forwardRef(() => CertificatesModule)],
  controllers: [AttemptsController],
  providers: [AttemptsService],
  exports: [AttemptsService],
})
export class AttemptsModule {}
