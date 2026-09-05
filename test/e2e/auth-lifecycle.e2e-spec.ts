import type { INestApplication } from '@nestjs/common';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from '../../src/bootstrap';
import { extractToken, readMailLog } from './helpers/mail-log';

describe('Auth lifecycle (e2e)', () => {
  let app: INestApplication;
  let mailFile: string;
  const stamp = Date.now();
  const parent = { email: `parent-${stamp}@example.com`, password: 'Str0ngPass' };

  const post = (url: string, body: unknown, token?: string) => {
    const req = request(app.getHttpServer()).post(url).set('Content-Type', 'application/json');
    return token === undefined
      ? req.send(body as object)
      : req.set('Authorization', `Bearer ${token}`).send(body as object);
  };

  beforeAll(async () => {
    if (process.env.DATABASE_URL === undefined || process.env.DATABASE_URL === '') {
      throw new Error('DATABASE_URL must be set for e2e tests');
    }
    mailFile = join(mkdtempSync(join(tmpdir(), 'vovinam-mail-')), 'mail.log');
    process.env.MAIL_LOG_FILE = mailFile;
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    rmSync(mailFile, { force: true });
    delete process.env.MAIL_LOG_FILE;
  });

  it('registers, verifies, logs in and reads /auth/me', async () => {
    const registered = await post('/api/v1/auth/register', {
      email: parent.email,
      password: parent.password,
      role: 'PARENT',
      fullName: 'Phu Huynh',
      dateOfBirth: '1990-05-10',
    }).expect(201);
    expect(registered.body.data).toEqual({
      email: parent.email,
      requiresVerification: true,
    });

    // Login before verification is a uniform 401.
    await post('/api/v1/auth/login', { email: parent.email, password: parent.password }).expect(
      401,
    );

    const token = extractToken(readMailLog(mailFile), parent.email, 'VERIFY_EMAIL');
    await post('/api/v1/auth/verify-email', { token }).expect(201);

    const login = await post('/api/v1/auth/login', {
      email: parent.email,
      password: parent.password,
    }).expect(200);
    expect(login.body.data.mfaRequired).toBe(false);
    const { accessToken, refreshToken } = login.body.data.tokens;
    expect(accessToken).toBeDefined();
    expect(refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(me.body.data.email).toBe(parent.email);
    expect(me.body.data.mfaEnabled).toBe(false);

    const sessions = await request(app.getHttpServer())
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(sessions.body.data).toHaveLength(1);
  });

  it('rotates refresh tokens and rejects the consumed one', async () => {
    const login = await post('/api/v1/auth/login', {
      email: parent.email,
      password: parent.password,
    }).expect(200);
    const { accessToken, refreshToken } = login.body.data.tokens;

    const rotated = await post('/api/v1/auth/refresh-token', { refreshToken }).expect(200);
    expect(rotated.body.data.refreshToken).not.toBe(refreshToken);

    // The old (consumed) token is now a replay: revoked everywhere.
    await post('/api/v1/auth/refresh-token', { refreshToken }).expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
  });

  it('change-password invalidates old sessions and works with the new password', async () => {
    const login = await post('/api/v1/auth/login', {
      email: parent.email,
      password: parent.password,
    }).expect(200);
    const { accessToken } = login.body.data.tokens;

    await post('/api/v1/auth/change-password', {
      currentPassword: parent.password,
      newPassword: 'NewStr0ng',
    })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
    await post('/api/v1/auth/login', { email: parent.email, password: parent.password }).expect(
      401,
    );
    await post('/api/v1/auth/login', { email: parent.email, password: 'NewStr0ng' }).expect(200);
  });

  it('change-email is two-step: token mailed to the new address only', async () => {
    const login = await post('/api/v1/auth/login', {
      email: parent.email,
      password: 'NewStr0ng',
    }).expect(200);
    const { accessToken } = login.body.data.tokens;

    await post('/api/v1/auth/change-email/request', {
      currentPassword: 'NewStr0ng',
      newEmail: `parent-new-${stamp}@example.com`,
    })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);

    const confirmToken = extractToken(
      readMailLog(mailFile),
      `parent-new-${stamp}@example.com`,
      'CHANGE_EMAIL',
    );
    await post('/api/v1/auth/change-email/confirm', { token: confirmToken }).expect(201);

    const newEmail = `parent-new-${stamp}@example.com`;
    await post('/api/v1/auth/login', { email: newEmail, password: 'NewStr0ng' }).expect(200);
    await post('/api/v1/auth/login', { email: parent.email, password: 'NewStr0ng' }).expect(401);
  });

  it('deactivate soft-deletes the account and blocks future logins', async () => {
    const newEmail = `parent-new-${stamp}@example.com`;
    const login = await post('/api/v1/auth/login', {
      email: newEmail,
      password: 'NewStr0ng',
    }).expect(200);
    const { accessToken } = login.body.data.tokens;

    await post('/api/v1/auth/deactivate', { password: 'NewStr0ng' })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
    await post('/api/v1/auth/login', { email: newEmail, password: 'NewStr0ng' }).expect(401);
  });
});
