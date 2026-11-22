import { Module } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';
import { SandboxSimulationService } from './sandbox-simulation.service';
import { DashboardTransactionsController } from './dashboard-transactions.controller';
import { IdentityModule } from '../identity/identity.module';

@Module({
  imports: [IdentityModule],
  controllers: [TransactionsController, DashboardTransactionsController],
  providers: [TransactionsService, SandboxSimulationService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
