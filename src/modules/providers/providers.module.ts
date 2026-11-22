import { Module } from '@nestjs/common';
import { ProviderRegistryService } from './provider-registry.service';
import { PROVIDER_ADAPTERS } from './provider-contracts';
import { MockKesUsdcAdapter } from './mock-kes-usdc.adapter';
import { MOCK_KES_USDC_ADAPTER } from './provider-contracts';
import { ProviderExecutionService } from './provider-execution.service';

@Module({
  providers: [
    ProviderRegistryService,
    ProviderExecutionService,
    MockKesUsdcAdapter,
    { provide: MOCK_KES_USDC_ADAPTER, useExisting: MockKesUsdcAdapter },
    { provide: PROVIDER_ADAPTERS, useValue: [] },
  ],
  exports: [ProviderRegistryService, ProviderExecutionService],
})
export class ProvidersModule {}
