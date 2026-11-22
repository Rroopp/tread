import { Injectable } from '@nestjs/common';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

@Injectable()
export class TotpService {
  generateSecret(): string {
    return encodeBase32(randomBytes(20));
  }

  verify(secret: string, code: string, now = Date.now()): number | null {
    if (!/^\d{6}$/.test(code)) return null;
    const currentStep = Math.floor(now / 30_000);
    for (const step of [currentStep - 1, currentStep, currentStep + 1]) {
      const expected = this.codeAt(secret, step);
      const actualBytes = Buffer.from(code);
      const expectedBytes = Buffer.from(expected);
      if (timingSafeEqual(actualBytes, expectedBytes)) return step;
    }
    return null;
  }

  recoveryCodes(count = 10): string[] {
    return Array.from({ length: count }, () => {
      const raw = randomBytes(12).toString('hex').toUpperCase();
      return `${raw.slice(0, 8)}-${raw.slice(8, 16)}-${raw.slice(16)}`;
    });
  }

  hashRecoveryCode(code: string): string {
    return createHash('sha256').update(code.replaceAll('-', '').trim().toUpperCase()).digest('hex');
  }

  private codeAt(secret: string, step: number): string {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step));
    const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
    const offset = digest[digest.length - 1] & 0x0f;
    const binary = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
    return binary.toString().padStart(6, '0');
  }
}

function encodeBase32(input: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function decodeBase32(input: string): Buffer {
  const normalized = input.toUpperCase().replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const character of normalized) {
    const index = BASE32.indexOf(character);
    if (index < 0) throw new Error('Invalid TOTP secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}
