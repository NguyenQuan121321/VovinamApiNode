import type { INestApplication } from '@nestjs/common';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../../src/bootstrap';
import { enrollTotp } from './helpers/mfa';
import { AuditService } from '../../src/auth/audit/audit.service';
import { readMailLog } from './helpers/mail-log';

/**
 * P5 acceptance (plan 7.6, 7.1, section 10): notification outbox + in-app feed
 * + email delivery through the worker, and purpose-specific consent including
 * parent-proxy consent for a linked minor. Covers the ownership 404 posture on
 * both resources (plan 7.3 applied to notifications/consent).
 */
describe('Notifications and consent (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const stamp = Date.now();
  const password = 'Str0ngPass';
  const users = {
    admin: `admin-${stamp}@example.com`,
    student: `student-${stamp}@example.com`,
    parent: `parent-${stamp}@example.com`,
    parentB: `parent-b-${stamp}@example.com`,
    minor: `minor-${stamp}@example.com`,
    adultChild: `adult-child-${stamp}@example.com`,
  };
  let adminToken = '';
  let studentToken = '';
  let parentToken = '';
  let parentBToken = '';
  let minorToken = '';
  let minorProfileId = '';
  let adultChildProfileId = '';
  let noAccountProfileId = '';
  let minorNotificationId = '';
  let mailDir = '';
  let mailFile = '';

  const get = (url: string, token?: string) => {
    const req = request(app.getHttpServer()).get(url);
    return token === undefined ? req : req.set('Authorization', `Bearer ${token}`);
  };
  const send = (method: 'post' | 'patch', url: string, body: unknown, token?: string) => {
    const agent = request(app.getHttpServer());
    const req = method === 'post' ? agent.post(url) : agent.patch(url);
    const withAuth = token === undefined ? req : req.set('Authorization', `Bearer ${token}`);
    return withAuth.set('Content-Type', 'application/json').send(body as object);
  };
  const login = async (email: string): Promise<string> => {
    const res = await send('post', '/api/v1/auth/login', { email, password }).expect(200);
    return res.body.data.tokens.accessToken as string;
  };
  const userId = async (email: string): Promise<string> => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    return user.id;
  };

  beforeAll(async () => {
    if (process.env.DATABASE_URL === undefined || process.env.DATABASE_URL === '') {
      throw new Error('DATABASE_URL must be set for e2e tests');
    }
    mailDir = mkdtempSync(join(tmpdir(), `notif-${stamp}-`));
    mailFile = join(mailDir, 'mail.log');
    process.env.MAIL_LOG_FILE = mailFile;

    app = await createApp();
    await app.init();
    prisma = new PrismaClient();

    const passwordHash = await bcrypt.hash(password, 10);
    const rows: Array<[keyof typeof users, 'ADMIN' | 'STUDENT' | 'PARENT']> = [
      ['admin', 'ADMIN'],
      ['student', 'STUDENT'],
      ['parent', 'PARENT'],
      ['parentB', 'PARENT'],
      ['minor', 'STUDENT'],
      ['adultChild', 'STUDENT'],
    ];
    for (const [key, role] of rows) {
      await prisma.user.upsert({
        where: { email: users[key] },
        update: {},
        create: { email: users[key], passwordHash, role, emailVerifiedAt: new Date() },
      });
    }
    const parentId = await userId(users.parent);
    // student_profiles.invite_code is required (8 chars, unique, plan 7.1).
    const inviteCode = (suffix: string): string => `${stamp}`.slice(-4).padStart(4, '0') + suffix;

    // A linked MINOR with their own account: parent-proxy consent applies.
    const minorProfile = await prisma.studentProfile.create({
      data: {
        userId: await userId(users.minor),
        fullName: 'Minor Child',
        dob: new Date('2014-05-01'),
        gender: 'MALE',
        status: 'ACTIVE',
        inviteCode: inviteCode('MA'),
        parentLinks: {
          create: { parentUserId: parentId, verified: true, verifiedByUserId: parentId },
        },
      },
    });
    minorProfileId = minorProfile.id;

    // A linked ADULT child: parent-proxy consent must be rejected.
    const adultProfile = await prisma.studentProfile.create({
      data: {
        userId: await userId(users.adultChild),
        fullName: 'Adult Child',
        dob: new Date('2000-01-01'),
        gender: 'FEMALE',
        status: 'ACTIVE',
        inviteCode: inviteCode('AD'),
        parentLinks: {
          create: { parentUserId: parentId, verified: true, verifiedByUserId: parentId },
        },
      },
    });
    adultChildProfileId = adultProfile.id;

    // A linked minor WITHOUT an account: no consent subject exists.
    const noAccount = await prisma.studentProfile.create({
      data: {
        fullName: 'No Account Minor',
        dob: new Date('2015-03-01'),
        gender: 'MALE',
        status: 'ACTIVE',
        inviteCode: inviteCode('NA'),
        parentLinks: {
          create: { parentUserId: parentId, verified: true, verifiedByUserId: parentId },
        },
      },
    });
    noAccountProfileId = noAccount.id;

    adminToken = await login(users.admin);
    await enrollTotp(app, adminToken);
    studentToken = await login(users.student);
    parentToken = await login(users.parent);
    parentBToken = await login(users.parentB);
    minorToken = await login(users.minor);
  });

  afterAll(async () => {
    delete process.env.MAIL_LOG_FILE;
    await app.close();
    await prisma.$disconnect();
    rmSync(mailDir, { recursive: true, force: true });
  });

  describe('consent (plan sections 6, 7.1, 10)', () => {
    it('grants self consent and audits it', async () => {
      const res = await send(
        'post',
        '/api/v1/consent',
        { purpose: 'DATA_PROCESSING' },
        studentToken,
      ).expect(201);
      expect(res.body.data.active).toBe(true);
      expect(res.body.data.consentedByUserId).toBeNull();
      // Audit writes are batched asynchronously; drain before asserting.
      await app.get(AuditService).flush();
      const audit = await get('/api/v1/auth/me/audit-log?limit=50', studentToken).expect(200);
      const events = (audit.body.data.items as Array<{ event: string }>).map((r) => r.event);
      expect(events).toContain('consent_granted');
    });

    it('re-granting an active purpose is idempotent', async () => {
      const res = await send(
        'post',
        '/api/v1/consent',
        { purpose: 'DATA_PROCESSING' },
        studentToken,
      ).expect(201);
      expect(res.body.data.alreadyActive).toBe(true);
    });

    it('lists own history with revoked rows included', async () => {
      const res = await get('/api/v1/consent/me', studentToken).expect(200);
      const items = res.body.data.items as Array<{ purpose: string; active: boolean }>;
      expect(items.some((i) => i.purpose === 'DATA_PROCESSING' && i.active)).toBe(true);
    });

    it('records a verified parent as the actor consenting for a linked minor', async () => {
      const res = await send(
        'post',
        '/api/v1/consent',
        { purpose: 'MEDIA_USAGE', studentId: minorProfileId },
        parentToken,
      ).expect(201);
      expect(res.body.data.consentedByUserId).toBe(await userId(users.parent));
      const own = await get('/api/v1/consent/me', minorToken).expect(200);
      const items = own.body.data.items as Array<{ purpose: string }>;
      expect(items.some((i) => i.purpose === 'MEDIA_USAGE')).toBe(true);
    });

    it('rejects parent consent for an adult child (adults consent for themselves)', async () => {
      await send(
        'post',
        '/api/v1/consent',
        { purpose: 'MEDIA_USAGE', studentId: adultChildProfileId },
        parentToken,
      ).expect(400);
    });

    it('rejects consent for a minor without an account (no subject to hold it)', async () => {
      await send(
        'post',
        '/api/v1/consent',
        { purpose: 'MEDIA_USAGE', studentId: noAccountProfileId },
        parentToken,
      ).expect(400);
    });

    it('answers the uniform 404 for an unlinked parent (S-01 posture)', async () => {
      await send(
        'post',
        '/api/v1/consent',
        { purpose: 'MEDIA_USAGE', studentId: minorProfileId },
        parentBToken,
      ).expect(404);
    });

    it('revokes the active consent and keeps it in history', async () => {
      await send(
        'post',
        '/api/v1/consent/revoke',
        { purpose: 'DATA_PROCESSING' },
        studentToken,
      ).expect(200);
      const own = await get('/api/v1/consent/me', studentToken).expect(200);
      const items = own.body.data.items as Array<{ purpose: string; active: boolean }>;
      expect(items.some((i) => i.purpose === 'DATA_PROCESSING' && !i.active)).toBe(true);
      expect(items.some((i) => i.purpose === 'DATA_PROCESSING' && i.active)).toBe(false);
    });

    it('answers 404 when there is no active consent to revoke', async () => {
      await send(
        'post',
        '/api/v1/consent/revoke',
        { purpose: 'DATA_PROCESSING' },
        studentToken,
      ).expect(404);
    });

    it('requires authentication', async () => {
      await send('post', '/api/v1/consent', { purpose: 'DATA_PROCESSING' }).expect(401);
    });
  });

  describe('notifications (plan 7.6, 8)', () => {
    it('enqueues INAPP + EMAIL rows atomically when an invoice is issued', async () => {
      const res = await send(
        'post',
        '/api/v1/invoices',
        {
          studentId: minorProfileId,
          type: 'UNIFORM',
          items: [{ description: 'Club uniform', quantity: 1, unitAmount: 200000 }],
        },
        adminToken,
      ).expect(201);
      expect(res.body.data.invoiceNo).toMatch(/^INV-\d{4}-\d{4}$/);

      const feed = await get('/api/v1/notifications/me', minorToken).expect(200);
      const items = feed.body.data.items as Array<{
        id: string;
        templateCode: string;
        readAt: string | null;
      }>;
      const issued = items.find((i) => i.templateCode === 'invoice_issued');
      expect(issued).toBeDefined();
      expect(issued?.readAt).toBeNull();
      minorNotificationId = issued?.id ?? '';
    });

    it('paginates the feed with the standard envelope', async () => {
      const feed = await get('/api/v1/notifications/me?page=1&limit=1', minorToken).expect(200);
      expect(feed.body.data.total).toBeGreaterThanOrEqual(1);
      expect(feed.body.data.items).toHaveLength(1);
      expect(feed.body.data.page).toBe(1);
      expect(feed.body.data.limit).toBe(1);
    });

    it('marks an own notification read, idempotently', async () => {
      const first = await send(
        'patch',
        `/api/v1/notifications/${minorNotificationId}/read`,
        {},
        minorToken,
      ).expect(200);
      expect(first.body.data.readAt).not.toBeNull();
      const second = await send(
        'patch',
        `/api/v1/notifications/${minorNotificationId}/read`,
        {},
        minorToken,
      ).expect(200);
      expect(second.body.data.readAt).toBe(first.body.data.readAt);
    });

    it('answers the uniform 404 for a foreign notification id', async () => {
      await send(
        'patch',
        `/api/v1/notifications/${minorNotificationId}/read`,
        {},
        parentBToken,
      ).expect(404);
      await get('/api/v1/notifications/me', minorToken).expect(200);
    });

    it('rejects a malformed notification id with 400 (not 500)', async () => {
      await send('patch', '/api/v1/notifications/not-a-uuid/read', {}, minorToken).expect(400);
    });

    it('delivers the queued EMAIL row through the worker flush', async () => {
      await send('post', '/api/v1/admin/notifications/flush', {}, adminToken).expect(200);
      const mails = readMailLog(mailFile);
      const delivered = mails.filter(
        (mail) => mail.to === users.minor && mail.templateCode === 'invoice_issued',
      );
      expect(delivered).toHaveLength(1);
      const row = await prisma.notification.findFirst({
        where: { userId: await userId(users.minor), channel: 'EMAIL' },
        orderBy: { createdAt: 'desc' },
      });
      expect(row?.status).toBe('SENT');
    });

    it('restricts the worker flush to admins', async () => {
      await send('post', '/api/v1/admin/notifications/flush', {}, studentToken).expect(403);
      await send('post', '/api/v1/admin/notifications/flush', {}).expect(401);
    });

    it('keeps other users out of the feed', async () => {
      const feed = await get('/api/v1/notifications/me', parentBToken).expect(200);
      const items = feed.body.data.items as Array<{ templateCode: string }>;
      expect(items.some((i) => i.templateCode === 'invoice_issued')).toBe(false);
    });
  });
});
