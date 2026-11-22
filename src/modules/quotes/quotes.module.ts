import { Module } from '@nestjs/common';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';
import { QUOTE_RATE_PROVIDER, SandboxQuoteRateProvider } from './quote-rate-provider';
import { IdentityModule } from '../identity/identity.module';
import { QuotesDashboardController } from './quotes-dashboard.controller';

@Module({
  controllers: [QuotesController, QuotesDashboardController],
  imports: [IdentityModule],
  providers: [
    QuotesService,
    SandboxQuoteRateProvider,
    { provide: QUOTE_RATE_PROVIDER, useExisting: SandboxQuoteRateProvider },
  ],
})
export class QuotesModule {}
