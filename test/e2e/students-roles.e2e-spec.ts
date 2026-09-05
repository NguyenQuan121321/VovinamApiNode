import type { INestApplication } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { PrismaClient, type User } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../../src/bootstrap';

/**
 * Role-scoped student access (plan 7.3/7.4, S-01/S-04): the student reads their own
 * profile on the web; the admin manages everyone; parents read linked children;
 * strangers and instructors get a uniform 404.
 */
describe('Students roles and access (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const stamp = Date.now();
  const password = 'Str0ngPass';
  const users: Record<'admin' | 'student' | 'parent' | 'parentB' | 'instructor', string> = {
    admin: `admin-${stamp}@example.com`,
    student: `student-${stamp}@example.com`,
    parent: `parent-${stamp}@example.com`,
    parentB: `parent-b-${stamp}@example.com`,
    instructor: `instructor-${stamp}@example.com`,
  };
  let adminToken = '';
  let studentToken = '';
  let parentToken = '';
  let parentBToken = '';
  let instructorToken = '';
  let studentProfileId = '';

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
      ['student', 'STUDENT'],
      ['parent', 'PARENT'],
      ['parentB', 'PARENT'],
      ['instructor', 'INSTRUCTOR'],
    ];
    for (const [key, role] of rows) {
      await prisma.user.upsert({
        where: { email: users[key] },
        update: {},
        create: { email: users[key], passwordHash, role, emailVerifiedAt: new Date() },
      });
    }
    adminToken = await login(users.admin);
    studentToken = await login(users.student);
    parentToken = await login(users.parent);
    parentBToken = await login(users.parentB);
    instructorToken = await login(users.instructor);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('admin creates a profile linked to the student account and receives an invite code', async () => {
    const res = await send(
      'post',
      '/api/v1/students',
      {
        fullName: 'Nguyen Van B',
        dob: '2005-06-15',
        gender: 'MALE',
        phone: '0901112223',
        address: '45 Tran Hung Dao',
        emergencyContactName: 'Bo B',
        emergencyContactPhone: '0905556667',
        medicalNotes: 'None',
        linkedUserEmail: users.student,
      },
      adminToken,
    ).expect(201);
    studentProfileId = res.body.data.id as string;
    expect(res.body.data.inviteCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(res.body.data.status).toBe('ACTIVE');
  });

  it('student sees their own profile but not others', async () => {
    const me = await get('/api/v1/students/me', studentToken).expect(200);
    expect(me.body.data.fullName).toBe('Nguyen Van B');
    expect(me.body.data.phone).toBe('0901112223');

    const other = await prisma.studentProfile.findFirst({
      where: { id: { not: studentProfileId } },
    });
    if (other !== null) {
      await get(`/api/v1/students/${other.id}`, studentToken).expect(404);
    }
    await get(`/api/v1/students/${studentProfileId}`, studentToken).expect(200);
  });

  it('student cannot use admin-only routes (403), admin can', async () => {
    await get('/api/v1/students', studentToken).expect(403);
    const list = await get('/api/v1/students', adminToken).expect(200);
    expect(list.body.data.total).toBeGreaterThanOrEqual(1);
  });

  it('parent links via the invite code and reads the child (full fields)', async () => {
    const created = await get(`/api/v1/students/${studentProfileId}`, adminToken).expect(200);
    const code = created.body.data as Record<string, unknown>;
    // The invite code is only returned on creation; re-fetch it through the admin list? No:
    // capture from creation above instead — link with a fresh regen code to be explicit.
    const regen = await send(
      'post',
      `/api/v1/students/${studentProfileId}/invite-code`,
      {},
      adminToken,
    ).expect(200);
    void code;
    const inviteCode = regen.body.data.inviteCode as string;

    await send('post', '/api/v1/parents/link', { inviteCode }, parentToken).expect(201);

    const children = await get('/api/v1/parents/me/children', parentToken).expect(200);
    expect(children.body.data).toHaveLength(1);
    expect(children.body.data[0].emergencyContactName).toBe('Bo B');

    // Parent A can now read the child; the rotated code fails for parent B (S-01 path).
    await get(`/api/v1/students/${studentProfileId}`, parentToken).expect(200);
    await send('post', '/api/v1/parents/link', { inviteCode }, parentBToken).expect(404);
    await get(`/api/v1/students/${studentProfileId}`, parentBToken).expect(404);
  });

  it('instructor gets a uniform 404 (no classes exist yet, S-04 semantics)', async () => {
    await get(`/api/v1/students/${studentProfileId}`, instructorToken).expect(404);
  });

  it('admin updates, soft-deletes, and the profile disappears for everyone', async () => {
    await send(
      'patch',
      `/api/v1/students/${studentProfileId}`,
      {
        phone: '0909998887',
        status: 'ACTIVE',
      },
      adminToken,
    ).expect(200);

    const updated = await get(`/api/v1/students/${studentProfileId}`, parentToken).expect(200);
    expect(updated.body.data.phone).toBe('0909998887');

    await send('delete', `/api/v1/students/${studentProfileId}`, {}, adminToken).expect(200);
    await get(`/api/v1/students/${studentProfileId}`, adminToken).expect(404);
    await get(`/api/v1/students/${studentProfileId}`, parentToken).expect(404);
    // The old token is already rejected: soft delete deactivates the linked account.
    await get('/api/v1/students/me', studentToken).expect(401);

    // Deactivated students cannot log in, and a fresh profile would be needed anyway.
    const account = await prisma.user.findUnique({ where: { email: users.student } });
    expect((account as User | null)?.isActive).toBe(false);
  });
});
