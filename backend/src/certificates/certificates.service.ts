import {
  Injectable,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AttemptsService } from '../attempts/attempts.service';
import { overallBandOf } from '../common/band.utils';
import { SkillType } from '@prisma/client';

const REQUIRED_SKILLS = [
  SkillType.LISTENING,
  SkillType.READING,
  SkillType.WRITING,
  SkillType.SPEAKING,
];

@Injectable()
export class CertificatesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => AttemptsService))
    private readonly attemptsService: AttemptsService,
  ) {}

  async listMine(userId: string) {
    return this.prisma.certificate.findMany({
      where: { userId },
      orderBy: { issuedAt: 'desc' },
    });
  }

  /**
   * Single source of truth for certificate progress. The database is the only
   * authority — the frontend renders this, never decides it.
   */
  async eligibility(userId: string) {
    const { perSkill } = await this.attemptsService.latestBandsPerSkill(userId);
    const skills = REQUIRED_SKILLS.map((skill) => ({
      skill,
      completed: typeof perSkill[skill] === 'number',
      band: perSkill[skill] ?? null,
    }));
    const completedCount = skills.filter((s) => s.completed).length;
    const certificate = await this.prisma.certificate.findFirst({
      where: { userId, status: 'ACTIVE' },
    });
    const missing = skills.filter((s) => !s.completed).map((s) => s.skill);
    return {
      eligible: missing.length === 0,
      completedCount,
      requiredCount: REQUIRED_SKILLS.length,
      skills,
      missingSkills: missing,
      certificate,
    };
  }

  /**
   * Issues a participation certificate. Requires a completed score in each of
   * the four skills. Idempotent: returns the existing ACTIVE certificate.
   *
   * Concurrency: a Postgres advisory lock (keyed on the user id) serializes
   * issuance per user, closing the check-then-act race that could otherwise
   * mint two simultaneously-valid certificates.
   */
  async issue(userId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;

      const active = await tx.certificate.findFirst({
        where: { userId, status: 'ACTIVE' },
      });
      if (active) return active;

      const { perSkill } =
        await this.attemptsService.latestBandsPerSkill(userId);
      const missing = REQUIRED_SKILLS.filter(
        (s) => typeof perSkill[s] !== 'number',
      );
      if (missing.length > 0) {
        throw new BadRequestException(
          `Certificate requires a completed score in all four skills. Missing: ${missing.join(', ')}`,
        );
      }
      const overall = overallBandOf(
        REQUIRED_SKILLS.map((s) => perSkill[s] as number),
      );

      const year = new Date().getFullYear();
      // Number and code are independent secrets: knowing the public
      // certificate number must not reveal the verification code.
      const numberToken = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const codeToken = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const certificateNumber = `SPK-${year}-${numberToken}-B${String(overall).replace('.', '')}`;
      const verificationCode = `SPK-VERIFY-${codeToken}`;

      return tx.certificate.create({
        data: {
          userId,
          certificateNumber,
          overallBand: overall,
          verificationCode,
          status: 'ACTIVE',
        },
      });
    });
  }

  /**
   * Revokes a certificate. Holders may revoke their own; ADMIN/SUPER_ADMIN
   * may revoke any certificate (moderation), with a required reason.
   */
  async revoke(
    userId: string,
    certificateId: string,
    reason?: string,
    options?: { adminOverride?: boolean },
  ) {
    const cert = await this.prisma.certificate.findUnique({
      where: { id: certificateId },
    });
    if (!cert) throw new NotFoundException('Certificate not found');
    const isOwner = cert.userId === userId;
    if (!isOwner && !options?.adminOverride) {
      throw new ForbiddenException('You do not own this certificate');
    }
    if (cert.status === 'REVOKED') return cert;
    return this.prisma.certificate.update({
      where: { id: certificateId },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
        revocationReason:
          reason ??
          (isOwner ? 'Revoked by holder' : 'Revoked by administrator'),
      },
    });
  }

  /** Public verification — safe fields only. */
  async verifyByCode(code: string) {
    const cert = await this.prisma.certificate.findFirst({
      where: {
        OR: [{ verificationCode: code }, { certificateNumber: code }],
      },
      include: { user: { select: { name: true } } },
    });
    if (!cert) return null;
    return {
      status: cert.status === 'ACTIVE' ? 'ACTIVE' : 'REVOKED',
      certificateNumber: cert.certificateNumber,
      candidateName: cert.user.name,
      overallBand: cert.overallBand,
      issuedAt: cert.issuedAt,
      revokedAt: cert.revokedAt,
    };
  }

  async getOwnedCertificate(userId: string, certificateId: string) {
    const cert = await this.prisma.certificate.findUnique({
      where: { id: certificateId },
      include: { user: { select: { name: true } } },
    });
    if (!cert) throw new NotFoundException('Certificate not found');
    if (cert.userId !== userId)
      throw new ForbiddenException('You do not own this certificate');
    return cert;
  }

  async generatePdf(userId: string, certificateId: string): Promise<Buffer> {
    const cert = await this.getOwnedCertificate(userId, certificateId);
    if (cert.status !== 'ACTIVE') {
      throw new ConflictException(
        'PDF download is unavailable for revoked certificates',
      );
    }

    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 60,
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    // The 'error' handler is mandatory: without it a stream failure (bad
    // glyph, write error) leaves `done` pending forever and the HTTP request
    // hangs until the client times out.
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err: Error) => reject(err));
    });

    const width = doc.page.width;

    doc
      .rect(24, 24, width - 48, doc.page.height - 48)
      .lineWidth(2)
      .strokeColor('#0052CC')
      .stroke();
    doc
      .rect(32, 32, width - 64, doc.page.height - 64)
      .lineWidth(0.75)
      .strokeColor('#EDEDEA')
      .stroke();

    doc.moveDown(2);
    doc
      .font('Helvetica')
      .fontSize(11)
      .fillColor('#737373')
      .text('SPEAKIO ACADEMIC — ENGLISH PROFICIENCY PLATFORM', {
        align: 'center',
      });

    doc.moveDown(1.5);
    doc
      .font('Helvetica-Bold')
      .fontSize(38)
      .fillColor('#111111')
      .text('Certificate of Achievement', {
        align: 'center',
      });

    doc.moveDown(0.8);
    doc
      .font('Helvetica')
      .fontSize(12)
      .fillColor('#525252')
      .text('This certifies that', { align: 'center' });

    doc.moveDown(0.6);
    doc
      .font('Helvetica-Bold')
      .fontSize(30)
      .fillColor('#111111')
      .text(cert.user.name, { align: 'center' });

    doc.moveDown(0.6);
    doc.font('Helvetica').fontSize(12).fillColor('#525252');
    doc.text(
      'has successfully completed the Speakio IELTS preparation programme',
      { align: 'center' },
    );
    doc.text(`with a verified overall band score of`, { align: 'center' });

    doc.moveDown(0.4);
    doc
      .font('Helvetica-Bold')
      .fontSize(44)
      .fillColor('#0052CC')
      .text(cert.overallBand.toFixed(1), {
        align: 'center',
      });

    doc.moveDown(1);
    const issue = new Date(cert.issuedAt);
    doc.font('Helvetica').fontSize(10).fillColor('#525252');
    const colLeft = 90;
    const colRight = width - 90;
    doc.text(`Certificate No: ${cert.certificateNumber}`, colLeft, doc.y, {
      width: 300,
    });
    doc.text(
      `Verification Code: ${cert.verificationCode}`,
      colLeft,
      doc.y + 14,
      { width: 300 },
    );
    doc.text(
      `Issued: ${issue.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`,
      colRight - 300,
      doc.y - 28,
      {
        width: 300,
        align: 'right',
      },
    );
    doc.text(
      'Verify authenticity at speakio.app/verify',
      colRight - 300,
      doc.y + 14,
      { width: 300, align: 'right' },
    );

    doc.moveDown(2);
    doc
      .fontSize(8)
      .fillColor('#A3A3A3')
      .text(
        'This certificate is a record of participation in AI-assisted practice assessments with human examiner review. It is not an official IELTS test report.',
        90,
        doc.page.height - 100,
        { width: width - 180, align: 'center' },
      );

    doc.end();
    return done;
  }
}
