import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentInstitution, RequireInstitutionScopes } from '../identity/api-key.decorator';
import { InstitutionPrincipal } from '../identity/api-key.types';
import { ApiKeyGuard } from '../identity/api-key.guard';
import { InstitutionScopesGuard } from '../identity/institution-scopes.guard';
import { CreateBeneficiaryDto, CreateCustomerDto } from './customers.dto';
import { CustomersService } from './customers.service';

@ApiTags('customers and beneficiaries')
@ApiBearerAuth()
@UseGuards(ApiKeyGuard, InstitutionScopesGuard)
@Controller()
export class CustomersApiController {
  constructor(private readonly customers: CustomersService) {}

  @Get('customers')
  @RequireInstitutionScopes('customers:read')
  @ApiOperation({ summary: 'List customers for the authenticated institution API key environment' })
  listCustomers(@CurrentInstitution() principal: InstitutionPrincipal) { return this.customers.listCustomers(principal); }

  @Post('customers')
  @RequireInstitutionScopes('customers:write')
  @ApiOperation({ summary: 'Create an encrypted customer record; KYC status remains pending' })
  createCustomer(@CurrentInstitution() principal: InstitutionPrincipal, @Body() body: CreateCustomerDto) {
    return this.customers.createCustomer(principal, body);
  }

  @Delete('customers/:customerId')
  @RequireInstitutionScopes('customers:write')
  @ApiOperation({ summary: 'Disable a customer record without deleting its history' })
  disableCustomer(@CurrentInstitution() principal: InstitutionPrincipal, @Param('customerId', new ParseUUIDPipe()) id: string) {
    return this.customers.disableCustomer(principal, id);
  }

  @Get('beneficiaries')
  @RequireInstitutionScopes('beneficiaries:read')
  @ApiOperation({ summary: 'List masked beneficiaries for the authenticated API key environment' })
  listBeneficiaries(@CurrentInstitution() principal: InstitutionPrincipal) { return this.customers.listBeneficiaries(principal); }

  @Post('beneficiaries')
  @RequireInstitutionScopes('beneficiaries:write')
  @ApiOperation({ summary: 'Create an encrypted beneficiary record; no payout is initiated' })
  createBeneficiary(@CurrentInstitution() principal: InstitutionPrincipal, @Body() body: CreateBeneficiaryDto) {
    return this.customers.createBeneficiary(principal, body);
  }

  @Delete('beneficiaries/:beneficiaryId')
  @RequireInstitutionScopes('beneficiaries:write')
  @ApiOperation({ summary: 'Disable a beneficiary record without deleting its history' })
  disableBeneficiary(@CurrentInstitution() principal: InstitutionPrincipal, @Param('beneficiaryId', new ParseUUIDPipe()) id: string) {
    return this.customers.disableBeneficiary(principal, id);
  }
}
