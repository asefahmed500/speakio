import { Module, forwardRef } from '@nestjs/common';
import { CertificatesController } from './certificates.controller';
import { CertificatesService } from './certificates.service';
import { AttemptsModule } from '../attempts/attempts.module';

@Module({
  imports: [forwardRef(() => AttemptsModule)],
  controllers: [CertificatesController],
  providers: [CertificatesService],
  exports: [CertificatesService],
})
export class CertificatesModule {}
