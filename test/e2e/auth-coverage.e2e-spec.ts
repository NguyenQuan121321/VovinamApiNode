import type { INestApplication } from '@nestjs/common';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authenticator } from 'otplib';
import request from 'supertest';
import { createApp } from '../../src/bootstrap';
import { AuditService } from '../../src/auth/audit/audit.service';
import { extractToken, readMailLog } from './helpers/mail-log';

/**
 * Closes the e2e coverage gaps left by the lifecycle spec: resend-verification,
 * reset-password, logout-all, per-session revocation, audit log, MFA methods/
 * recovery-codes/disable, and account deletion via DELETE /auth/me.
 */
describe('Auth endpoint coverage (e2e)', () => {
  let app: INestApplication;
  let mailFile: string;
  const stamp = Date.now();
  const password = 'Str0ngPass';
  const user = { email: `cov-${stamp}@example.com`, password };
  const other = { email: `cov-other-${stamp}@example.com`, password };
  let accessToken = '';

  const post = (url: string, body: unknown, token?: string) => {
    const req = request(app.getHttpServer()).post(url).set('Content-Type', 'application/json');
    return token === undefined
      ? req.send(body as object)
      : req.set('Authorization', `Bearer ${token}`).send(body as object);
  };
  const get = (url: string, token?: string) => {
    const req = request(app.getHttpServer()).get(url);
    return token === undefined ? req : req.set('Authorization', `Bearer ${token}`);
  };
  const del = (url: string, body: unknown, token?: string) =>
    request(app.getHttpServer())
      .delete(url)
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${token ?? ''}`)
      .send(body as object);

  const sidOf = (jwt: string): string => {
    const payloadB64 = jwt.split('.')[1];
    if (payloadB64 === undefined) {
      throw new Error('Malformed JWT');
    }
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString()) as {
      sid: string;
    };
    return payload.sid;
  };

  const registerVerified = async (email: string): Promise<void> => {
    await post('/api/v1/auth/register', {
      email,
      password,
      role: 'PARENT',
      fullName: 'Coverage',
      dateOfBirth: '1990-01-01',
    }).expect(201);
    const verifyToken = extractToken(readMailLog(mailFile), email, 'VERIFY_EMAIL');
    await post('/api/v1/auth/verify-email', { token: verifyToken }).expect(201);
  };

  const login = async (email: string, pwd = password): Promise<string> => {
    const res = await post('/api/v1/auth/login', { email, password: pwd }).expect(200);
    return res.body.data.tokens.accessToken as string;
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

  it('resend-verification answers uniformly and re-mails a working token', async () => {
    await post('/api/v1/auth/register', {
      email: user.email,
      password,
      role: 'PARENT',
      fullName: 'Coverage',
      dateOfBirth: '1990-01-01',
    }).expect(201);

    const known = await post('/api/v1/auth/resend-verification', { email: user.email }).expect(200);
    const unknown = await post('/api/v1/auth/resend-verification', {
      email: `nobody-${stamp}@example.com`,
    }).expect(200);
    // Anti-enumeration: identical response regardless of account existence (plan 5.1).
    expect(known.body).toEqual(unknown.body);

    const token = extractToken(readMailLog(mailFile), user.email, 'VERIFY_EMAIL');
    await post('/api/v1/auth/verify-email', { token }).expect(201);
    accessToken = await login(user.email);
  });

  it('exposes the audit log of the account', async () => {
    // Audit writes are batched asynchronously (plan 4.1) — force the flush first.
    await app.get(AuditService).flush();
    const res = await get('/api/v1/auth/me/audit-log', accessToken).expect(200);
    const events = (res.body.data.items as Array<{ event: string }>).map((e) => e.event);
    expect(events).toContain('register');
    expect(events).toContain('login');
  });

  it('revokes exactly one session via DELETE /auth/sessions/:id', async () => {
    const secondToken = await login(user.email);
    const sid = sidOf(secondToken);

    const listed = await get('/api/v1/auth/sessions', accessToken).expect(200);
    expect((listed.body.data as Array<{ id: string }>).map((s) => s.id)).toContain(sid);

    await del(`/api/v1/auth/sessions/${sid}`, {}, accessToken).expect(200);
    await get('/api/v1/auth/me', secondToken).expect(401);
    await get('/api/v1/auth/me', accessToken).expect(200);
    // Unknown or foreign session ids answer the uniform 401 — no existence disclosure.
    await del(`/api/v1/auth/sessions/00000000-0000-4000-8000-000000000000`, {}, accessToken).expect(
      401,
    );
  });

  it('logout-all kills every session at once', async () => {
    const tokenA = await login(user.email);
    const tokenB = await login(user.email);
    await post('/api/v1/auth/logout-all', {}, tokenA).expect(200);
    await get('/api/v1/auth/me', tokenA).expect(401);
    await get('/api/v1/auth/me', tokenB).expect(401);
    accessToken = await login(user.email);
  });

  it('mfa/methods, recovery-codes and totp/disable complete the MFA surface', async () => {
    expect(
      await get('/api/v1/auth/mfa/methods', accessToken)
        .expect(200)
        .then((r) => r.body.data),
    ).toEqual([{ type: 'totp', enabled: false }]);

    const enrollment = await post('/api/v1/auth/mfa/totp/enable', {}, accessToken).expect(201);
    const secret = /secret=([^&]+)/.exec(enrollment.body.data.otpauthUrl)?.[1];
    await post(
      '/api/v1/auth/mfa/totp/verify',
      { code: authenticator.generate(secret as string) },
      accessToken,
    ).expect(201);

    expect(
      await get('/api/v1/auth/mfa/totp/recovery-codes', accessToken)
        .expect(200)
        .then((r) => r.body.data),
    ).toEqual({ remaining: 10 });

    // Disable with the code of the NEXT time step: authenticator.generate would
    // re-issue the same 6 digits used by /verify within this 30s window and trip
    // the 120s replay guard. verifyCode accepts a +/-1 step window. The verifier
    // is built exactly like TotpService.verifyCode builds its own (create resets
    // plugin options, so the singleton options must be spread in).
    const nextStepVerifier = authenticator.create({
      ...authenticator.options,
      window: 1,
      epoch: Date.now() + 30_000,
    });
    const nextStepCode = nextStepVerifier.generate(secret as string);
    await post(
      '/api/v1/auth/mfa/totp/disable',
      { code: nextStepCode, password },
      accessToken,
    ).expect(201);
    // Disabling MFA revokes every session (sensitive operation) — re-login.
    accessToken = await login(user.email);
    expect(
      await get('/api/v1/auth/mfa/methods', accessToken)
        .expect(200)
        .then((r) => r.body.data),
    ).toEqual([{ type: 'totp', enabled: false }]);
  });

  it('reset-password works through the mailed single-use token', async () => {
    await post('/api/v1/auth/forgot-password', { email: user.email }).expect(200);
    await post('/api/v1/auth/forgot-password', { email: `nobody-${stamp}@example.com` }).expect(
      200,
    );

    const token = extractToken(readMailLog(mailFile), user.email, 'RESET_PASSWORD');
    await post('/api/v1/auth/reset-password', { token, password: 'NewStr0ng' }).expect(201);
    await get('/api/v1/auth/me', accessToken).expect(401);
    accessToken = await login(user.email, 'NewStr0ng');
  });

  it('DELETE /auth/me soft-deletes the account like the POST route', async () => {
    await registerVerified(other.email);
    const otherToken = await login(other.email);
    await del('/api/v1/auth/me', { password }, otherToken).expect(200);
    await get('/api/v1/auth/me', otherToken).expect(401);
    await post('/api/v1/auth/login', { email: other.email, password }).expect(401);
  });
});
