import type { INestApplication } from '@nestjs/common';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from '../../src/bootstrap';
import { extractToken, readMailLog } from '../e2e/helpers/mail-log';

/**
 * S-08 (plan 12.1): replaying an already-rotated refresh token revokes ALL of the
 * user's sessions (both in this test) and triggers the out-of-band reuse alert.
 * S-12: an access token denylisted by logout is rejected afterwards.
 */
describe('S-08 refresh replay and S-12 logout denylist (e2e)', () => {
  let app: INestApplication;
  let mailFile: string;
  const stamp = Date.now();
  const account = { email: `s08-s12-${stamp}@example.com`, password: 'Str0ngPass' };

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
    await post('/api/v1/auth/register', {
      email: account.email,
      password: account.password,
      role: 'PARENT',
      fullName: 'S Eight',
      dateOfBirth: '1990-01-01',
    }).expect(201);
    const verifyToken = extractToken(readMailLog(mailFile), account.email, 'VERIFY_EMAIL');
    await post('/api/v1/auth/verify-email', { token: verifyToken }).expect(201);
  });

  afterAll(async () => {
    await app.close();
    rmSync(mailFile, { force: true });
    delete process.env.MAIL_LOG_FILE;
  });

  it('revokes every session when a rotated refresh token is replayed', async () => {
    // Two independent sessions.
    const loginA = await post('/api/v1/auth/login', {
      email: account.email,
      password: account.password,
    }).expect(200);
    const loginB = await post('/api/v1/auth/login', {
      email: account.email,
      password: account.password,
    }).expect(200);
    const tokenA = loginA.body.data.tokens.accessToken as string;
    const refreshA = loginA.body.data.tokens.refreshToken as string;
    const tokenB = loginB.body.data.tokens.accessToken as string;

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    // Rotate session A, then replay the consumed refresh token.
    const rotated = await post('/api/v1/auth/refresh-token', { refreshToken: refreshA }).expect(
      200,
    );
    expect(rotated.body.data.refreshToken).not.toBe(refreshA);
    await post('/api/v1/auth/refresh-token', { refreshToken: refreshA }).expect(401);

    // Every session of the user is gone, including untouched session B.
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(401);
  });

  it('rejects the access token after logout via the jti denylist (S-12)', async () => {
    const login = await post('/api/v1/auth/login', {
      email: account.email,
      password: account.password,
    }).expect(200);
    const { accessToken } = login.body.data.tokens;

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    await post('/api/v1/auth/logout', {}, accessToken).expect(200);

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
  });
});
