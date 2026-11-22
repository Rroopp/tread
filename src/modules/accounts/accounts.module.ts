import { Module } from '@nestjs/common';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { LedgerModule } from '../ledger/ledger.module';
import { IdentityModule } from '../identity/identity.module';
import { AccountsDashboardController } from './accounts-dashboard.controller';

@Module({ imports: [LedgerModule, IdentityModule], controllers: [AccountsController, AccountsDashboardController], providers: [AccountsService] })
export class AccountsModule {}
