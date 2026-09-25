import type { INestApplication } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../../src/bootstrap';
import { AuditService } from '../../src/auth/audit/audit.service';
import { enrollTotp } from './helpers/mfa';

/**
 * Admin backoffice completion (matrix rows 2/4/5/6/17/24/29/30): user/instructor
 * management, system settings, student self-service edit, belt history, the
 * system-wide audit view, and instructor-scoped announcement posting.
 */
describe('Admin backoffice completion (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const stamp = Date.now();
  const password = 'Str0ngPass';
  const users: Record<'admin' | 'student' | 'instructor', string> = {
    admin: `admin-${stamp}@example.com`,
    student: `student-${stamp}@example.com`,
    instructor: `instructor-${stamp}@example.com`,
  };
  let adminToken = '';
  let studentToken = '';
  let instructorToken = '';
  let instructorUserId = '';
  let studentProfileId = '';
  let classId = '';

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
    const instructor = await prisma.user.findUniqueOrThrow({ where: { email: users.instructor } });
    instructorUserId = instructor.id;
    classId = (
      await prisma.class.create({
        data: { name: `Report class ${stamp}`, instructorId: instructor.id, capacity: 30 },
      })
    ).id;
    studentProfileId = (
      await prisma.studentProfile.create({
        data: {
          userId: (await prisma.user.findUniqueOrThrow({ where: { email: users.student } })).id,
          fullName: 'Le Van Tuan',
          dob: new Date('2006-03-12'),
          gender: 'MALE',
          phone: '0901110001',
          inviteCode: 'DEMOABC',
          status: 'ACTIVE',
        },
      })
    ).id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('creates an instructor account through the API (row 6) and the account can log in', async () => {
    const created = await send(
      'post',
      '/api/v1/users',
      { email: `new-instructor-${stamp}@example.com`, password, role: 'INSTRUCTOR' },
      adminToken,
    ).expect(201);
    expect(created.body.data).toMatchObject({ role: 'INSTRUCTOR', emailVerified: true });

    const loginRes = await send('post', '/api/v1/auth/login', {
      email: `new-instructor-${stamp}@example.com`,
      password,
    }).expect(200);
    expect(loginRes.body.data.tokens.accessToken).toBeDefined();
  });

  it('rejects duplicate emails (409) and weak passwords (400) on user creation', async () => {
    await send(
      'post',
      '/api/v1/users',
      { email: users.student, password, role: 'STUDENT' },
      adminToken,
    ).expect(409);
    await send(
      'post',
      '/api/v1/users',
      { email: `weak-${stamp}@example.com`, password: 'short', role: 'STUDENT' },
      adminToken,
    ).expect(400);
  });

  it('updates a role and refuses self-deactivation (row 2)', async () => {
    await send(
      'patch',
      `/api/v1/users/${instructorUserId}`,
      { role: 'INSTRUCTOR' },
      adminToken,
    ).expect(200);
    const adminId = (await prisma.user.findUniqueOrThrow({ where: { email: users.admin } })).id;
    await send('patch', `/api/v1/users/${adminId}`, { isActive: false }, adminToken).expect(400);
  });

  it('soft-deletes an account; the deleted user cannot log in (row 2)', async () => {
    const target = await prisma.user.upsert({
      where: { email: `doomed-${stamp}@example.com` },
      update: {},
      create: {
        email: `doomed-${stamp}@example.com`,
        passwordHash: await bcrypt.hash(password, 10),
        role: 'STUDENT',
        emailVerifiedAt: new Date(),
      },
    });
    await send('delete', `/api/v1/users/${target.id}`, {}, adminToken).expect(200);
    await send('post', '/api/v1/auth/login', {
      email: `doomed-${stamp}@example.com`,
      password,
    }).expect(401);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(after.deletedAt).not.toBeNull();
  });

  it('reads and updates system settings (row 29)', async () => {
    const initial = await get('/api/v1/admin/billing/settings', adminToken).expect(200);
    expect(initial.body.data).toHaveProperty('tuitionRates');
    expect(initial.body.data).toHaveProperty('bankAccount');

    await send(
      'put',
      '/api/v1/admin/billing/settings/tuition-rates',
      { rates: [{ classId, monthlyAmount: 450000 }] },
      adminToken,
    ).expect(200);
    const rates = await get('/api/v1/admin/billing/settings', adminToken).expect(200);
    expect(rates.body.data.tuitionRates[classId]).toBe(450000);
    await send(
      'put',
      '/api/v1/admin/billing/settings/tuition-rates',
      { rates: [{ classId: '00000000-0000-4000-8000-000000000000', monthlyAmount: 1 }] },
      adminToken,
    ).expect(400);

    await send(
      'put',
      '/api/v1/admin/billing/settings/bank-account',
      {
        bankAccount: {
          bin: '970422',
          number: '0071000123456',
          name: 'CLB VOVINAM',
          ownerType: 'BUSINESS',
        },
      },
      adminToken,
    ).expect(200);
  });

  it('students may edit their own contact fields but not their identity (row 4, E*)', async () => {
    const patched = await send(
      'patch',
      '/api/v1/students/me',
      { phone: '0911222333', address: '99 Le Loi' },
      studentToken,
    ).expect(200);
    expect(patched.body.data.phone).toBe('0911222333');

    await send('patch', '/api/v1/students/me', { fullName: 'Fake Name' }, studentToken).expect(400);

    const me = await get('/api/v1/students/me', studentToken).expect(200);
    expect(me.body.data.fullName).toBe('Le Van Tuan');
  });

  it('exposes the belt history of a student through guard 7.3 (row 17)', async () => {
    const history = await get(
      `/api/v1/exam-registrations?studentId=${studentProfileId}`,
      studentToken,
    ).expect(200);
    expect(history.body.data).toMatchObject({ page: 1, limit: 20 });
    expect(Array.isArray(history.body.data.items)).toBe(true);

    await get(`/api/v1/exam-registrations?studentId=${studentProfileId}`).expect(401);
  });

  it('lets an instructor post a CLASS announcement but never a club-wide one (row 24)', async () => {
    const created = await send(
      'post',
      '/api/v1/announcements',
      {
        title: 'Class only',
        body: 'Bring sparring gear',
        audience: 'CLASS',
        classId,
      },
      instructorToken,
    ).expect(201);
    expect(created.body.data).toMatchObject({ audience: 'CLASS' });

    await send(
      'post',
      '/api/v1/announcements',
      { title: 'Club wide', body: 'Nope', audience: 'ALL' },
      instructorToken,
    ).expect(403);
    await send(
      'post',
      '/api/v1/announcements',
      {
        title: 'Foreign class',
        body: 'Nope',
        audience: 'CLASS',
        classId: '00000000-0000-4000-8000-000000000000',
      },
      instructorToken,
    ).expect(404);
    await send(
      'post',
      '/api/v1/announcements',
      { title: 'Nope', body: 'Nope', audience: 'ALL' },
      studentToken,
    ).expect(403);
  });

  it('exposes the system-wide audit log to admins (row 30)', async () => {
    await app.get(AuditService).flush();
    const res = await get('/api/v1/admin/audit-log?event=login', adminToken).expect(200);
    expect(res.body.data.total).toBeGreaterThanOrEqual(1);
    await get('/api/v1/admin/audit-log', studentToken).expect(403);
  });
});
