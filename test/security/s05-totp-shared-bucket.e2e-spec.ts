import type { INestApplication } from '@nestjs/common';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authenticator } from 'otplib';
import request from 'supertest';
import { createApp } from '../../src/bootstrap';
import { extractToken, readMailLog } from '../e2e/helpers/mail-log';

/**
 * S-05 (plan 12.1): the failure bucket is SHARED between mfa/totp/validate and
 * mfa/login-verify — five wrong codes in five minutes lock both paths, even for
 * a subsequently CORRECT code.
 */
describe('S-05: shared TOTP failure bucket (e2e)', () => {
  let app: INestApplication;
  let mailFile: string;

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

  it('locks validate and login-verify together after five wrong codes', async () => {
    const stamp = Date.now();
    const email = `s05-${stamp}@example.com`;
    await post('/api/v1/auth/register', {
      email,
      password: 'Str0ngPass',
      role: 'PARENT',
      fullName: 'S Five',
      dateOfBirth: '1990-01-01',
    }).expect(201);
    const verifyToken = extractToken(readMailLog(mailFile), email, 'VERIFY_EMAIL');
    await post('/api/v1/auth/verify-email', { token: verifyToken }).expect(201);

    const login = await post('/api/v1/auth/login', { email, password: 'Str0ngPass' }).expect(200);
    const accessToken = login.body.data.tokens.accessToken as string;

    // Enroll TOTP: enable -> confirm with a real code -> 10 recovery codes once.
    const enrollment = await post('/api/v1/auth/mfa/totp/enable', {}, accessToken).expect(201);
    const secret = /secret=([^&]+)/.exec(enrollment.body.data.otpauthUrl)?.[1];
    expect(secret).toBeDefined();
    const confirmCode = authenticator.generate(secret as string);
    const confirmed = await post(
      '/api/v1/auth/mfa/totp/verify',
      { code: confirmCode },
      accessToken,
    ).expect(201);
    expect(confirmed.body.data.recoveryCodes).toHaveLength(10);

    // Fresh login now requires MFA instead of issuing tokens.
    const mfaLogin = await post('/api/v1/auth/login', { email, password: 'Str0ngPass' }).expect(
      200,
    );
    expect(mfaLogin.body.data.mfaRequired).toBe(true);
    const mfaToken = mfaLogin.body.data.mfaToken as string;

    // Four wrong codes on login-verify (bucket: 4), then a 5th wrong code via
    // /validate trips the shared bucket — and a 6th, CORRECT code is blocked
    // on both paths afterwards.
    for (let i = 0; i < 4; i += 1) {
      await post('/api/v1/auth/mfa/login-verify', { mfaToken, code: '000000' }).expect(401);
    }
    await post('/api/v1/auth/mfa/totp/validate', { code: '000000' }, accessToken).expect(401);

    const correctCode = authenticator.generate(secret as string);
    const blockedVerify = await post('/api/v1/auth/mfa/login-verify', {
      mfaToken,
      code: correctCode,
    }).expect(401);
    expect(blockedVerify.body.message).toBe('Too many verification attempts');
    const blockedValidate = await post(
      '/api/v1/auth/mfa/totp/validate',
      { code: correctCode },
      accessToken,
    ).expect(401);
    expect(blockedValidate.body.message).toBe('Too many verification attempts');
  });
});
