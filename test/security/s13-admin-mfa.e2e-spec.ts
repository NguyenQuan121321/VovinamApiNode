import type { INestApplication } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../../src/bootstrap';
import { enrollTotp } from '../e2e/helpers/mfa';

/**
 * S-13 (plan 4.1, TASK-05): ADMIN MFA enforcement. An ADMIN token answers 403
 * 'MFA enrollment required' on every route whose @Roles admit ADMIN until a
 * TOTP credential exists. Self-scoped /auth routes (bootstrap path) and
 * any-authenticated catalog reads stay reachable without MFA; non-ADMIN roles
 * on the same routes keep the plain role-403 posture.
 */
describe('S-13: ADMIN MFA enforcement (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const stamp = Date.now();
  const password = 'Str0ngPass';
  const adminEmail = `admin-mfa-${stamp}@example.com`;
  const studentEmail = `student-mfa-${stamp}@example.com`;
  let adminToken = '';
  let studentToken = '';
  let studentProfileId = '';

  const send = (
    method: 'get' | 'post' | 'patch' | 'delete',
    url: string,
    body: unknown,
    token?: string,
  ) => {
    const agent = request(app.getHttpServer());
    const req =
      method === 'get'
        ? agent.get(url)
        : method === 'post'
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
    await prisma.user.upsert({
      where: { email: adminEmail },
      update: {},
      create: { email: adminEmail, passwordHash, role: 'ADMIN', emailVerifiedAt: new Date() },
    });
    await prisma.user.upsert({
      where: { email: studentEmail },
      update: {},
      create: { email: studentEmail, passwordHash, role: 'STUDENT', emailVerifiedAt: new Date() },
    });
    adminToken = await login(adminEmail);
    studentToken = await login(studentEmail);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('blocks admin-only writes with 403 MFA enrollment required before TOTP', async () => {
    const res = await send('post', '/api/v1/students', { fullName: 'X' }, adminToken).expect(403);
    expect(res.body.message).toBe('MFA enrollment required');
  });

  it('blocks admin-admitting financial reads before TOTP', async () => {
    const res = await send('get', '/api/v1/invoices', undefined, adminToken).expect(403);
    expect(res.body.message).toBe('MFA enrollment required');
  });

  it('keeps the bootstrap path open: self-scoped and any-authenticated reads', async () => {
    await send('get', '/api/v1/auth/me', undefined, adminToken).expect(200);
    await send('get', '/api/v1/classes', undefined, adminToken).expect(200);
    await send('get', '/api/v1/belt-ranks', undefined, adminToken).expect(200);
  });

  it('enrolls TOTP through the API, after which admin routes answer normally', async () => {
    await enrollTotp(app, adminToken);
    const profile = await send(
      'post',
      '/api/v1/students',
      {
        fullName: 'Tran Thi B',
        dob: '2006-03-10',
        gender: 'FEMALE',
        linkedUserEmail: studentEmail,
      },
      adminToken,
    ).expect(201);
    studentProfileId = profile.body.data.id as string;
    await send('get', '/api/v1/invoices', undefined, adminToken).expect(200);
  });

  it('keeps the plain role-403 posture for non-ADMIN roles on admin routes', async () => {
    const res = await send(
      'post',
      `/api/v1/students/${studentProfileId}/invite-code`,
      {},
      studentToken,
    ).expect(403);
    expect(res.body.message).toBe('Forbidden');
  });
});
