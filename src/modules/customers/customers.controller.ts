import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../identity/api-key.decorator';
import { UserPrincipal } from '../identity/api-key.types';
import { InstitutionRolesGuard } from '../identity/institution-roles.guard';
import { RequireInstitutionRoles } from '../identity/institution-roles.decorator';
import { JwtAuthGuard } from '../identity/jwt-auth.guard';
import { CreateBeneficiaryDto, CreateCustomerDto } from './customers.dto';
import { CustomersService } from './customers.service';

@ApiTags('institution customers and beneficiaries')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, InstitutionRolesGuard)
@Controller('institutions/current')
@RequireInstitutionRoles('OWNER', 'ADMIN', 'OPERATOR', 'COMPLIANCE')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get('customers')
  @RequireInstitutionRoles('OWNER', 'ADMIN', 'COMPLIANCE')
  @ApiOperation({ summary: 'List institution customers in the active environment' })
  listCustomers(@CurrentUser() principal: UserPrincipal) { return this.customers.listCustomers(principal); }

  @Post('customers')
  @RequireInstitutionRoles('OWNER', 'ADMIN', 'OPERATOR')
  @ApiOperation({ summary: 'Create a customer record; new records remain pending KYC verification' })
  createCustomer(@CurrentUser() principal: UserPrincipal, @Body() body: CreateCustomerDto) {
    return this.customers.createCustomer(principal, body);
  }

  @Delete('customers/:customerId')
  @RequireInstitutionRoles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Disable an institution customer without deleting its audit history' })
  disableCustomer(@CurrentUser() principal: UserPrincipal, @Param('customerId', new ParseUUIDPipe()) id: string) {
    return this.customers.disableCustomer(principal, id);
  }

  @Get('beneficiaries')
  @ApiOperation({ summary: 'List masked institution beneficiary destinations in the active environment' })
  listBeneficiaries(@CurrentUser() principal: UserPrincipal) { return this.customers.listBeneficiaries(principal); }

  @Post('beneficiaries')
  @RequireInstitutionRoles('OWNER', 'ADMIN', 'OPERATOR')
  @ApiOperation({ summary: 'Create an encrypted beneficiary record; payouts are not initiated' })
  createBeneficiary(@CurrentUser() principal: UserPrincipal, @Body() body: CreateBeneficiaryDto) {
    return this.customers.createBeneficiary(principal, body);
  }

  @Delete('beneficiaries/:beneficiaryId')
  @RequireInstitutionRoles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Disable an institution beneficiary without deleting its audit history' })
  disableBeneficiary(@CurrentUser() principal: UserPrincipal, @Param('beneficiaryId', new ParseUUIDPipe()) id: string) {
    return this.customers.disableBeneficiary(principal, id);
  }
}
