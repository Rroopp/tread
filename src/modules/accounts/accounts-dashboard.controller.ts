import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../identity/api-key.decorator';
import { UserPrincipal } from '../identity/api-key.types';
import { InstitutionRolesGuard } from '../identity/institution-roles.guard';
import { RequireInstitutionRoles } from '../identity/institution-roles.decorator';
import { JwtAuthGuard } from '../identity/jwt-auth.guard';
import { CreateAccountDto } from './accounts.dto';
import { AccountsService } from './accounts.service';

@ApiTags('institution dashboard accounts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, InstitutionRolesGuard)
@Controller('institutions/current/accounts')
export class AccountsDashboardController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  @ApiOperation({ summary: 'List accounts in the authenticated institution active environment' })
  list(@CurrentUser() principal: UserPrincipal) {
    return this.accounts.dashboardList(principal.institutionId);
  }

  @Get(':accountId')
  @ApiOperation({ summary: 'Get an account in the authenticated institution active environment' })
  find(@CurrentUser() principal: UserPrincipal, @Param('accountId', new ParseUUIDPipe()) id: string) {
    return this.accounts.dashboardFind(principal.institutionId, id);
  }

  @Post()
  @RequireInstitutionRoles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Create an institution-owned operational account' })
  create(@CurrentUser() principal: UserPrincipal, @Body() body: CreateAccountDto) {
    return this.accounts.dashboardCreate(principal, body);
  }
}
