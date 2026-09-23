import type { INestApplication } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../../src/bootstrap';

/**
 * Thesis primary value 3 — club activities (plan sections 6, 8; AD-07): the
 * announcement feed with ALL/CLASS audience scoping derived from existing
 * relationship data (enrollment, verified parent link, class instructorship),
 * plus the ADMIN CRUD surface and its audience/classId consistency rules.
 */
describe('Announcements (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const stamp = Date.now();
  const password = 'Str0ngPass';
  const users = {
    admin: `admin-${stamp}@example.com`,
    instructor: `instructor-${stamp}@example.com`,
    instructorB: `instructor-b-${stamp}@example.com`,
    student: `student-${stamp}@example.com`,
    studentB: `student-b-${stamp}@example.com`,
    parent: `parent-${stamp}@example.com`,
    parentB: `parent-b-${stamp}@example.com`,
  };
  let adminToken = '';
  let studentToken = '';
  let studentBToken = '';
  let parentToken = '';
  let parentBToken = '';
  let instructorToken = '';
  let classId = '';
  let otherClassId = '';
  let clubWideId = '';
  let classAnnouncementId = '';

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
      ['studentB', 'STUDENT'],
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

    const instructorId = (
      await prisma.user.findUniqueOrThrow({ where: { email: users.instructor } })
    ).id;
    const suffix = `${stamp}`.slice(-6);
    const inviteCode = (tag: string): string => `${stamp}`.slice(-4).padStart(4, '0') + tag;

    // The enrolled student of the class, plus a verified parent for them.
    const enrolled = await prisma.studentProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { email: users.student } })).id,
        fullName: 'Enrolled Student',
        dob: new Date('2006-01-01'),
        gender: 'MALE',
        status: 'ACTIVE',
        inviteCode: inviteCode('EN'),
        parentLinks: {
          create: {
            parentUserId: (await prisma.user.findUniqueOrThrow({ where: { email: users.parent } }))
              .id,
            verified: true,
          },
        },
      },
    });
    // An unrelated student: must not see class-targeted announcements.
    await prisma.studentProfile.create({
      data: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { email: users.studentB } })).id,
        fullName: 'Other Student',
        dob: new Date('2007-01-01'),
        gender: 'FEMALE',
        status: 'ACTIVE',
        inviteCode: inviteCode('OT'),
      },
    });

    const cls = await prisma.class.create({
      data: { name: `Announcement class ${suffix}`, instructorId, capacity: 30 },
    });
    classId = cls.id;
    const other = await prisma.class.create({
      // Own instructor: nobody from the main cast may hold a relationship to
      // this class, or the "unrelated class" scoping assertion is meaningless
      // (teaching a class IS a relationship per AD-07 §13.6).
      data: {
        name: `Other class ${suffix}`,
        instructorId: (await prisma.user.findUniqueOrThrow({ where: { email: users.instructorB } }))
          .id,
        capacity: 30,
      },
    });
    otherClassId = other.id;
    await prisma.enrollment.create({
      data: { studentId: enrolled.id, classId },
    });

    adminToken = await login(users.admin);
    instructorToken = await login(users.instructor);
    studentToken = await login(users.student);
    studentBToken = await login(users.studentB);
    parentToken = await login(users.parent);
    parentBToken = await login(users.parentB);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('creates a club-wide announcement and rejects non-admin writers', async () => {
    const res = await send(
      'post',
      '/api/v1/announcements',
      {
        title: 'Club trip',
        body: 'A picnic next month. Sign up at the front desk.',
        audience: 'ALL',
      },
      adminToken,
    ).expect(201);
    expect(res.body.data).toMatchObject({ audience: 'ALL', classId: null, className: null });
    clubWideId = res.body.data.id as string;

    await send(
      'post',
      '/api/v1/announcements',
      { title: 'Nope', body: 'Students cannot post', audience: 'ALL' },
      studentToken,
    ).expect(403);
    await send('post', '/api/v1/announcements', {
      title: 'Nope',
      body: 'Anonymous',
      audience: 'ALL',
    }).expect(401);
  });

  it('creates a class announcement and enforces audience/classId consistency', async () => {
    const res = await send(
      'post',
      '/api/v1/announcements',
      {
        title: 'Schedule change',
        body: 'Thursday training moves to 18:30 this week only.',
        audience: 'CLASS',
        classId,
      },
      adminToken,
    ).expect(201);
    expect(res.body.data).toMatchObject({
      audience: 'CLASS',
      classId,
      className: expect.any(String),
    });
    classAnnouncementId = res.body.data.id as string;

    await send(
      'post',
      '/api/v1/announcements',
      { title: 'X', body: 'Y', audience: 'ALL', classId },
      adminToken,
    ).expect(400);
    await send(
      'post',
      '/api/v1/announcements',
      { title: 'X', body: 'Y', audience: 'CLASS' },
      adminToken,
    ).expect(400);
    await send(
      'post',
      '/api/v1/announcements',
      { title: 'X', body: 'Y', audience: 'CLASS', classId: 'not-a-uuid' },
      adminToken,
    ).expect(400);
    await send(
      'post',
      '/api/v1/announcements',
      {
        title: 'X',
        body: 'Y',
        audience: 'CLASS',
        classId: '00000000-0000-4000-8000-000000000000',
      },
      adminToken,
    ).expect(404);
  });

  it('scopes the feed: class announcements reach only related users (plan 8)', async () => {
    // An announcement for a class nobody in this test belongs to.
    await send(
      'post',
      '/api/v1/announcements',
      {
        title: 'Other class only',
        body: 'Secret for the other class.',
        audience: 'CLASS',
        classId: otherClassId,
      },
      adminToken,
    ).expect(201);

    const ids = async (token: string): Promise<string[]> => {
      const res = await get('/api/v1/announcements?limit=100', token).expect(200);
      return (res.body.data.items as Array<{ id: string }>).map((i) => i.id);
    };

    const adminFeed = await ids(adminToken);
    expect(adminFeed).toContain(clubWideId);
    expect(adminFeed).toContain(classAnnouncementId);

    for (const token of [instructorToken, studentToken, parentToken]) {
      const feed = await ids(token);
      expect(feed).toContain(clubWideId);
      expect(feed).toContain(classAnnouncementId);
      expect(feed).not.toContain(
        (
          await prisma.announcement.findFirstOrThrow({
            where: { classId: otherClassId },
            select: { id: true },
          })
        ).id,
      );
    }

    for (const token of [studentBToken, parentBToken]) {
      const feed = await ids(token);
      expect(feed).toContain(clubWideId);
      expect(feed).not.toContain(classAnnouncementId);
    }
  });

  it('paginates the feed with the standard envelope', async () => {
    const res = await get('/api/v1/announcements?page=1&limit=1', studentToken).expect(200);
    expect(res.body.data.total).toBeGreaterThanOrEqual(2);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.page).toBe(1);
    expect(res.body.data.limit).toBe(1);
  });

  it('updates announcements and keeps audience/classId consistent', async () => {
    const retargeted = await send(
      'patch',
      `/api/v1/announcements/${clubWideId}`,
      { title: 'Club trip (updated)' },
      adminToken,
    ).expect(200);
    expect(retargeted.body.data.title).toBe('Club trip (updated)');

    const toAll = await send(
      'patch',
      `/api/v1/announcements/${classAnnouncementId}`,
      { audience: 'ALL' },
      adminToken,
    ).expect(200);
    expect(toAll.body.data).toMatchObject({ audience: 'ALL', classId: null });

    await send('patch', '/api/v1/announcements/not-a-uuid', { title: 'X' }, adminToken).expect(400);
    await send(
      'patch',
      '/api/v1/announcements/00000000-0000-4000-8000-000000000000',
      { title: 'X' },
      adminToken,
    ).expect(404);
    await send('patch', `/api/v1/announcements/${clubWideId}`, { title: 'X' }, studentToken).expect(
      403,
    );
  });

  it('deletes announcements (admin only) with the uniform 404', async () => {
    await send('delete', `/api/v1/announcements/${clubWideId}`, {}, studentToken).expect(403);
    await send('delete', `/api/v1/announcements/${clubWideId}`, {}, adminToken).expect(200);
    await send('delete', `/api/v1/announcements/${clubWideId}`, {}, adminToken).expect(404);
    await send('delete', '/api/v1/announcements/not-a-uuid', {}, adminToken).expect(400);

    const feed = await get('/api/v1/announcements', studentBToken).expect(200);
    expect((feed.body.data.items as Array<{ id: string }>).some((i) => i.id === clubWideId)).toBe(
      false,
    );
  });
});
