import { createHash } from 'node:crypto';
import { RefreshTokenService } from './refresh-token.service';

describe('RefreshTokenService', () => {
  const service = new RefreshTokenService();

  it('generates 256-bit opaque tokens (43-char base64url)', () => {
    const token = service.generate();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(service.generate()).not.toBe(token);
  });

  it('hashes tokens with SHA-256 deterministically', () => {
    const token = service.generate();
    expect(service.hash(token)).toBe(createHash('sha256').update(token).digest('hex'));
  });
});
