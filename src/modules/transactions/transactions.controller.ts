import {
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Body,
  BadRequestException,
  UseGuards,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentInstitution,
  RequireInstitutionScopes,
} from '../identity/api-key.decorator';
import { ApiKeyGuard } from '../identity/api-key.guard';
import { InstitutionScopesGuard } from '../identity/institution-scopes.guard';
import { InstitutionPrincipal } from '../identity/api-key.types';
import { CreateTransactionDto } from './create-transaction.dto';
import { TransactionsService } from './transactions.service';
import { SandboxSimulationService } from './sandbox-simulation.service';

@ApiTags('transactions')
@ApiBearerAuth()
@UseGuards(ApiKeyGuard, InstitutionScopesGuard)
@Controller('transactions')
export class TransactionsController {
  constructor(
    private readonly transactions: TransactionsService,
    private readonly sandboxSimulation: SandboxSimulationService,
  ) {}

  @Post()
  @RequireInstitutionScopes('transactions:write')
  @ApiOperation({ summary: 'Create a transaction request record' })
  @ApiCreatedResponse({ description: 'Transaction request stored with status CREATED' })
  create(
    @CurrentInstitution() principal: InstitutionPrincipal,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: CreateTransactionDto,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    return this.transactions.create({
      institutionId: principal.institutionId,
      environmentId: principal.environmentId,
      assetCode: body.assetCode,
      amountMinor: body.amountMinor ? BigInt(body.amountMinor) : undefined,
      quoteId: body.quoteId,
      clientReference: body.clientReference,
      idempotencyKey,
      actorCredentialId: principal.credentialId,
    });
  }

  @Get()
  @RequireInstitutionScopes('transactions:read')
  @ApiOperation({ summary: 'List recent transactions belonging to the authenticated institution' })
  list(
    @CurrentInstitution() principal: InstitutionPrincipal,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit === undefined ? 50 : Number(limit);
    if (limit !== undefined && (!/^\d+$/.test(limit) || !Number.isSafeInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100)) {
      throw new BadRequestException('limit must be an integer from 1 to 100');
    }
    return this.transactions.listForInstitution(
      principal.institutionId,
      principal.environmentId,
      parsedLimit,
    );
  }

  @Post(':transactionId/sandbox-simulate-funding')
  @RequireInstitutionScopes('transactions:sandbox_simulate')
  @ApiOperation({ summary: 'Simulate funding and a compliance outcome for a sandbox transaction; no funds move' })
  simulateFunding(
    @CurrentInstitution() principal: InstitutionPrincipal,
    @Param('transactionId', new ParseUUIDPipe()) transactionId: string,
  ) {
    return this.sandboxSimulation.fundAndScreen(principal.institutionId, principal.environmentId, transactionId);
  }

  @Get(':transactionId')
  @RequireInstitutionScopes('transactions:read')
  @ApiOperation({ summary: 'Get a transaction belonging to the authenticated institution' })
  async get(
    @CurrentInstitution() principal: InstitutionPrincipal,
    @Param('transactionId', new ParseUUIDPipe()) transactionId: string,
  ) {
    const transaction = await this.transactions.findForInstitution(
      principal.institutionId,
      principal.environmentId,
      transactionId,
    );
    if (!transaction) throw new NotFoundException('Transaction not found');
    return transaction;
  }
}
