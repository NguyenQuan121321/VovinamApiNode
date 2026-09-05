import { createDecipheriv, createCipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { EnvService } from '../../config/env.service';

/**
 * AES-256-GCM sealing for TOTP secrets at rest (plan 4.1). Output layout:
 * [12-byte IV][ciphertext][16-byte auth tag] as a single buffer.
 */
@Injectable()
export class SealService {
  private readonly key: Buffer;

  constructor(env: EnvService) {
    const hex = env.appEncryptionKey;
    if (hex === undefined || hex.length !== 64) {
      throw new Error('APP_ENCRYPTION_KEY must be 64 hex chars when TOTP sealing is used');
    }
    this.key = Buffer.from(hex, 'hex');
  }

  seal(plain: Uint8Array): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([iv, encrypted, cipher.getAuthTag()]);
  }

  unseal(sealed: Uint8Array): Buffer {
    const iv = sealed.subarray(0, 12);
    const tag = sealed.subarray(sealed.length - 16);
    const ciphertext = sealed.subarray(12, sealed.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}
