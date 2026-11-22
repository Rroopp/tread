import { ConflictException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';
import { POSTGRES_POOL } from '../../database/database.module';
import { PROVIDER_ADAPTERS, ProviderAdapter, ProviderCapability, ProviderEnvironment, providerCapability } from './provider-contracts';

type ProviderRow = { provider_code: string; capability: ProviderCapability; environment: ProviderEnvironment; status: string; adapter_key: string };

@Injectable()
export class ProviderRegistryService {
  private readonly adaptersByKey: Map<string, ProviderAdapter>;

  constructor(
    @Inject(POSTGRES_POOL) private readonly pool: Pool,
    @Inject(PROVIDER_ADAPTERS) adapters: ProviderAdapter[],
  ) {
    this.adaptersByKey = new Map(adapters.map((adapter) => [adapter.code, adapter]));
  }

  async resolve(capability: ProviderCapability, environment: ProviderEnvironment): Promise<ProviderAdapter> {
    const result = await this.pool.query<ProviderRow>(
      `SELECT provider_code, capability, environment, status, adapter_key FROM provider_integrations
       WHERE capability = $1 AND environment = $2 AND status IN ('SANDBOX_READY', 'LIVE_READY')
       ORDER BY (last_health_status = 'HEALTHY') DESC NULLS LAST, updated_at DESC LIMIT 1`,
      [capability, environment],
    );
    const provider = result.rows[0];
    if (!provider) throw new ServiceUnavailableException(`No ${environment.toLowerCase()} ${capability.toLowerCase()} provider is enabled`);
    if ((environment === 'PRODUCTION') !== (provider.status === 'LIVE_READY')) {
      throw new ConflictException('Provider integration readiness does not match the requested environment');
    }
    const adapter = this.adaptersByKey.get(provider.adapter_key);
    if (!adapter || adapter.code !== provider.provider_code || providerCapability(adapter) !== capability) {
      throw new ServiceUnavailableException('Configured provider adapter is not registered in this deployment');
    }
    return adapter;
  }

  async catalog() {
    const result = await this.pool.query(
      `SELECT id, provider_code, display_name, capability, environment, status, adapter_key,
              secret_reference, public_config, last_health_check_at, last_health_status, created_at, updated_at
       FROM provider_integrations ORDER BY capability, environment, display_name`,
    );
    return { integrations: result.rows };
  }
}
