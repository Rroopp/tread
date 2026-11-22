import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface EncryptedValue {
  keyId: string;
  ciphertext: string;
  iv: string;
  authTag: string;
}

@Injectable()
export class DataEncryptionService {
  private readonly keys: Map<string, Buffer>;
  private readonly currentKeyId: string;

  constructor(config: ConfigService) {
    const configuredKeyring = config.get<string>('DATA_ENCRYPTION_KEYS_JSON', '{}');
    const localOnly = configuredKeyring === '{}' && config.get<string>('NODE_ENV') !== 'production';
    this.currentKeyId = config.get<string>('DATA_ENCRYPTION_CURRENT_KEY_ID', '') || (localOnly ? 'local-non-production' : '');
    this.keys = new Map();
    let parsed: Record<string, unknown> = {};
    try {
      const raw = configuredKeyring;
      const value: unknown = JSON.parse(raw);
      if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('keyring must be an object');
      parsed = value as Record<string, unknown>;
    } catch {
      throw new ServiceUnavailableException('Sensitive data keyring configuration is invalid');
    }
    for (const [keyId, encoded] of Object.entries(parsed)) {
      if (!/^[a-zA-Z0-9_-]{1,40}$/.test(keyId) || typeof encoded !== 'string') {
        throw new ServiceUnavailableException('Sensitive data keyring entry is invalid');
      }
      const key = Buffer.from(encoded, 'base64');
      if (key.length !== 32) throw new ServiceUnavailableException(`Sensitive data key ${keyId} must be a base64 encoded 32-byte key`);
      this.keys.set(keyId, key);
    }
    if (localOnly) {
      this.keys.set('local-non-production', createHash('sha256').update('TREAD local and test data encryption only').digest());
    }
    if (!this.keys.has(this.currentKeyId)) {
      throw new ServiceUnavailableException('Sensitive data keyring must contain the configured current key id');
    }
  }

  encrypt(plaintext: string): EncryptedValue {
    const key = this.keys.get(this.currentKeyId);
    if (!key) throw new ServiceUnavailableException('The current sensitive data encryption key is not configured');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
      keyId: this.currentKeyId,
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    };
  }

  decrypt(value: EncryptedValue): string {
    const key = this.keys.get(value.keyId);
    if (!key) throw new ServiceUnavailableException(`Sensitive data key ${value.keyId} is unavailable`);
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(value.authTag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(value.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new ServiceUnavailableException('Sensitive data could not be decrypted');
    }
  }
}
