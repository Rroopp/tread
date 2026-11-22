import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../identity/api-key.guard';
import { CurrentInstitution, RequireInstitutionScopes } from '../identity/api-key.decorator';
import { InstitutionPrincipal } from '../identity/api-key.types';
import { InstitutionScopesGuard } from '../identity/institution-scopes.guard';
import { CreateQuoteDto } from './quotes.dto';
import { QuotesService } from './quotes.service';

@ApiTags('quotes')
@ApiBearerAuth()
@UseGuards(ApiKeyGuard, InstitutionScopesGuard)
@Controller('quotes')
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Post()
  @RequireInstitutionScopes('quotes:write')
  @ApiOperation({ summary: 'Request an executable or explicitly simulated conversion quote' })
  create(@CurrentInstitution() principal: InstitutionPrincipal, @Body() body: CreateQuoteDto) {
    return this.quotes.create(principal.institutionId, principal.environmentId, principal.environment, body);
  }

  @Get(':quoteId')
  @RequireInstitutionScopes('quotes:read')
  @ApiOperation({ summary: 'Get a quote belonging to the authenticated institution and environment' })
  find(@CurrentInstitution() principal: InstitutionPrincipal, @Param('quoteId', new ParseUUIDPipe()) quoteId: string) {
    return this.quotes.find(principal.institutionId, principal.environmentId, quoteId);
  }
}
