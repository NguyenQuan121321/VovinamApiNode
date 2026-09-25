import type { INestApplication } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../../src/bootstrap';
import { enrollTotp } from './helpers/mfa';

/**
 * Matrix workflows (rows 11/12/14/23/26/27/28): leave requests with approval,
 * promotion proposals, instructor evaluations, discount codes on invoices, and
 * the attendance/tuition/belt reports with their role scoping.
 */
describe('Matrix workflows (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const stamp = Date.now();
  const password = 'Str0ngPass';
  const users: Record<'admin' | 'student' | 'instructor' | 'parent', string> = {
    admin: `admin-${stamp}@example.com`,
    student: `student-${stamp}@example.com`,
    instructor: `instructor-${stamp}@example.com`,
    parent: `parent-${stamp}@example.com`,
  };
  let adminToken = '';
  let studentToken = '';
  let instructorToken = '';
  let parentToken = '';
  let classId = '';
  let otherClassId = '';
  let studentProfileId = '';
  let childProfileId = '';
  let month = 1;
  let year = 2026;
  let currentRank = { id: 0 };
  let targetRank = { id: 0 };
  let midRank = { id: 0 };

  const get = (url: string, token?: string) => {
    const req = request(app.getHttpServer()).get(url);
    return token === undefined ? req : req.set('Authorization', `Bearer ${token}`);
  };
  const send = (
    method: 'post' | 'patch' | 'put' | 'delete',
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
          : method === 'put'
            ? agent.put(url)
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
    for (const [email, role] of [
      [users.admin, 'ADMIN'],
      [users.student, 'STUDENT'],
      [users.instructor, 'INSTRUCTOR'],
      [users.parent, 'PARENT'],
    ] as const) {
      await prisma.user.upsert({
        where: { email },
        update: {},
        create: { email, passwordHash, role, emailVerifiedAt: new Date() },
      });
    }
    adminToken = await login(users.admin);
    await enrollTotp(app, adminToken);
    studentToken = await login(users.student);
    instructorToken = await login(users.instructor);
    parentToken = await login(users.parent);

    const instructorId = (
      await prisma.user.findUniqueOrThrow({ where: { email: users.instructor } })
    ).id;
    classId = (
      await prisma.class.create({
        data: { name: `Workflow class ${stamp}`, instructorId, capacity: 30 },
      })
    ).id;
    const foreignInstructor = await prisma.user.create({
      data: {
        email: `foreign-${stamp}@example.com`,
        passwordHash,
        role: 'INSTRUCTOR',
        emailVerifiedAt: new Date(),
      },
    });
    otherClassId = (
      await prisma.class.create({
        data: { name: `Foreign class ${stamp}`, instructorId: foreignInstructor.id, capacity: 30 },
      })
    ).id;

    // CI runs the e2e suite against a migrate-deploy-only database (no seed), so the
    // suite creates its own rank ladder instead of relying on seeded catalog rows.
    const rankBase =
      (await prisma.beltRank.aggregate({ _max: { orderIndex: true } }))._max.orderIndex ?? 0;
    currentRank = await prisma.beltRank.create({
      data: {
        code: `W${stamp}_1`,
        name: 'Workflow White',
        rankGroup: 'LAM',
        orderIndex: rankBase + 1,
      },
    });
    midRank = await prisma.beltRank.create({
      data: {
        code: `W${stamp}_2`,
        name: 'Workflow Blue',
        rankGroup: 'LAM',
        orderIndex: rankBase + 2,
      },
    });
    targetRank = await prisma.beltRank.create({
      data: {
        code: `W${stamp}_3`,
        name: 'Workflow Yellow',
        rankGroup: 'VANG',
        orderIndex: rankBase + 3,
      },
    });

    studentProfileId = (
      await prisma.studentProfile.create({
        data: {
          userId: (await prisma.user.findUniqueOrThrow({ where: { email: users.student } })).id,
          fullName: 'Le Van Tuan',
          dob: new Date('2006-03-12'),
          gender: 'MALE',
          inviteCode: ('' + stamp).slice(-8).padStart(8, 'B'),
          status: 'ACTIVE',
          currentBeltRankId: currentRank.id,
        },
      })
    ).id;
    childProfileId = (
      await prisma.studentProfile.create({
        data: {
          fullName: 'Nguyen Thi Bong',
          dob: new Date('2014-07-20'),
          gender: 'FEMALE',
          inviteCode: ('' + (stamp + 1)).slice(-8).padStart(8, 'C'),
          status: 'ACTIVE',
        },
      })
    ).id;
    await prisma.parentStudentLink.create({
      data: {
        parentUserId: (await prisma.user.findUniqueOrThrow({ where: { email: users.parent } })).id,
        studentId: childProfileId,
        verified: true,
      },
    });
    await prisma.enrollment.createMany({
      data: [
        { studentId: studentProfileId, classId },
        { studentId: childProfileId, classId },
      ],
    });

    const now = new Date();
    month = now.getUTCMonth() + 1;
    year = now.getUTCFullYear();
    // One TUITION invoice for the current period backs the tuition report test.
    await send(
      'post',
      '/api/v1/invoices',
      {
        studentId: studentProfileId,
        type: 'TUITION',
        periodMonth: month,
        periodYear: year,
        items: [{ description: 'Tuition', quantity: 1, unitAmount: 400000 }],
      },
      adminToken,
    ).expect(201);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('leave requests: student creates, instructor approves, parent views (row 11)', async () => {
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const created = await send(
      'post',
      '/api/v1/leave-requests',
      { studentId: studentProfileId, classId, sessionDate: future, reason: 'School exam' },
      studentToken,
    ).expect(201);
    const leaveId = created.body.data.id as string;
    expect(created.body.data.status).toBe('PENDING');

    await send(
      'post',
      '/api/v1/leave-requests',
      { studentId: studentProfileId, classId, sessionDate: future, reason: 'Again' },
      studentToken,
    ).expect(409);

    const parentCreated = await send(
      'post',
      '/api/v1/leave-requests',
      {
        studentId: childProfileId,
        classId,
        sessionDate: new Date(Date.now() + 6 * 86_400_000).toISOString().slice(0, 10),
        reason: 'Family matter',
      },
      parentToken,
    ).expect(201);

    await send(
      'post',
      '/api/v1/leave-requests',
      {
        studentId: studentProfileId,
        classId: otherClassId,
        sessionDate: future,
        reason: 'Not enrolled',
      },
      studentToken,
    ).expect(409);

    const pastDate = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
    await send(
      'post',
      '/api/v1/leave-requests',
      { studentId: studentProfileId, classId, sessionDate: pastDate, reason: 'Past' },
      studentToken,
    ).expect(400);

    const instructorList = await get(
      '/api/v1/leave-requests?status=PENDING',
      instructorToken,
    ).expect(200);
    expect(instructorList.body.data.total).toBe(2);

    const foreignInstructorLogin = await send('post', '/api/v1/auth/login', {
      email: `foreign-${stamp}@example.com`,
      password,
    }).expect(200);
    await get(
      '/api/v1/leave-requests',
      foreignInstructorLogin.body.data.tokens.accessToken as string,
    )
      .expect(200)
      .then((res) => expect(res.body.data.total).toBe(0));

    await send(
      'post',
      `/api/v1/leave-requests/${leaveId}/review`,
      { status: 'APPROVED', note: 'OK, study well' },
      instructorToken,
    ).expect(200);
    await send(
      'post',
      `/api/v1/leave-requests/${leaveId}/review`,
      { status: 'REJECTED' },
      instructorToken,
    ).expect(409);

    await send(
      'post',
      `/api/v1/leave-requests/${parentCreated.body.data.id}/cancel`,
      {},
      parentToken,
    ).expect(200);

    const parentView = await get('/api/v1/leave-requests', parentToken).expect(200);
    // The parent's verified-link scope covers only their own child's request.
    expect(parentView.body.data.total).toBe(1);
    await get('/api/v1/leave-requests', studentToken).expect(200);
  });

  it('promotion proposals: instructor proposes, admin approves (row 14)', async () => {
    const created = await send(
      'post',
      '/api/v1/promotion-proposals',
      { studentId: studentProfileId, proposedRankId: targetRank.id, note: 'Technically ready' },
      instructorToken,
    ).expect(201);
    const proposalId = created.body.data.id as string;

    await send(
      'post',
      '/api/v1/promotion-proposals',
      { studentId: studentProfileId, proposedRankId: targetRank.id },
      instructorToken,
    ).expect(409);

    // A rank at or below the student's current rank is not a promotion (409).
    await send(
      'post',
      '/api/v1/promotion-proposals',
      { studentId: studentProfileId, proposedRankId: midRank.id },
      instructorToken,
    ).expect(409);

    const own = await get('/api/v1/promotion-proposals', studentToken).expect(200);
    expect(own.body.data.total).toBe(1);

    await send(
      'post',
      `/api/v1/promotion-proposals/${proposalId}/review`,
      { status: 'APPROVED' },
      instructorToken,
    ).expect(403);
    await send(
      'post',
      `/api/v1/promotion-proposals/${proposalId}/review`,
      { status: 'APPROVED' },
      adminToken,
    ).expect(200);
    await send(
      'post',
      `/api/v1/promotion-proposals/${proposalId}/review`,
      { status: 'REJECTED' },
      adminToken,
    ).expect(409);
  });

  it('evaluations: instructor writes per period, student reads (row 12)', async () => {
    const created = await send(
      'post',
      '/api/v1/evaluations',
      {
        studentId: studentProfileId,
        classId,
        periodMonth: month,
        periodYear: year,
        rating: 8,
        comment: 'Good progress',
      },
      instructorToken,
    ).expect(201);
    expect(created.body.data.rating).toBe(8);

    await send(
      'post',
      '/api/v1/evaluations',
      { studentId: studentProfileId, periodMonth: month, periodYear: year, rating: 5 },
      instructorToken,
    ).expect(409);

    const listed = await get(
      `/api/v1/evaluations?studentId=${studentProfileId}`,
      studentToken,
    ).expect(200);
    expect(listed.body.data.items).toHaveLength(1);
    await get(`/api/v1/evaluations?studentId=${childProfileId}`, parentToken)
      .expect(200)
      .then((res) => expect(res.body.data.total).toBe(0));

    await send(
      'patch',
      `/api/v1/evaluations/${created.body.data.id}`,
      { rating: 9 },
      instructorToken,
    ).expect(200);
  });

  it('discount codes: CRUD, validation, and application on invoices (row 23)', async () => {
    const discountCode = `E2E${String(stamp).slice(-6)}`;
    const created = await send(
      'post',
      '/api/v1/discounts',
      {
        code: discountCode,
        description: '10% off',
        percentOff: 10,
        validFrom: '2026-01-01',
        validUntil: '2030-01-01',
      },
      adminToken,
    ).expect(201);
    const discountId = created.body.data.id as string;

    await send(
      'post',
      '/api/v1/discounts',
      {
        code: 'BOTH',
        percentOff: 10,
        amountOff: 50000,
        validFrom: '2026-01-01',
        validUntil: '2030-01-01',
      },
      adminToken,
    ).expect(400);
    await send(
      'post',
      '/api/v1/discounts',
      { code: discountCode, percentOff: 5, validFrom: '2026-01-01', validUntil: '2030-01-01' },
      adminToken,
    ).expect(409);

    const invoiced = await send(
      'post',
      '/api/v1/invoices',
      {
        studentId: studentProfileId,
        type: 'UNIFORM',
        items: [{ description: 'Uniform', quantity: 1, unitAmount: 500000 }],
        discountCode: discountCode.toLowerCase(),
      },
      adminToken,
    ).expect(201);
    expect(invoiced.body.data.discount).toBe(50000);
    expect(invoiced.body.data.total).toBe(450000);

    await send(
      'post',
      '/api/v1/invoices',
      {
        studentId: studentProfileId,
        type: 'OTHER',
        items: [{ description: 'X', quantity: 1, unitAmount: 100000 }],
        discountCode: 'NOSUCHCODE',
      },
      adminToken,
    ).expect(400);

    await send('patch', `/api/v1/discounts/${discountId}`, { isActive: false }, adminToken).expect(
      200,
    );
    await send('delete', `/api/v1/discounts/${discountId}`, {}, adminToken).expect(200);
    await get('/api/v1/discounts', instructorToken).expect(403);
  });

  it('reports: attendance, tuition, belts with role scoping (rows 26/27/28)', async () => {
    const session = await send(
      'post',
      '/api/v1/attendance-sessions',
      { classId, sessionDate: new Date().toISOString().slice(0, 10), topic: 'Report session' },
      instructorToken,
    ).expect(201);
    await send(
      'post',
      `/api/v1/attendance-sessions/${session.body.data.id}/records`,
      {
        records: [
          { studentId: studentProfileId, status: 'PRESENT' },
          { studentId: childProfileId, status: 'LATE' },
        ],
      },
      instructorToken,
    ).expect(200);

    const mm = String(month).padStart(2, '0');
    const attendance = await get(
      `/api/v1/admin/reports/attendance?month=${year}-${mm}`,
      adminToken,
    ).expect(200);
    const ownClassRow = (attendance.body.data as Array<Record<string, unknown>>).find(
      (row) => row.classId === classId,
    );
    expect(ownClassRow).toMatchObject({ sessionsHeld: 1, PRESENT: 1, LATE: 1 });

    const instructorAttendance = await get(
      `/api/v1/admin/reports/attendance?month=${year}-${mm}`,
      instructorToken,
    ).expect(200);
    const instructorRows = instructorAttendance.body.data as Array<Record<string, unknown>>;
    expect(instructorRows.some((row) => row.classId === otherClassId)).toBe(false);

    const tuition = await get(
      `/api/v1/admin/reports/tuition?month=${month}&year=${year}`,
      adminToken,
    ).expect(200);
    const unpaid = (tuition.body.data.byStatus as Array<{ status: string; invoices: number }>).find(
      (row) => row.status === 'UNPAID',
    );
    expect(unpaid?.invoices).toBeGreaterThanOrEqual(1);

    const belts = await get('/api/v1/admin/reports/belts', adminToken).expect(200);
    // The suite creates its own rank ladder on a CI-unseeded database.
    expect(
      (belts.body.data.distribution as Array<Record<string, unknown>>).length,
    ).toBeGreaterThanOrEqual(3);
    await get('/api/v1/admin/reports/belts', instructorToken).expect(200);
    await get('/api/v1/admin/reports/belts', studentToken).expect(403);
    await get(`/api/v1/admin/reports/tuition?month=${month}&year=${year}`, studentToken).expect(
      403,
    );
  });
});
