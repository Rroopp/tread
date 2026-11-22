import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../identity/api-key.decorator';
import { JwtAuthGuard } from '../identity/jwt-auth.guard';
import { UserPrincipal } from '../identity/api-key.types';
import { InstitutionsService } from './institutions.service';
import { TRANSACTION_STATUSES, TransactionStatus } from '../transactions/transactions.service';
import { InstitutionRolesGuard } from '../identity/institution-roles.guard';
import { RequireInstitutionRoles } from '../identity/institution-roles.decorator';

@ApiTags('institutions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('institutions')
export class InstitutionsController {
  constructor(private readonly institutions: InstitutionsService) {}

  @Get('current')
  @ApiOperation({ summary: 'Get the authenticated user’s institution and onboarding state' })
  current(@CurrentUser() principal: UserPrincipal) {
    return this.institutions.current(principal);
  }

  @Get('current/dashboard')
  @ApiOperation({ summary: 'Get authenticated institution dashboard data' })
  dashboard(@CurrentUser() principal: UserPrincipal) {
    return this.institutions.dashboard(principal);
  }

  @Get('current/dashboard/transactions')
  @ApiOperation({ summary: 'Search institution transactions in the active dashboard environment' })
  dashboardTransactions(
    @CurrentUser() principal: UserPrincipal,
    @Query('status') status?: string,
    @Query('q') query?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    if (status && !TRANSACTION_STATUSES.includes(status as TransactionStatus)) {
      throw new BadRequestException('status is not a supported transaction state');
    }
    if (query && query.length > 120) throw new BadRequestException('q must be 120 characters or fewer');
    const pageSize = limit === undefined ? 25 : Number(limit);
    const pageOffset = offset === undefined ? 0 : Number(offset);
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new BadRequestException('limit must be an integer from 1 to 100');
    if (!Number.isInteger(pageOffset) || pageOffset < 0 || pageOffset > 100_000) throw new BadRequestException('offset must be an integer from 0 to 100000');
    return this.institutions.dashboardTransactions(principal, {
      status: status as TransactionStatus | undefined, query, limit: pageSize, offset: pageOffset,
    });
  }

  @Get('current/dashboard/compliance')
  @ApiOperation({ summary: 'List latest compliance decisions for transactions in the active environment' })
  @UseGuards(InstitutionRolesGuard)
  @RequireInstitutionRoles('OWNER', 'ADMIN', 'COMPLIANCE')
  dashboardCompliance(@CurrentUser() principal: UserPrincipal, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    const pageSize = limit === undefined ? 25 : Number(limit);
    const pageOffset = offset === undefined ? 0 : Number(offset);
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new BadRequestException('limit must be an integer from 1 to 100');
    if (!Number.isInteger(pageOffset) || pageOffset < 0 || pageOffset > 100_000) throw new BadRequestException('offset must be an integer from 0 to 100000');
    return this.institutions.dashboardCompliance(principal, pageSize, pageOffset);
  }

  @Get('current/dashboard/usage')
  @ApiOperation({ summary: 'Get monthly environment activity counts and billing configuration status' })
  dashboardUsage(@CurrentUser() principal: UserPrincipal) {
    return this.institutions.dashboardUsage(principal);
  }

  @Get('current/dashboard/transactions/:transactionId')
  @ApiOperation({ summary: 'Get transaction details, history, compliance decisions, attempts, ledger and reconciliation evidence' })
  @UseGuards(InstitutionRolesGuard)
  @RequireInstitutionRoles('OWNER', 'ADMIN', 'OPERATOR', 'COMPLIANCE')
  dashboardTransaction(@CurrentUser() principal: UserPrincipal, @Param('transactionId', new ParseUUIDPipe()) id: string) {
    return this.institutions.dashboardTransaction(principal, id);
  }
}
