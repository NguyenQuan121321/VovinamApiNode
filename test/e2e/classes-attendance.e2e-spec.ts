import type { INestApplication } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../../src/bootstrap';

/**
 * P2 acceptance: classes/schedules/enrollments/attendance end to end — one full
 * attendance session (plan 13, P2 AC), the activated INSTRUCTOR ownership clause
 * (plan 7.3, S-04), and parent read access scoped by verified links (S-01).
 */
describe('Classes, enrollments, attendance (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const stamp = Date.now();
  const password = 'Str0ngPass';
  const users = {
    admin: `admin-${stamp}@example.com`,
    instructor: `instructor-${stamp}@example.com`,
    instructorB: `instructor-b-${stamp}@example.com`,
    student: `student-${stamp}@example.com`,
    parent: `parent-${stamp}@example.com`,
    parentB: `parent-b-${stamp}@example.com`,
  };
  let adminToken = '';
  let instructorToken = '';
  let instructorBToken = '';
  let studentToken = '';
  let parentToken = '';
  let parentBToken = '';
  let studentProfileId = '';
  let secondProfileId = '';
  let classId = '';
  let sessionId = '';

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
      ['instructorB', 'INSTRUCTOR'],
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
    instructorBToken = await login(users.instructorB);
    studentToken = await login(users.student);
    parentToken = await login(users.parent);
    parentBToken = await login(users.parentB);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('admin sets up the class, schedule, and two student profiles', async () => {
    const created = await send(
      'post',
      '/api/v1/students',
      {
        fullName: 'Nguyen Van A',
        dob: '2005-06-15',
        gender: 'MALE',
        phone: '0901112223',
        linkedUserEmail: users.student,
      },
      adminToken,
    ).expect(201);
    studentProfileId = created.body.data.id as string;

    // A second profile without an account: used for the non-enrolled rejection.
    const second = await send(
      'post',
      '/api/v1/students',
      { fullName: 'Tran Thi B', dob: '2013-03-03', gender: 'FEMALE' },
      adminToken,
    ).expect(201);
    secondProfileId = second.body.data.id as string;

    const userId = (await prisma.user.findUnique({ where: { email: users.instructor } }))?.id;
    expect(userId).toBeDefined();
    const cls = await send(
      'post',
      '/api/v1/classes',
      { name: 'White Belt A', instructorId: userId, location: 'Main hall' },
      adminToken,
    ).expect(201);
    classId = cls.body.data.id as string;
    expect(cls.body.data.status).toBe('ACTIVE');

    const schedule = await send(
      'post',
      `/api/v1/classes/${classId}/schedules`,
      { weekday: 1, startTime: '18:00', endTime: '20:00', effectiveFrom: '2026-01-01' },
      adminToken,
    ).expect(201);
    expect(schedule.body.data.classId).toBe(classId);

    // Students cannot manage classes; everyone can read them.
    await send('post', '/api/v1/classes', { name: 'X', instructorId: userId }, studentToken).expect(
      403,
    );
    const list = await get('/api/v1/classes', studentToken).expect(200);
    expect(list.body.data.total).toBeGreaterThanOrEqual(1);

    const detail = await get(`/api/v1/classes/${classId}`, studentToken).expect(200);
    expect(detail.body.data.activeEnrollmentCount).toBe(0);
    const firstSchedule = detail.body.data.schedules[0] as Record<string, unknown>;
    // TIME round trip stays time-of-day regardless of server timezone.
    expect(firstSchedule.startTime).toBe('18:00');
    expect(firstSchedule.endTime).toBe('20:00');
  });

  it('enrolls the student once, rejecting duplicates and wrong roles', async () => {
    await send(
      'post',
      '/api/v1/enrollments',
      { studentId: studentProfileId, classId },
      adminToken,
    ).expect(201);
    await send(
      'post',
      '/api/v1/enrollments',
      { studentId: studentProfileId, classId },
      adminToken,
    ).expect(409);
    await send(
      'post',
      '/api/v1/enrollments',
      { studentId: studentProfileId, classId },
      studentToken,
    ).expect(403);

    const list = await get(`/api/v1/enrollments?classId=${classId}`, adminToken).expect(200);
    expect(list.body.data.total).toBe(1);

    const detail = await get(`/api/v1/classes/${classId}`, studentToken).expect(200);
    expect(detail.body.data.activeEnrollmentCount).toBe(1);
  });

  it('admin edits the class, shrinks-guarded, and manages schedules and enrollment lifecycle', async () => {
    await send('patch', `/api/v1/classes/${classId}`, { name: 'White Belt A2' }, adminToken).expect(
      200,
    );
    const detail = await get(`/api/v1/classes/${classId}`, adminToken).expect(200);
    expect(detail.body.data).toMatchObject({ name: 'White Belt A2' });

    // Enroll a second student, then a capacity shrink below the active count is a 409.
    const enroll = await send(
      'post',
      '/api/v1/enrollments',
      { studentId: secondProfileId, classId },
      adminToken,
    ).expect(201);
    const enrollmentId = enroll.body.data.id as string;
    await send('patch', `/api/v1/classes/${classId}`, { capacity: 1 }, adminToken).expect(409);

    // Soft-leave: repeating the removal answers 404.
    await send('delete', `/api/v1/enrollments/${enrollmentId}`, {}, adminToken).expect(200);
    await send('delete', `/api/v1/enrollments/${enrollmentId}`, {}, adminToken).expect(404);

    // Schedule lifecycle: add, then remove (and remove again for a 404).
    const schedule = await send(
      'post',
      `/api/v1/classes/${classId}/schedules`,
      { weekday: 3, startTime: '19:00', endTime: '21:00', effectiveFrom: '2026-02-01' },
      adminToken,
    ).expect(201);
    const scheduleId = schedule.body.data.id as string;
    await send(
      'delete',
      `/api/v1/classes/${classId}/schedules/${scheduleId}`,
      {},
      adminToken,
    ).expect(200);
    await send(
      'delete',
      `/api/v1/classes/${classId}/schedules/${scheduleId}`,
      {},
      adminToken,
    ).expect(404);

    // Malformed UUID path params answer 400, never a 500 (P2023 leak).
    await get('/api/v1/classes/not-a-uuid', adminToken).expect(400);
  });

  it('scopes student visibility per role now that enrollments exist (S-04)', async () => {
    // The class instructor sees the enrolled student with no contact fields (7.4).
    const own = await get(`/api/v1/students/${studentProfileId}`, instructorToken).expect(200);
    expect(own.body.data.fullName).toBe('Nguyen Van A');
    expect(own.body.data).not.toHaveProperty('phone');

    await get('/api/v1/students', instructorToken)
      .expect(200)
      .then((res) => {
        expect(res.body.data.total).toBe(1);
      });
    // A foreign instructor: uniform 404 on the profile, empty list, 404 on attendance.
    await get(`/api/v1/students/${studentProfileId}`, instructorBToken).expect(404);
    await get('/api/v1/students', instructorBToken)
      .expect(200)
      .then((res) => {
        expect(res.body.data.total).toBe(0);
      });
    await get(`/api/v1/students/${studentProfileId}/attendance`, instructorBToken).expect(404);
  });

  it('runs one full attendance session: create, bulk upsert, overwrite, read back', async () => {
    // A foreign instructor gets a uniform 404 on a class they do not teach (S-04).
    await send(
      'post',
      '/api/v1/attendance-sessions',
      { classId, sessionDate: '2026-01-15', topic: 'X' },
      instructorBToken,
    ).expect(404);

    const created = await send(
      'post',
      '/api/v1/attendance-sessions',
      { classId, sessionDate: '2026-01-15', topic: 'Don chan basics' },
      instructorToken,
    ).expect(201);
    sessionId = created.body.data.id as string;

    // One session per class per date (plan section 6 unique constraint).
    await send(
      'post',
      '/api/v1/attendance-sessions',
      { classId, sessionDate: '2026-01-15' },
      instructorToken,
    ).expect(409);

    // Students never create sessions or write records.
    await send(
      'post',
      '/api/v1/attendance-sessions',
      { classId, sessionDate: '2026-01-16' },
      studentToken,
    ).expect(403);

    // Records for non-enrolled students are rejected (all-or-nothing).
    await send(
      'post',
      `/api/v1/attendance-sessions/${sessionId}/records`,
      { records: [{ studentId: secondProfileId, status: 'PRESENT' }] },
      instructorToken,
    ).expect(400);

    const first = await send(
      'post',
      `/api/v1/attendance-sessions/${sessionId}/records`,
      { records: [{ studentId: studentProfileId, status: 'PRESENT', note: 'On time' }] },
      instructorToken,
    ).expect(200);
    expect(first.body.data[0]).toMatchObject({ status: 'PRESENT', note: 'On time' });

    // Re-submitting the same student overwrites (bulk upsert semantics).
    await send(
      'post',
      `/api/v1/attendance-sessions/${sessionId}/records`,
      { records: [{ studentId: studentProfileId, status: 'ABSENT', note: 'Sick' }] },
      instructorToken,
    ).expect(200);

    const records = await get(
      `/api/v1/attendance-sessions/${sessionId}/records`,
      instructorToken,
    ).expect(200);
    expect(records.body.data.total).toBe(1);
    expect(records.body.data.items[0]).toMatchObject({ status: 'ABSENT', note: 'Sick' });

    // The admin reads records of any class.
    await get(`/api/v1/attendance-sessions/${sessionId}/records`, adminToken).expect(200);
  });

  it('parent links and reads attendance history + monthly summary (S-01 protected)', async () => {
    const regen = await send(
      'post',
      `/api/v1/students/${studentProfileId}/invite-code`,
      {},
      adminToken,
    ).expect(200);
    const inviteCode = regen.body.data.inviteCode as string;
    await send('post', '/api/v1/parents/link', { inviteCode }, parentToken).expect(201);
    await send('post', '/api/v1/parents/link', { inviteCode }, parentBToken).expect(404);

    const history = await get(
      `/api/v1/students/${studentProfileId}/attendance`,
      parentToken,
    ).expect(200);
    expect(history.body.data.total).toBe(1);
    expect(history.body.data.items[0]).toMatchObject({
      status: 'ABSENT',
      // The class was renamed by the admin-edit test above.
      className: 'White Belt A2',
    });

    const summary = await get(
      `/api/v1/attendance/summary?studentId=${studentProfileId}&month=2026-01`,
      parentToken,
    ).expect(200);
    expect(summary.body.data).toMatchObject({
      month: '2026-01',
      ABSENT: 1,
      PRESENT: 0,
      total: 1,
    });

    // An unlinked parent gets the uniform 404 (S-01).
    await get(`/api/v1/students/${studentProfileId}/attendance`, parentBToken).expect(404);
    await get(
      `/api/v1/attendance/summary?studentId=${studentProfileId}&month=2026-01`,
      parentBToken,
    ).expect(404);
  });
});
