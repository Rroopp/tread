import { BadRequestException, Body, Controller, Headers, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../identity/api-key.decorator';
import { UserPrincipal } from '../identity/api-key.types';
import { InstitutionRolesGuard } from '../identity/institution-roles.guard';
import { RequireInstitutionRoles } from '../identity/institution-roles.decorator';
import { JwtAuthGuard } from '../identity/jwt-auth.guard';
import { CreateDashboardTransactionDto } from './dashboard-transaction.dto';
import { TransactionsService } from './transactions.service';

@ApiTags('institution dashboard transactions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, InstitutionRolesGuard)
@RequireInstitutionRoles('OWNER', 'ADMIN', 'OPERATOR')
@Controller('institutions/current/dashboard/transactions')
export class DashboardTransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Post()
  @ApiOperation({ summary: 'Create an idempotent transaction request from a single-use quote; does not execute settlement' })
  create(@CurrentUser() principal: UserPrincipal, @Headers('idempotency-key') key: string | undefined, @Body() body: CreateDashboardTransactionDto) {
    if (!key) throw new BadRequestException('Idempotency-Key header is required');
    return this.transactions.createForDashboard(principal, body.quoteId, key, body.clientReference);
  }
}
