/**
 * One-shot removal of seeded demo records only. Targets fixed demo IDs/emails;
 * never touches users created through the public registration flow.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const certificate = await prisma.certificate.deleteMany({
    where: { id: 'SPK-2026-8891-B80' },
  });
  const attempt = await prisma.attempt.deleteMany({
    where: { id: 'att-student-demo-1' },
  });
  const users = await prisma.user.deleteMany({
    where: {
      email: {
        in: [
          'student@speakio.com',
          'examiner@speakio.com',
          'superadmin@speakio.com',
        ],
      },
    },
  });
  console.log(
    `Removed demo certificate: ${certificate.count}, demo attempt: ${attempt.count}, demo users: ${users.count}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
