/**
 * Bootstrap the first ADMIN from environment variables — no hardcoded credentials.
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=<strong> npm run create-admin
 * Safe to re-run: updates the password/role of that exact email only.
 */
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD before running');
  }
  if (password.length < 12) {
    throw new Error('ADMIN_PASSWORD must be at least 12 characters');
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
    console.error(error.message);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
