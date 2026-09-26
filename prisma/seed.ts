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
  } else {
    assertSeedPasswordPolicy(password, email);
    // Empty update: an existing admin (possibly with MFA enabled) is never overwritten.
    // The account is born verified: there is no self-verify flow for a seeded
    // bootstrap account, and login requires a verified email.
    await prisma.user.upsert({
      where: { email },
      create: {
        email,
        passwordHash: await bcrypt.hash(password, 10),
        role: 'ADMIN',
        emailVerifiedAt: new Date(),
      },
      update: {},
    });
    console.info(`Seeded admin ${email}`);
  }

  if (process.env.SEED_DEMO_DATA !== 'true') {
    console.info('SEED_DEMO_DATA not enabled; skipping demo dataset');
    return;
  }
  await seedDemoDataset();
}

/** 8-char invite codes from the same unambiguous alphabet the students module uses. */
function generateInviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

function timeOnly(hour: number, minute: number): Date {
  return new Date(Date.UTC(1970, 0, 1, hour, minute));
}

function daysFromNow(days: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

/**
 * Simulated dataset for the thesis demo (plan risk register: "seed via
 * app_settings + admin, nothing hardcoded" applies to real club data; this
 * dataset exists only so a fresh deployment can demonstrate every flow).
 * Gated behind SEED_DEMO_DATA=true and all-or-nothing idempotent: the marker
 * account below skips the whole block once it exists.
 */
async function seedDemoDataset(): Promise<void> {
  const DEMO_PASSWORD = 'Demo#2026';
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const marker = await prisma.user.findUnique({ where: { email: 'demo-instructor@example.com' } });
  if (marker !== null) {
    console.info('Demo dataset already seeded; skipping');
    return;
  }

  const admin = await prisma.user.upsert({
    where: { email: 'demo-admin@example.com' },
    create: {
      email: 'demo-admin@example.com',
      passwordHash,
      role: 'ADMIN',
      emailVerifiedAt: new Date(),
    },
    update: {},
  });
  const instructor = await prisma.user.create({
    data: {
      email: 'demo-instructor@example.com',
      passwordHash,
      role: 'INSTRUCTOR',
      emailVerifiedAt: new Date(),
    },
  });
  const parent = await prisma.user.create({
    data: {
      email: 'demo-parent@example.com',
      passwordHash,
      role: 'PARENT',
      emailVerifiedAt: new Date(),
    },
  });
  const adultStudent = await prisma.user.create({
    data: {
      email: 'demo-student@example.com',
      passwordHash,
      role: 'STUDENT',
      emailVerifiedAt: new Date(),
    },
  });
  console.info(
    'Seeded demo accounts (password Demo#2026): demo-admin/demo-instructor/demo-parent/demo-student @example.com',
  );

  const ranks = await prisma.beltRank.findMany({ orderBy: { orderIndex: 'asc' } });
  const lam1 = ranks.find((r) => r.code === 'LAM_1');
  const lam2 = ranks.find((r) => r.code === 'LAM_2');
  const vang1 = ranks.find((r) => r.code === 'VANG_1');

  const adultProfile = await prisma.studentProfile.create({
    data: {
      userId: adultStudent.id,
      fullName: 'Le Van Tuan',
      dob: new Date('2006-03-12'),
      gender: 'MALE',
      phone: '0901110001',
      address: '12 Nguyen Trai, Q1',
      medicalNotes: 'None',
      inviteCode: generateInviteCode(),
      status: 'ACTIVE',
      currentBeltRankId: lam2?.id,
    },
  });
  const minorB = await prisma.studentProfile.create({
    data: {
      fullName: 'Nguyen Thi Bong',
      dob: new Date('2014-07-20'),
      gender: 'FEMALE',
      phone: '0902220002',
      emergencyContactName: 'Nguyen Van Ba',
      emergencyContactPhone: '0902220003',
      medicalNotes: 'Allergic to peanuts',
      inviteCode: generateInviteCode(),
      status: 'ACTIVE',
      currentBeltRankId: lam1?.id,
    },
  });
  const minorC = await prisma.studentProfile.create({
    data: {
      fullName: 'Tran Van Cuong',
      dob: new Date('2012-11-05'),
      gender: 'MALE',
      phone: '0903330003',
      emergencyContactName: 'Tran Thi D',
      emergencyContactPhone: '0903330004',
      inviteCode: generateInviteCode(),
      status: 'ACTIVE',
    },
  });
  await prisma.parentStudentLink.createMany({
    data: [
      { parentUserId: parent.id, studentId: minorB.id, verified: true, verifiedByUserId: admin.id },
      { parentUserId: parent.id, studentId: minorC.id, verified: true, verifiedByUserId: admin.id },
    ],
  });

  const basicClass = await prisma.class.create({
    data: {
      name: 'Lop Co ban (Co ban - nang cao 1)',
      instructorId: instructor.id,
      location: 'San nha van hoa',
      capacity: 30,
      status: 'ACTIVE',
      schedules: {
        create: [
          {
            weekday: 1,
            startTime: timeOnly(18, 0),
            endTime: timeOnly(19, 30),
            effectiveFrom: daysFromNow(-30),
          },
          {
            weekday: 3,
            startTime: timeOnly(18, 0),
            endTime: timeOnly(19, 30),
            effectiveFrom: daysFromNow(-30),
          },
          {
            weekday: 5,
            startTime: timeOnly(18, 0),
            endTime: timeOnly(19, 30),
            effectiveFrom: daysFromNow(-30),
          },
        ],
      },
    },
  });
  const advancedClass = await prisma.class.create({
    data: {
      name: 'Lop Nang cao',
      instructorId: instructor.id,
      location: 'San nha van hoa',
      capacity: 20,
      status: 'ACTIVE',
      schedules: {
        create: [
          {
            weekday: 2,
            startTime: timeOnly(19, 0),
            endTime: timeOnly(20, 30),
            effectiveFrom: daysFromNow(-30),
          },
          {
            weekday: 4,
            startTime: timeOnly(19, 0),
            endTime: timeOnly(20, 30),
            effectiveFrom: daysFromNow(-30),
          },
        ],
      },
    },
  });
  await prisma.enrollment.createMany({
    data: [
      { studentId: adultProfile.id, classId: basicClass.id },
      { studentId: minorB.id, classId: basicClass.id },
      { studentId: minorC.id, classId: advancedClass.id },
    ],
  });

  const now = new Date();
  const thisMonth = now.getUTCMonth() + 1;
  const thisYear = now.getUTCFullYear();
  const session1 = await prisma.attendanceSession.create({
    data: {
      classId: basicClass.id,
      sessionDate: daysFromNow(-7),
      instructorId: instructor.id,
      topic: 'Don son, tan the don thang',
    },
  });
  const session2 = await prisma.attendanceSession.create({
    data: {
      classId: basicClass.id,
      sessionDate: daysFromNow(-3),
      instructorId: instructor.id,
      topic: 'Dam thang, quet chan',
    },
  });
  await prisma.attendanceRecord.createMany({
    data: [
      {
        attendanceSessionId: session1.id,
        studentId: adultProfile.id,
        status: 'PRESENT',
        recordedBy: instructor.id,
      },
      {
        attendanceSessionId: session1.id,
        studentId: minorB.id,
        status: 'PRESENT',
        recordedBy: instructor.id,
      },
      {
        attendanceSessionId: session2.id,
        studentId: adultProfile.id,
        status: 'LATE',
        recordedBy: instructor.id,
      },
      {
        attendanceSessionId: session2.id,
        studentId: minorB.id,
        status: 'ABSENT',
        recordedBy: instructor.id,
      },
    ],
  });

  const rateKey = `${thisYear}-${String(thisMonth).padStart(2, '0')}`;
  // The base bootstrap above already created both keys with empty values, so
  // these upserts must WRITE on update too — a no-op update left the demo
  // dataset without rates or a usable receiving account (found by UAT).
  const demoRates = { [basicClass.id]: 400000, [advancedClass.id]: 500000 };
  await prisma.appSetting.upsert({
    where: { key: 'tuition_rates' },
    create: {
      key: 'tuition_rates',
      value: demoRates,
      updatedBy: admin.id,
    },
    update: { value: demoRates, updatedBy: admin.id },
  });
  const demoBankAccount = {
    owner_type: 'BUSINESS',
    bin: '970422',
    number: '9012345678901',
    name: 'VOVINAM DEMO CLUB',
  };
  await prisma.appSetting.upsert({
    where: { key: 'bank_account' },
    create: {
      key: 'bank_account',
      value: demoBankAccount,
      updatedBy: admin.id,
    },
    update: { value: demoBankAccount, updatedBy: admin.id },
  });
  await prisma.invoice.createMany({
    data: [
      {
        invoiceNo: `INV-${thisYear}-D001`,
        studentId: adultProfile.id,
        type: 'TUITION',
        periodMonth: thisMonth,
        periodYear: thisYear,
        subtotal: 400000,
        discount: 0,
        total: 400000,
        status: 'UNPAID',
        dueDate: daysFromNow(10),
        createdBy: admin.id,
      },
      {
        invoiceNo: `INV-${thisYear}-D002`,
        studentId: minorB.id,
        type: 'TUITION',
        periodMonth: thisMonth,
        periodYear: thisYear,
        subtotal: 400000,
        discount: 0,
        total: 400000,
        status: 'PAID',
        dueDate: daysFromNow(10),
        createdBy: admin.id,
      },
    ],
  });
  const paidInvoice = await prisma.invoice.findUniqueOrThrow({
    where: { invoiceNo: `INV-${thisYear}-D002` },
  });
  await prisma.paymentTransaction.create({
    data: {
      invoiceId: paidInvoice.id,
      orderRef: 'VVDEMO001',
      gateway: 'CASH',
      amount: 400000,
      status: 'SUCCESS',
      paidAt: new Date(),
      recordedBy: admin.id,
      note: 'Demo cash payment',
    },
  });
  console.info(`Seeded demo invoices for ${rateKey} (one UNPAID, one PAID via CASH)`);

  const exam = await prisma.beltExam.create({
    data: {
      code: `EXAM-${thisYear}-D1`,
      title: `Ky thi thang dai dot ${thisMonth}/${thisYear}`,
      examDate: daysFromNow(21),
      location: 'San nha van hoa',
      targetRankId: vang1?.id ?? 1,
      feeAmount: 300000,
      capacity: 20,
      registrationDeadline: daysFromNow(14),
      status: 'OPEN',
    },
  });
  await prisma.examRegistration.create({
    data: {
      examId: exam.id,
      studentId: adultProfile.id,
      currentRankId: lam2?.id,
      targetRankId: vang1?.id ?? 1,
      status: 'PENDING_PAYMENT',
    },
  });

  await prisma.studentEvaluation.create({
    data: {
      studentId: adultProfile.id,
      authorUserId: instructor.id,
      classId: basicClass.id,
      periodMonth: thisMonth,
      periodYear: thisYear,
      rating: 8,
      comment: 'Tien bo ro rat ve ky thuat don thang; can ren them the luc.',
    },
  });
  await prisma.leaveRequest.create({
    data: {
      studentId: minorB.id,
      classId: basicClass.id,
      requestedByUserId: parent.id,
      sessionDate: daysFromNow(5),
      reason: 'Ho dem di kham bac si',
      status: 'PENDING',
    },
  });
  await prisma.announcement.createMany({
    data: [
      {
        title: 'Thong bao: lich thi thang dai dot nay',
        body: 'Ky thi se dien ra vao chu nhat gan nhat tai san nha van hoa. Vui long co mat dung gio.',
        audience: 'ALL',
        createdBy: admin.id,
      },
      {
        title: 'Lop co ban: doi dong phuc tap luyen',
        body: 'Buoi sau lop co ban tap luyen voi dong phuc. Don quen di hoc.',
        audience: 'CLASS',
        classId: basicClass.id,
        createdBy: instructor.id,
      },
    ],
  });
  await prisma.discountCode.create({
    data: {
      code: 'CHAOBAN',
      description: 'Giam 10% cho thang dau',
      percentOff: 10,
      validFrom: daysFromNow(-1),
      validUntil: daysFromNow(60),
    },
  });
  console.info(
    'Seeded demo classes, attendance, invoices, exam, evaluation, leave request, announcements, discount code',
  );
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
