import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { sha256Hex } from './token.service';

/** Opaque 256-bit refresh tokens (plan 4.1); only the SHA-256 hash is persisted. */
@Injectable()
export class RefreshTokenService {
  generate(): string {
    return randomBytes(32).toString('base64url');
  }

  hash(token: string): string {
    return sha256Hex(token);
  }
}
