import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';
import { POSTGRES_POOL } from '../../database/database.module';
import { CreateQuoteDto } from './quotes.dto';
import { QUOTE_RATE_PROVIDER, QuoteRateProvider } from './quote-rate-provider';
import { UserPrincipal } from '../identity/api-key.types';

const MAX_MINOR_UNITS = 10n ** 38n - 1n;

@Injectable()
export class QuotesService {
  constructor(
    @Inject(POSTGRES_POOL) private readonly pool: Pool,
    @Inject(QUOTE_RATE_PROVIDER) private readonly rateProvider: QuoteRateProvider,
  ) {}

  async createForDashboard(principal: UserPrincipal, input: CreateQuoteDto) {
    const environment = await this.pool.query<{ id: string; environment: 'SANDBOX' | 'PRODUCTION' }>(
      `SELECT id, environment FROM institution_environments WHERE institution_id = $1 AND status = 'ACTIVE'
       ORDER BY CASE environment WHEN 'SANDBOX' THEN 0 ELSE 1 END LIMIT 1`, [principal.institutionId],
    );
    const active = environment.rows[0];
    if (!active) throw new ConflictException('No active institution environment is available');
    return this.create(principal.institutionId, active.id, active.environment, input);
  }

  async listForDashboard(institutionId: string) {
    const environment = await this.pool.query<{ id: string; environment: 'SANDBOX' | 'PRODUCTION' }>(
      `SELECT id, environment FROM institution_environments WHERE institution_id = $1 AND status = 'ACTIVE'
       ORDER BY CASE environment WHEN 'SANDBOX' THEN 0 ELSE 1 END LIMIT 1`, [institutionId],
    );
    const active = environment.rows[0];
    if (!active) return { environment: null, quotes: [] };
    const result = await this.pool.query(
      `SELECT id, source_asset_code, destination_asset_code, source_amount_minor::text,
        destination_amount_minor::text, rate_numerator::text, rate_denominator::text,
        fee_amount_minor::text, provider_code, quote_mode,
        CASE WHEN status = 'ACTIVE' AND expires_at <= now() THEN 'EXPIRED' ELSE status END AS status,
        expires_at, created_at
       FROM quotes WHERE institution_id = $1 AND environment_id = $2
       ORDER BY created_at DESC LIMIT 100`, [institutionId, active.id],
    );
    return { environment: active.environment, quotes: result.rows };
  }

  async create(institutionId: string, environmentId: string, environment: 'SANDBOX' | 'PRODUCTION', input: CreateQuoteDto) {
    const sourceAmount = BigInt(input.sourceAmountMinor);
    if (sourceAmount <= 0n || sourceAmount > MAX_MINOR_UNITS) {
      throw new BadRequestException('Source amount is outside the supported range');
    }
    if (environment !== 'SANDBOX') {
      throw new ServiceUnavailableException('Live quote providers are not configured for this environment');
    }

    const { numerator, denominator, providerCode } = this.rateProvider.getSandboxRate(input.sourceAssetCode, input.destinationAssetCode);
    const destinationAmount = sourceAmount * numerator / denominator;
    if (destinationAmount <= 0n || destinationAmount > MAX_MINOR_UNITS) {
      throw new BadRequestException('Quote result is outside the supported range');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ id: string; expires_at: Date }>(
        `INSERT INTO quotes
          (institution_id, environment_id, source_asset_code, destination_asset_code,
           source_amount_minor, destination_amount_minor, rate_numerator, rate_denominator,
           provider_code, quote_mode, expires_at)
         SELECT i.id, e.id, source_asset.code, destination_asset.code, $4, $5, $6, $7,
           $8, 'SANDBOX_SIMULATED', now() + interval '60 seconds'
         FROM institutions i
         JOIN institution_environments e ON e.id = $2 AND e.institution_id = i.id
         JOIN assets source_asset ON source_asset.code = $3 AND source_asset.enabled = true
         JOIN assets destination_asset ON destination_asset.code = $9 AND destination_asset.enabled = true
         WHERE i.id = $1 AND i.status = 'ACTIVE' AND e.status = 'ACTIVE'
         RETURNING id, expires_at`,
        [institutionId, environmentId, input.sourceAssetCode, sourceAmount.toString(), destinationAmount.toString(),
          numerator.toString(), denominator.toString(), providerCode, input.destinationAssetCode],
      );
      const quote = result.rows[0];
      if (!quote) throw new ConflictException('Institution, environment, or requested assets are not enabled');
      const details = {
        quoteId: quote.id,
        sourceAssetCode: input.sourceAssetCode,
        destinationAssetCode: input.destinationAssetCode,
        sourceAmountMinor: sourceAmount.toString(),
        destinationAmountMinor: destinationAmount.toString(),
        rateNumerator: numerator.toString(),
        rateDenominator: denominator.toString(),
        feeAmountMinor: '0',
        providerCode,
        quoteMode: 'SANDBOX_SIMULATED',
        status: 'ACTIVE',
        expiresAt: quote.expires_at,
      };
      await client.query(
        `INSERT INTO audit_logs (institution_id, action, resource_type, resource_id, metadata)
         VALUES ($1, 'quote.created', 'quote', $2, $3::jsonb)`,
        [institutionId, quote.id, JSON.stringify({ sourceAssetCode: input.sourceAssetCode, destinationAssetCode: input.destinationAssetCode, quoteMode: 'SANDBOX_SIMULATED' })],
      );
      await client.query(
        `INSERT INTO outbox_events (institution_id, environment_id, aggregate_type, aggregate_id, event_type, payload)
         VALUES ($1, $2, 'quote', $3, 'quote.created', $4::jsonb)`,
        [institutionId, environmentId, quote.id, JSON.stringify(details)],
      );
      await client.query('COMMIT');
      return details;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve the original error. */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async find(institutionId: string, environmentId: string, quoteId: string) {
    const result = await this.pool.query<{
      id: string; source_asset_code: string; destination_asset_code: string;
      source_amount_minor: string; destination_amount_minor: string;
      rate_numerator: string; rate_denominator: string; fee_amount_minor: string;
      provider_code: string; quote_mode: 'SANDBOX_SIMULATED' | 'LIVE'; status: string;
      expires_at: Date; created_at: Date;
    }>(
      `SELECT id, source_asset_code, destination_asset_code,
        source_amount_minor::text, destination_amount_minor::text,
        rate_numerator::text, rate_denominator::text, fee_amount_minor::text,
        provider_code, quote_mode,
        CASE WHEN status = 'ACTIVE' AND expires_at <= now() THEN 'EXPIRED' ELSE status END AS status,
        expires_at, created_at
       FROM quotes WHERE id = $1 AND institution_id = $2 AND environment_id = $3`,
      [quoteId, institutionId, environmentId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException('Quote not found');
    return {
      quoteId: row.id,
      sourceAssetCode: row.source_asset_code,
      destinationAssetCode: row.destination_asset_code,
      sourceAmountMinor: row.source_amount_minor,
      destinationAmountMinor: row.destination_amount_minor,
      rateNumerator: row.rate_numerator,
      rateDenominator: row.rate_denominator,
      feeAmountMinor: row.fee_amount_minor,
      providerCode: row.provider_code,
      quoteMode: row.quote_mode,
      status: row.status,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    };
  }

}
