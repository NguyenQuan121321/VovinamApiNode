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

  seal(plain: Uint8Array): Uint8Array {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
    // Copy into a plain Uint8Array (ArrayBuffer-backed): newer @types/node narrow
    // Buffer to Uint8Array<ArrayBufferLike>, which Prisma's Bytes field rejects.
    return new Uint8Array(Buffer.concat([iv, encrypted, cipher.getAuthTag()]));
  }

  unseal(sealed: Uint8Array): Buffer {
    const iv = sealed.subarray(0, 12);
    const tag = sealed.subarray(sealed.length - 16);
    const ciphertext = sealed.subarray(12, sealed.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    // Pin the GCM auth tag to 16 bytes: variable-length tags weaken authentication.
    // Node's runtime accepts the explicit length; @types/node does not model it yet.
    (decipher as unknown as { setAuthTag(tag: Uint8Array, length: number): void }).setAuthTag(
      tag,
      16,
    );
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}
