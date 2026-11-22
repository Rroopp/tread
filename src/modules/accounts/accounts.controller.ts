import { BadRequestException, Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../identity/api-key.guard';
import { CurrentInstitution, RequireInstitutionScopes } from '../identity/api-key.decorator';
import { InstitutionPrincipal } from '../identity/api-key.types';
import { InstitutionScopesGuard } from '../identity/institution-scopes.guard';
import { CreateAccountDto, CreateAccountHoldDto } from './accounts.dto';
import { AccountsService } from './accounts.service';
import { LedgerService } from '../ledger/ledger.service';

@ApiTags('accounts')
@ApiBearerAuth()
@UseGuards(ApiKeyGuard, InstitutionScopesGuard)
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService, private readonly ledger: LedgerService) {}

  @Post()
  @RequireInstitutionScopes('accounts:write')
  @ApiOperation({ summary: 'Create an institution account in the authenticated environment' })
  create(@CurrentInstitution() principal: InstitutionPrincipal, @Body() body: CreateAccountDto) {
    return this.accounts.create(principal.institutionId, principal.environmentId, body);
  }

  @Get()
  @RequireInstitutionScopes('accounts:read')
  @ApiOperation({ summary: 'List accounts and their posted ledger totals' })
  list(@CurrentInstitution() principal: InstitutionPrincipal) {
    return this.accounts.list(principal.institutionId, principal.environmentId);
  }

  @Get(':accountId')
  @RequireInstitutionScopes('accounts:read')
  @ApiOperation({ summary: 'Get an account and its posted ledger totals' })
  find(@CurrentInstitution() principal: InstitutionPrincipal, @Param('accountId', new ParseUUIDPipe()) accountId: string) {
    return this.accounts.find(principal.institutionId, principal.environmentId, accountId);
  }

  @Post(':accountId/holds')
  @RequireInstitutionScopes('accounts:write')
  @ApiOperation({ summary: 'Place an idempotent hold against an account balance' })
  createHold(
    @CurrentInstitution() principal: InstitutionPrincipal,
    @Param('accountId', new ParseUUIDPipe()) accountId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: CreateAccountHoldDto,
  ) {
    if (!idempotencyKey) throw new BadRequestException('Idempotency-Key header is required');
    return this.ledger.createHold({
      institutionId: principal.institutionId,
      environmentId: principal.environmentId,
      accountId,
      idempotencyKey,
      amountMinor: BigInt(body.amountMinor),
      transactionId: body.transactionId,
    });
  }

  @Post(':accountId/holds/:holdId/release')
  @RequireInstitutionScopes('accounts:write')
  @ApiOperation({ summary: 'Release an active account hold' })
  async releaseHold(
    @CurrentInstitution() principal: InstitutionPrincipal,
    @Param('accountId', new ParseUUIDPipe()) accountId: string,
    @Param('holdId', new ParseUUIDPipe()) holdId: string,
  ) {
    await this.accounts.find(principal.institutionId, principal.environmentId, accountId);
    return this.ledger.releaseHold(principal.institutionId, principal.environmentId, accountId, holdId);
  }
}
