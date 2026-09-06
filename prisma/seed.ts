import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { BeltRankGroup, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface SeedBeltRank {
  code: string;
  name: string;
  rankGroup: BeltRankGroup;
  orderIndex: number;
}

function buildBeltRanks(): SeedBeltRank[] {
  const groups = [
    { group: BeltRankGroup.LAM, levels: 3, name: 'Blue Belt' },
    { group: BeltRankGroup.VANG, levels: 3, name: 'Yellow Belt' },
    { group: BeltRankGroup.DO, levels: 6, name: 'Red Belt' },
    { group: BeltRankGroup.HUYEN, levels: 3, name: 'Black Belt' },
  ];
  const ranks: SeedBeltRank[] = [];
  let orderIndex = 1;
  for (const entry of groups) {
    for (let level = 1; level <= entry.levels; level += 1) {
      ranks.push({
        code: `${entry.group}_${level}`,
        name: `${entry.name} ${level}`,
        rankGroup: entry.group,
        orderIndex,
      });
      orderIndex += 1;
    }
  }
  return ranks;
}

function assertSeedPasswordPolicy(password: string, email: string): void {
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new Error('ADMIN_PASSWORD must be at least 8 characters and contain letters and digits');
  }
  const localPart = (email.split('@')[0] ?? '').toLowerCase();
  if (localPart.length >= 3 && password.toLowerCase().includes(localPart)) {
    throw new Error('ADMIN_PASSWORD must not contain the admin email local part');
  }
}

async function main(): Promise<void> {
  const beltRanks = buildBeltRanks();
  for (const rank of beltRanks) {
    // Empty update: club edits to seeded ranks are never overwritten by a re-seed.
    await prisma.beltRank.upsert({ where: { code: rank.code }, create: rank, update: {} });
  }
  console.info(`Seeded ${beltRanks.length} belt ranks`);

  // Club configuration defaults (plan sections 6, 7.7, 10). Real values are set by
  // the club master before go-live — the seed only guarantees the keys exist with
  // safe shapes. Empty update: admin edits are never overwritten by a re-seed.
  await prisma.appSetting.upsert({
    where: { key: 'tuition_rates' },
    // Per-class monthly VND rate; keyed by the classes.id UUID.
    create: { key: 'tuition_rates', value: {} },
    update: {},
  });
  await prisma.appSetting.upsert({
    where: { key: 'bank_account' },
    // The fee-collecting account MUST be in the legal entity's name (plan 10);
    // the QR flow refuses to run until bin/number/name are filled in.
    create: {
      key: 'bank_account',
      value: { owner_type: 'BUSINESS', bin: '', number: '', name: '' },
    },
    update: {},
  });
  console.info('Seeded app settings (tuition_rates, bank_account)');

  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (email === undefined || email === '' || password === undefined || password === '') {
    console.info('ADMIN_EMAIL / ADMIN_PASSWORD not set; skipping admin seed');
    return;
  }
  assertSeedPasswordPolicy(password, email);
  // Empty update: an existing admin (possibly with MFA enabled) is never overwritten.
  await prisma.user.upsert({
    where: { email },
    create: { email, passwordHash: await bcrypt.hash(password, 10), role: 'ADMIN' },
    update: {},
  });
  console.info(`Seeded admin ${email}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
