import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Set BOOTSTRAP_ADMIN_EMAIL to a valid administrator email.');
  }
  if (!password || password.length < 16) {
    throw new Error('Set BOOTSTRAP_ADMIN_PASSWORD to a unique password of at least 16 characters.');
  }
  if (!name || name.length < 2 || name.length > 80) {
    throw new Error('Set BOOTSTRAP_ADMIN_NAME to the administrator name (2-80 characters).');
  }

  const administrator = await prisma.$transaction(async (tx) => {
    if ((await tx.user.count()) !== 0) {
      throw new Error('Administrator bootstrap only runs when the database has no user accounts.');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    return tx.user.create({
      data: {
        email,
        name,
        passwordHash,
        role: 'ADMIN',
        membership: 'FREE',
        isVip: false,
        wallet: { create: { balance: 0 } },
      },
      select: { id: true, email: true },
    });
  });

  console.log(`Initial administrator created: ${administrator.email}`);
}

main()
  .catch((error: unknown) => {
    console.error('Administrator bootstrap failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
