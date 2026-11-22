import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface QuoteRate {
  numerator: bigint;
  denominator: bigint;
  providerCode: string;
}

export interface QuoteRateProvider {
  getSandboxRate(sourceAssetCode: string, destinationAssetCode: string): QuoteRate;
}

export const QUOTE_RATE_PROVIDER = Symbol('QUOTE_RATE_PROVIDER');

@Injectable()
export class SandboxQuoteRateProvider implements QuoteRateProvider {
  constructor(private readonly config: ConfigService) {}

  getSandboxRate(source: string, destination: string): QuoteRate {
    if (source === destination) return { numerator: 1n, denominator: 1n, providerCode: 'sandbox_identity_rate' };
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.config.get<string>('SANDBOX_RATES_JSON', '{}'));
    } catch {
      throw new ServiceUnavailableException('Sandbox quote rates are invalidly configured');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new ServiceUnavailableException('Sandbox quote rates must be a JSON object');
    }
    const rate = (parsed as Record<string, unknown>)[`${source}:${destination}`];
    if (typeof rate !== 'object' || rate === null || Array.isArray(rate)) {
      throw new ServiceUnavailableException(`No sandbox quote rate configured for ${source}/${destination}`);
    }
    const values = rate as Record<string, unknown>;
    if (typeof values.numerator !== 'string' || typeof values.denominator !== 'string' ||
        !/^\d{1,38}$/.test(values.numerator) || !/^\d{1,38}$/.test(values.denominator)) {
      throw new ServiceUnavailableException(`Sandbox quote rate for ${source}/${destination} is invalid`);
    }
    const numerator = BigInt(values.numerator);
    const denominator = BigInt(values.denominator);
    if (numerator <= 0n || denominator <= 0n) {
      throw new ServiceUnavailableException(`Sandbox quote rate for ${source}/${destination} must be positive`);
    }
    return { numerator, denominator, providerCode: 'sandbox_configured_rate' };
  }
}
