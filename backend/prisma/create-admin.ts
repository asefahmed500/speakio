/**
 * Bootstrap an ADMIN from environment variables — no hardcoded credentials.
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=<strong> npx ts-node prisma/create-admin.ts
 *
 * Safety: an existing NON-admin account is never silently promoted and its
 * password is never overwritten. Pass --force explicitly if that is intended.
 */
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const force = process.argv.includes('--force');
  if (!email || !password) {
    throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD before running');
  }
  if (password.length < 12) {
    throw new Error('ADMIN_PASSWORD must be at least 12 characters');
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && existing.role !== Role.ADMIN && !force) {
    throw new Error(
      `${email} already exists as ${existing.role}. Refusing to promote or reset its password. ` +
        'Use a fresh address, or pass --force if this promotion is intentional.'
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const admin = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: Role.ADMIN, status: 'ACTIVE' },
    create: { email, passwordHash, name: 'Administrator', role: Role.ADMIN },
    select: { id: true, email: true, role: true },
  });
  console.log(`Admin ready: ${admin.email} (${admin.role})`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
