import type { INestApplication } from '@nestjs/common';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from '../../src/bootstrap';
import { extractToken, readMailLog } from '../e2e/helpers/mail-log';

/**
 * S-07 (plan 12.1): unknown user / wrong password / locked / disabled / unverified
 * all return the SAME uniform 401; locked, disabled and unverified states
 * additionally send an out-of-band email.
 */
describe('S-07: uniform login failures (e2e)', () => {
  let app: INestApplication;
  let mailFile: string;
  const stamp = Date.now();
  const verified = { email: `s07-verified-${stamp}@example.com`, password: 'Str0ngPass' };
  const unverified = { email: `s07-unverified-${stamp}@example.com`, password: 'Str0ngPass' };
  const locked = { email: `s07-locked-${stamp}@example.com`, password: 'Str0ngPass' };
  const deactivated = { email: `s07-deactivated-${stamp}@example.com`, password: 'Str0ngPass' };
  const UNIFORM_401 = { code: 401, message: 'Invalid email or password', data: null };

  const post = (url: string, body: unknown) =>
    request(app.getHttpServer())
      .post(url)
      .set('Content-Type', 'application/json')
      .send(body as object);

  const registerAndVerify = async (account: { email: string; password: string }): Promise<void> => {
    await post('/api/v1/auth/register', {
      email: account.email,
      password: account.password,
      role: 'PARENT',
      fullName: 'S Seven',
      dateOfBirth: '1990-01-01',
    }).expect(201);
    const token = extractToken(readMailLog(mailFile), account.email, 'VERIFY_EMAIL');
    await post('/api/v1/auth/verify-email', { token }).expect(201);
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

  it('verified, unverified, locked and deactivated accounts all answer the same 401', async () => {
    await registerAndVerify(verified);
    await post('/api/v1/auth/register', {
      email: unverified.email,
      password: unverified.password,
      role: 'PARENT',
      fullName: 'S Seven',
      dateOfBirth: '1990-01-01',
    }).expect(201);
    await registerAndVerify(locked);
    await registerAndVerify(deactivated);

    const deactivatedLogin = await post('/api/v1/auth/login', {
      email: deactivated.email,
      password: deactivated.password,
    }).expect(200);
    const deactivatedToken = deactivatedLogin.body.data.tokens.accessToken as string;
    await post('/api/v1/auth/deactivate', { password: deactivated.password })
      .set('Authorization', `Bearer ${deactivatedToken}`)
      .expect(200);

    // Lock the third account with 5 consecutive wrong passwords.
    for (let i = 0; i < 5; i += 1) {
      await post('/api/v1/auth/login', { email: locked.email, password: 'Wrong9999' }).expect(401);
    }

    const attempts: Array<[string, string]> = [
      ['ghost-user@example.com', 'Whatever1'], // unknown account
      [verified.email, 'Wrong9999'], // wrong password
      [locked.email, locked.password], // locked
      [deactivated.email, deactivated.password], // deactivated
      [unverified.email, unverified.password], // unverified
    ];
    for (const [email, password] of attempts) {
      const response = await post('/api/v1/auth/login', { email, password }).expect(401);
      expect(response.body).toEqual(UNIFORM_401);
    }

    const mails = readMailLog(mailFile);
    expect(
      mails.some((m) => m.to === locked.email && m.templateCode === 'LOGIN_BLOCKED_LOCKED'),
    ).toBe(true);
    expect(
      mails.some((m) => m.to === deactivated.email && m.templateCode === 'LOGIN_BLOCKED_DISABLED'),
    ).toBe(true);
    expect(
      mails.some((m) => m.to === unverified.email && m.templateCode === 'LOGIN_BLOCKED_UNVERIFIED'),
    ).toBe(true);
  });
});

/**
 * S-09: forgot-password answers identically for existing and non-existing emails,
 * with a timing delta far below any bcrypt-dominated path.
 */
describe('S-09: forgot-password anti-enumeration (e2e)', () => {
  let app: INestApplication;
  const stamp = Date.now();
  const existing = `s09-existing-${stamp}@example.com`;

  const post = (url: string, body: unknown) =>
    request(app.getHttpServer())
      .post(url)
      .set('Content-Type', 'application/json')
      .send(body as object);

  beforeAll(async () => {
    if (process.env.DATABASE_URL === undefined || process.env.DATABASE_URL === '') {
      throw new Error('DATABASE_URL must be set for e2e tests');
    }
    app = await createApp();
    await app.init();
    await post('/api/v1/auth/register', {
      email: existing,
      password: 'Str0ngPass',
      role: 'PARENT',
      fullName: 'S Nine',
      dateOfBirth: '1990-01-01',
    }).expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers identically and quickly for both cases', async () => {
    const runs = 5;
    const startExisting = process.hrtime.bigint();
    let existingBody: unknown;
    for (let i = 0; i < runs; i += 1) {
      const response = await post('/api/v1/auth/forgot-password', { email: existing }).expect(200);
      existingBody = response.body;
    }
    const elapsedExistingMs = Number(process.hrtime.bigint() - startExisting) / 1_000_000 / runs;

    const startUnknown = process.hrtime.bigint();
    let unknownBody: unknown;
    for (let i = 0; i < runs; i += 1) {
      const response = await post('/api/v1/auth/forgot-password', {
        email: `ghost-${stamp}@example.com`,
      }).expect(200);
      unknownBody = response.body;
    }
    const elapsedUnknownMs = Number(process.hrtime.bigint() - startUnknown) / 1_000_000 / runs;

    expect(existingBody).toEqual({ code: 200, message: 'OK', data: { sent: true } });
    expect(unknownBody).toEqual(existingBody);
    // Both paths avoid bcrypt entirely; the delta must stay negligible.
    expect(Math.abs(elapsedExistingMs - elapsedUnknownMs)).toBeLessThan(50);
  });
});
