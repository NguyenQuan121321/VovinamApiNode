import type { INestApplication } from '@nestjs/common';
import { authenticator } from 'otplib';
import request from 'supertest';

const TOTP_STEP_MS = 30_000;

/**
 * Enrolls TOTP for an already-authenticated user through the real API
 * (POST mfa/totp/enable → POST mfa/totp/verify). ADMIN MFA enforcement
 * (plan 4.1, TASK-05) rejects admin-admitting routes for ADMIN tokens until
 * this credential exists, so every e2e admin enrolls once in beforeAll.
 * The secret is delivered exactly once inside the otpauth URL; codes are
 * generated locally. A step boundary between generate and verify registers
 * one failure and answers 401 — retried once against the next step.
 */
export async function enrollTotp(app: INestApplication, token: string): Promise<void> {
  const enableRes = await request(app.getHttpServer())
    .post('/api/v1/auth/mfa/totp/enable')
    .set('Authorization', `Bearer ${token}`)
    .expect(201);
  const otpauthUrl = enableRes.body.data.otpauthUrl as string;
  const secret = /secret=([A-Z2-7]+)/.exec(otpauthUrl)?.[1];
  if (secret === undefined) {
    throw new Error(`otpauth URL did not carry a TOTP secret: ${otpauthUrl}`);
  }
  const verify = async (epoch: number): Promise<number> => {
    const verifier = authenticator.create({ ...authenticator.options, epoch });
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/totp/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: verifier.generate(secret) });
    return res.status;
  };
  const first = await verify(Date.now());
  if (first === 401) {
    const second = await verify(Date.now() + TOTP_STEP_MS);
    if (second !== 201) {
      throw new Error(`TOTP enrollment verify failed with status ${second}`);
    }
  }
}
