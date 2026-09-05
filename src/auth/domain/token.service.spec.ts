import { ConfigService } from '@nestjs/config';
import jwt from 'jsonwebtoken';
import { EnvService } from '../../config/env.service';
import type { Env } from '../../config/env.validation';
import { TokenService } from './token.service';

const SECRET = 'a'.repeat(64);
const PREVIOUS = 'b'.repeat(64);

function makeService(withPrevious: boolean): TokenService {
  const values: Record<string, unknown> = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    JWT_SECRET: SECRET,
    JWT_ISSUER: 'vovinam-api',
    ACCESS_TOKEN_TTL: '15m',
  };
  if (withPrevious) {
    values.JWT_SECRET_PREVIOUS = PREVIOUS;
  }
  return new TokenService(new EnvService(new ConfigService(values) as ConfigService<Env, true>));
}

const user = { id: 'u-1', role: 'STUDENT' as const, pwdVersion: 3 };

describe('TokenService', () => {
  it('signs and verifies access tokens with the full claim set', () => {
    const service = makeService(false);
    const token = service.signAccessToken(user, 'sess-1');
    const claims = service.verify(token, 'access') as Record<string, unknown>;
    expect(claims.sub).toBe('u-1');
    expect(claims.role).toBe('STUDENT');
    expect(claims.type).toBe('access');
    expect(claims.sid).toBe('sess-1');
    expect(claims.pwdver).toBe(3);
    expect(typeof claims.jti).toBe('string');
  });

  it('rejects an mfa_pending token where an access token is required', () => {
    const service = makeService(false);
    const token = service.signMfaPendingToken('u-1');
    expect(() => service.verify(token, 'access')).toThrow(/unexpected token type/);
  });

  it('verifies tokens signed with the previous key during rotation', () => {
    const rotated = makeService(true);
    const legacy = makeService(false);
    const oldToken = legacy.signAccessToken(user, 'sess-1');
    expect(() => rotated.verify(oldToken, 'access')).not.toThrow();
  });

  it('rejects tokens signed under an unknown key id', () => {
    const service = makeService(false);
    const foreign = jwt.sign(
      { type: 'access', jti: 'j', sid: 's', pwdver: 1, role: 'STUDENT' },
      SECRET,
      {
        algorithm: 'HS256',
        keyid: 'rogue',
        subject: user.id,
        issuer: 'vovinam-api',
        expiresIn: 60,
      },
    );
    expect(() => service.verify(foreign, 'access')).toThrow();
  });

  it('rejects tokens signed with a wrong secret', () => {
    const service = makeService(false);
    const foreign = jwt.sign({ type: 'access' }, 'c'.repeat(64), {
      algorithm: 'HS256',
      keyid: 'current',
      subject: user.id,
      issuer: 'vovinam-api',
      expiresIn: 60,
    });
    expect(() => service.verify(foreign, 'access')).toThrow(/invalid signature/);
  });

  it('computes remaining lifetime', () => {
    const service = makeService(false);
    const token = service.signAccessToken(user, 'sess-1');
    const seconds = service.remainingLifetimeSeconds(token);
    expect(seconds).toBeGreaterThan(14 * 60);
    expect(seconds).toBeLessThanOrEqual(15 * 60);
  });
});
