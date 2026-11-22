import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../identity/api-key.decorator';
import { UserPrincipal } from '../identity/api-key.types';
import { InstitutionRolesGuard } from '../identity/institution-roles.guard';
import { RequireInstitutionRoles } from '../identity/institution-roles.decorator';
import { JwtAuthGuard } from '../identity/jwt-auth.guard';
import { CreateQuoteDto } from './quotes.dto';
import { QuotesService } from './quotes.service';

@ApiTags('institution dashboard quotes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, InstitutionRolesGuard)
@RequireInstitutionRoles('OWNER', 'ADMIN', 'OPERATOR')
@Controller('institutions/current/dashboard/quotes')
export class QuotesDashboardController {
  constructor(private readonly quotes: QuotesService) {}

  @Get()
  @ApiOperation({ summary: 'List recent institution quotes in the active environment' })
  list(@CurrentUser() principal: UserPrincipal) { return this.quotes.listForDashboard(principal.institutionId); }

  @Post()
  @ApiOperation({ summary: 'Create a quote for the active environment; production requires a live provider' })
  create(@CurrentUser() principal: UserPrincipal, @Body() body: CreateQuoteDto) {
    return this.quotes.createForDashboard(principal, body);
  }
}
