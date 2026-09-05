import type { INestApplication } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../../src/bootstrap';

/**
 * P3 acceptance (plan 13): open exam -> register (EXAM_FEE invoice issued) ->
 * RESULT_PASS -> current_belt_rank_id promoted. Also covers the ownership guard
 * for parent registrations (S-01) and exam capacity.
 */
describe('Belt ranks and exams (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const stamp = Date.now();
  const password = 'Str0ngPass';
  const users = {
    admin: `admin-${stamp}@example.com`,
    instructor: `instructor-${stamp}@example.com`,
    student: `student-${stamp}@example.com`,
    parent: `parent-${stamp}@example.com`,
    parentB: `parent-b-${stamp}@example.com`,
  };
  let adminToken = '';
  let instructorToken = '';
  let studentToken = '';
  let parentToken = '';
  let parentBToken = '';
  let studentProfileId = '';
  let secondProfileId = '';
  let rankLowId = 0;
  let rankHighId = 0;
  let exam1Id = '';
  let exam2Id = '';
  let registrationId = '';

  const get = (url: string, token?: string) => {
    const req = request(app.getHttpServer()).get(url);
    return token === undefined ? req : req.set('Authorization', `Bearer ${token}`);
  };
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

  const isoDate = (offsetDays: number): string =>
    new Date(stamp + offsetDays * 86_400_000).toISOString().slice(0, 10);

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
      ['student', 'STUDENT'],
      ['parent', 'PARENT'],
      ['parentB', 'PARENT'],
    ];
    for (const [key, role] of rows) {
      await prisma.user.upsert({
        where: { email: users[key] },
        update: {},
        create: { email: users[key], passwordHash, role, emailVerifiedAt: new Date() },
      });
    }
    adminToken = await login(users.admin);
    instructorToken = await login(users.instructor);
    studentToken = await login(users.student);
    parentToken = await login(users.parent);
    parentBToken = await login(users.parentB);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('admin manages the belt rank catalog; members can read it', async () => {
    const rankBase = 500 + (stamp % 9000);
    const low = await send(
      'post',
      '/api/v1/belt-ranks',
      { code: `T${stamp}_L`, name: 'Test White', rankGroup: 'LAM', orderIndex: rankBase },
      adminToken,
    ).expect(201);
    const high = await send(
      'post',
      '/api/v1/belt-ranks',
      { code: `T${stamp}_H`, name: 'Test Yellow', rankGroup: 'VANG', orderIndex: rankBase + 1 },
      adminToken,
    ).expect(201);
    rankLowId = low.body.data.id as number;
    rankHighId = high.body.data.id as number;

    const list = await get('/api/v1/belt-ranks', studentToken).expect(200);
    const codes = (list.body.data as Array<Record<string, unknown>>).map((r) => r.code);
    expect(codes).toContain(`T${stamp}_L`);
    expect(codes).toContain(`T${stamp}_H`);

    // Duplicate code conflicts; students cannot write the catalog.
    await send(
      'post',
      '/api/v1/belt-ranks',
      { code: `T${stamp}_L`, name: 'Dup', rankGroup: 'LAM', orderIndex: rankBase + 2 },
      adminToken,
    ).expect(409);
    await send(
      'post',
      '/api/v1/belt-ranks',
      { code: 'X', name: 'Nope', rankGroup: 'LAM', orderIndex: rankBase + 3 },
      studentToken,
    ).expect(403);
  });

  it('admin creates a student, links the parent, and opens an exam', async () => {
    const created = await send(
      'post',
      '/api/v1/students',
      {
        fullName: 'Nguyen Van A',
        dob: '2005-06-15',
        gender: 'MALE',
        linkedUserEmail: users.student,
      },
      adminToken,
    ).expect(201);
    studentProfileId = created.body.data.id as string;

    const second = await send(
      'post',
      '/api/v1/students',
      { fullName: 'Tran Thi B', dob: '2013-03-03', gender: 'FEMALE' },
      adminToken,
    ).expect(201);
    secondProfileId = second.body.data.id as string;

    for (const profileId of [studentProfileId, secondProfileId]) {
      const regen = await send(
        'post',
        `/api/v1/students/${profileId}/invite-code`,
        {},
        adminToken,
      ).expect(200);
      await send(
        'post',
        '/api/v1/parents/link',
        { inviteCode: regen.body.data.inviteCode },
        parentToken,
      ).expect(201);
    }

    const exam = await send(
      'post',
      '/api/v1/belt-exams',
      {
        title: 'Mid-term grading',
        examDate: isoDate(30),
        targetRankId: rankHighId,
        feeAmount: 300000,
        capacity: 1,
        registrationDeadline: isoDate(10),
      },
      adminToken,
    ).expect(201);
    exam1Id = exam.body.data.id as string;
    expect(exam.body.data.code).toMatch(/^EXAM-\d{4}-\d{2}$/);
    expect(exam.body.data.status).toBe('DRAFT');

    // Registering a DRAFT exam is rejected; the admin opens it.
    await send(
      'post',
      `/api/v1/belt-exams/${exam1Id}/register`,
      { studentId: studentProfileId },
      studentToken,
    ).expect(409);
    await send('patch', `/api/v1/belt-exams/${exam1Id}`, { status: 'OPEN' }, adminToken).expect(
      200,
    );

    const detail = await get(`/api/v1/belt-exams/${exam1Id}`, studentToken).expect(200);
    expect(detail.body.data).toMatchObject({
      status: 'OPEN',
      feeAmount: 300000,
      registeredCount: 0,
    });
  });

  it('student self-registers and receives an EXAM_FEE invoice', async () => {
    const res = await send(
      'post',
      `/api/v1/belt-exams/${exam1Id}/register`,
      { studentId: studentProfileId },
      studentToken,
    ).expect(201);
    registrationId = res.body.data.id as string;
    expect(res.body.data.status).toBe('PENDING_PAYMENT');
    expect(res.body.data.invoice).toMatchObject({ total: 300000, status: 'UNPAID' });
    expect(res.body.data.invoice.invoiceNo).toMatch(/^INV-\d{4}-\d{4}$/);

    // Duplicate registration conflicts; an unlinked parent gets a uniform 404 (S-01);
    // the linked parent passes the guard and hits the duplicate instead.
    await send(
      'post',
      `/api/v1/belt-exams/${exam1Id}/register`,
      { studentId: studentProfileId },
      studentToken,
    ).expect(409);
    await send(
      'post',
      `/api/v1/belt-exams/${exam1Id}/register`,
      { studentId: studentProfileId },
      parentBToken,
    ).expect(404);
    await send(
      'post',
      `/api/v1/belt-exams/${exam1Id}/register`,
      { studentId: studentProfileId },
      parentToken,
    ).expect(409);
  });

  it('enforces capacity for further registrations and allows a linked parent to register a child', async () => {
    // Exam 1 has capacity 1 and is already taken by the student.
    await send(
      'post',
      `/api/v1/belt-exams/${exam1Id}/register`,
      { studentId: secondProfileId },
      parentToken,
    ).expect(409);

    const exam2 = await send(
      'post',
      '/api/v1/belt-exams',
      {
        title: 'Beginner grading',
        examDate: isoDate(45),
        targetRankId: rankLowId,
        feeAmount: 200000,
        registrationDeadline: isoDate(20),
      },
      adminToken,
    ).expect(201);
    exam2Id = exam2.body.data.id as string;
    await send('patch', `/api/v1/belt-exams/${exam2Id}`, { status: 'OPEN' }, adminToken).expect(
      200,
    );

    const res = await send(
      'post',
      `/api/v1/belt-exams/${exam2Id}/register`,
      { studentId: secondProfileId },
      parentToken,
    ).expect(201);
    expect(res.body.data.invoice).toMatchObject({ total: 200000, status: 'UNPAID' });
  });

  it('records PASS and promotes the rank (P3 acceptance)', async () => {
    await send(
      'post',
      `/api/v1/exam-registrations/${registrationId}/result`,
      { status: 'RESULT_PASS', resultNote: 'Clean technique' },
      instructorToken,
    ).expect(200);

    const profile = await get(`/api/v1/students/${studentProfileId}`, adminToken).expect(200);
    expect(profile.body.data.currentBeltRankId).toBe(rankHighId);

    // Results are final; students cannot record them.
    await send(
      'post',
      `/api/v1/exam-registrations/${registrationId}/result`,
      { status: 'RESULT_FAIL' },
      adminToken,
    ).expect(409);
    await send(
      'post',
      `/api/v1/exam-registrations/${registrationId}/result`,
      { status: 'RESULT_FAIL' },
      studentToken,
    ).expect(403);
  });

  it('records FAIL without touching the rank', async () => {
    const failReg = await prisma.examRegistration.findFirstOrThrow({
      where: { examId: exam2Id, studentId: secondProfileId },
      select: { id: true },
    });
    await send(
      'post',
      `/api/v1/exam-registrations/${failReg.id}/result`,
      { status: 'RESULT_FAIL', resultNote: 'Not ready' },
      instructorToken,
    ).expect(200);

    const profile = await get(`/api/v1/students/${secondProfileId}`, adminToken).expect(200);
    expect(profile.body.data.currentBeltRankId).toBeNull();
  });
});
