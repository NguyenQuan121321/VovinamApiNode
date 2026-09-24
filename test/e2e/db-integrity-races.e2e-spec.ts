import type { INestApplication } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../../src/bootstrap';

/**
 * DB baseline §12 regression coverage (TASK-04): the three check-then-act
 * races (enrollment capacity, exam capacity, invite-code claim) are closed by
 * row locks / claim-first rotation, and a stale exam PASS can no longer
 * downgrade a belt (G-2 / DD-05). The race tests are deterministic after the
 * fix: the lock serializes the transactions, so exactly one writer wins.
 */
describe('Database integrity: capacity races, invite-code claim, rank regression (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const stamp = Date.now();
  const password = 'Str0ngPass';
  const users = {
    admin: `admin-${stamp}@example.com`,
    instructor: `instructor-${stamp}@example.com`,
    student1: `student1-${stamp}@example.com`,
    student2: `student2-${stamp}@example.com`,
    parent1: `parent1-${stamp}@example.com`,
    parent2: `parent2-${stamp}@example.com`,
  };
  let adminToken = '';
  let student1Token = '';
  let student2Token = '';
  let parent1Token = '';
  let parent2Token = '';
  let profile1Id = '';
  let profile2Id = '';
  let instructorId = '';

  const send = (
    method: 'post' | 'patch' | 'delete',
    url: string,
    body: unknown,
    token?: string,
  ) => {
    const agent = request(app.getHttpServer());
    const req =
      method === 'post'
        ? agent.post(url)
        : method === 'patch'
          ? agent.patch(url)
          : agent.delete(url);
    const withAuth = token === undefined ? req : req.set('Authorization', `Bearer ${token}`);
    return withAuth.set('Content-Type', 'application/json').send(body as object);
  };

  const login = async (email: string): Promise<string> => {
    const res = await send('post', '/api/v1/auth/login', { email, password }).expect(200);
    return res.body.data.tokens.accessToken as string;
  };

  beforeAll(async () => {
    if (process.env.DATABASE_URL === undefined || process.env.DATABASE_URL === '') {
      throw new Error('DATABASE_URL must be set for e2e tests');
    }
    app = await createApp();
    await app.init();
    prisma = new PrismaClient();
    const passwordHash = await bcrypt.hash(password, 10);
    const rows: Array<[keyof typeof users, 'ADMIN' | 'STUDENT' | 'PARENT' | 'INSTRUCTOR']> = [
      ['admin', 'ADMIN'],
      ['instructor', 'INSTRUCTOR'],
      ['student1', 'STUDENT'],
      ['student2', 'STUDENT'],
      ['parent1', 'PARENT'],
      ['parent2', 'PARENT'],
    ];
    for (const [key, role] of rows) {
      await prisma.user.upsert({
        where: { email: users[key] },
        update: {},
        create: { email: users[key], passwordHash, role, emailVerifiedAt: new Date() },
      });
    }
    adminToken = await login(users.admin);
    student1Token = await login(users.student1);
    student2Token = await login(users.student2);
    parent1Token = await login(users.parent1);
    parent2Token = await login(users.parent2);
    const instructorUser = await prisma.user.findUnique({ where: { email: users.instructor } });
    if (instructorUser === null) {
      throw new Error('instructor user missing');
    }
    instructorId = instructorUser.id;
    // Two ACTIVE profiles with accounts: both students can self-scope via guard 7.3.
    const first = await send(
      'post',
      '/api/v1/students',
      {
        fullName: 'Race Student One',
        dob: '2005-06-15',
        gender: 'MALE',
        linkedUserEmail: users.student1,
      },
      adminToken,
    ).expect(201);
    profile1Id = first.body.data.id as string;
    const second = await send(
      'post',
      '/api/v1/students',
      {
        fullName: 'Race Student Two',
        dob: '2005-06-16',
        gender: 'FEMALE',
        linkedUserEmail: users.student2,
      },
      adminToken,
    ).expect(201);
    profile2Id = second.body.data.id as string;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('serializes concurrent enrollments so a full class is never overbooked', async () => {
    const cls = await send(
      'post',
      '/api/v1/classes',
      { name: `Race class ${stamp}`, capacity: 1, instructorId },
      adminToken,
    ).expect(201);
    const classId = cls.body.data.id as string;

    const [first, second] = await Promise.all([
      send('post', '/api/v1/enrollments', { studentId: profile1Id, classId }, adminToken),
      send('post', '/api/v1/enrollments', { studentId: profile2Id, classId }, adminToken),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);
    expect(await prisma.enrollment.count({ where: { classId, leftAt: null } })).toBe(1);
  });

  it('serializes concurrent exam registrations so capacity is never exceeded', async () => {
    const rankBase = 7000 + (stamp % 900);
    const rank = await send(
      'post',
      '/api/v1/belt-ranks',
      { code: `R${stamp}_M`, name: 'Race Mid', rankGroup: 'DO', orderIndex: rankBase },
      adminToken,
    ).expect(201);
    const exam = await send(
      'post',
      '/api/v1/belt-exams',
      {
        title: `Race exam ${stamp}`,
        examDate: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        targetRankId: rank.body.data.id,
        feeAmount: 100000,
        capacity: 1,
        registrationDeadline: new Date(Date.now() + 10 * 86_400_000).toISOString(),
      },
      adminToken,
    ).expect(201);
    await send(
      'patch',
      `/api/v1/belt-exams/${exam.body.data.id}`,
      { status: 'OPEN' },
      adminToken,
    ).expect(200);

    const [first, second] = await Promise.all([
      send(
        'post',
        `/api/v1/belt-exams/${exam.body.data.id}/register`,
        { studentId: profile1Id },
        student1Token,
      ),
      send(
        'post',
        `/api/v1/belt-exams/${exam.body.data.id}/register`,
        { studentId: profile2Id },
        student2Token,
      ),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);
    expect(
      await prisma.examRegistration.count({
        where: { examId: exam.body.data.id, status: { not: 'CANCELLED' } },
      }),
    ).toBe(1);
  });

  it('hands a single-use invite code to exactly one of two racing parents', async () => {
    const created = await send(
      'post',
      '/api/v1/students',
      { fullName: 'Race Minor', dob: '2016-02-02', gender: 'MALE' },
      adminToken,
    ).expect(201);
    const inviteCode = created.body.data.inviteCode as string;

    const [first, second] = await Promise.all([
      send('post', '/api/v1/parents/link', { inviteCode }, parent1Token),
      send('post', '/api/v1/parents/link', { inviteCode }, parent2Token),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 404]);
    const links = await prisma.parentStudentLink.findMany({
      where: { studentId: created.body.data.id },
    });
    expect(links).toHaveLength(1);
    // The consumed code was rotated away by the winner: the loser's code no longer matches.
    const profile = await prisma.studentProfile.findUnique({
      where: { id: created.body.data.id },
    });
    expect(profile?.inviteCode).not.toBe(inviteCode);
  });

  it('refuses a stale PASS that would downgrade a promoted belt (G-2)', async () => {
    const rankBase = 7900 + (stamp % 900);
    const low = await send(
      'post',
      '/api/v1/belt-ranks',
      { code: `R${stamp}_L`, name: 'Race Low', rankGroup: 'LAM', orderIndex: rankBase },
      adminToken,
    ).expect(201);
    const high = await send(
      'post',
      '/api/v1/belt-ranks',
      { code: `R${stamp}_H`, name: 'Race High', rankGroup: 'DO', orderIndex: rankBase + 1 },
      adminToken,
    ).expect(201);
    const makeExam = async (targetRankId: number, title: string): Promise<string> => {
      const exam = await send(
        'post',
        '/api/v1/belt-exams',
        {
          title,
          examDate: new Date(Date.now() + 30 * 86_400_000).toISOString(),
          targetRankId,
          feeAmount: 100000,
          registrationDeadline: new Date(Date.now() + 10 * 86_400_000).toISOString(),
        },
        adminToken,
      ).expect(201);
      return exam.body.data.id as string;
    };
    const examLowId = await makeExam(low.body.data.id, `Stale PASS low ${stamp}`);
    const examHighId = await makeExam(high.body.data.id, `Stale PASS high ${stamp}`);
    await send('patch', `/api/v1/belt-exams/${examLowId}`, { status: 'OPEN' }, adminToken).expect(
      200,
    );
    await send('patch', `/api/v1/belt-exams/${examHighId}`, { status: 'OPEN' }, adminToken).expect(
      200,
    );

    // Both registrations happen while the student still holds no rank.
    const regLow = await send(
      'post',
      `/api/v1/belt-exams/${examLowId}/register`,
      { studentId: profile1Id },
      student1Token,
    ).expect(201);
    const regHigh = await send(
      'post',
      `/api/v1/belt-exams/${examHighId}/register`,
      { studentId: profile1Id },
      student1Token,
    ).expect(201);

    // The high exam's PASS promotes first…
    await send(
      'post',
      `/api/v1/exam-registrations/${regHigh.body.data.id}/result`,
      { status: 'RESULT_PASS' },
      adminToken,
    ).expect(200);
    // …then the stale low PASS must be refused, not downgrade the belt.
    await send(
      'post',
      `/api/v1/exam-registrations/${regLow.body.data.id}/result`,
      { status: 'RESULT_PASS' },
      adminToken,
    ).expect(409);
    const profile = await prisma.studentProfile.findUnique({ where: { id: profile1Id } });
    expect(profile?.currentBeltRankId).toBe(high.body.data.id);
  });
});
