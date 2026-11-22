import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const MAX_MEMORY = 64 * 1024 * 1024;

@Injectable()
export class PasswordHasherService {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derivedKey = await this.derive(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P);
    return [
      'scrypt',
      SCRYPT_N,
      SCRYPT_R,
      SCRYPT_P,
      salt.toString('hex'),
      derivedKey.toString('hex'),
    ].join('$');
  }

  async verify(password: string, encodedHash: string): Promise<boolean> {
    const parts = encodedHash.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const n = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = Buffer.from(parts[4], 'hex');
    const expected = Buffer.from(parts[5], 'hex');
    if (
      !Number.isSafeInteger(n) || n < 16_384 || n > 131_072 || (n & (n - 1)) !== 0 ||
      !Number.isSafeInteger(r) || r < 1 || r > 16 ||
      !Number.isSafeInteger(p) || p < 1 || p > 4 ||
      salt.length !== 16 || expected.length !== KEY_LENGTH
    ) return false;

    const actual = await this.derive(password, salt, n, r, p);
    return timingSafeEqual(actual, expected);
  }

  private derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      scrypt(password, salt, KEY_LENGTH, { N: n, r, p, maxmem: MAX_MEMORY }, (error, key) => {
        if (error) return reject(error);
        resolve(key);
      });
    });
  }
}
