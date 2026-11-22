import { BadRequestException, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../identity/api-key.guard';
import { CurrentInstitution, RequireInstitutionScopes } from '../identity/api-key.decorator';
import { InstitutionPrincipal } from '../identity/api-key.types';
import { InstitutionScopesGuard } from '../identity/institution-scopes.guard';
import { CreateWebhookEndpointDto } from './webhooks.dto';
import { WebhooksService } from './webhooks.service';
import { Body } from '@nestjs/common';

@ApiTags('webhooks')
@ApiBearerAuth()
@UseGuards(ApiKeyGuard, InstitutionScopesGuard)
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post('endpoints')
  @RequireInstitutionScopes('webhooks:write')
  @ApiOperation({ summary: 'Register a signed webhook endpoint; signing secret is returned once' })
  create(@CurrentInstitution() principal: InstitutionPrincipal, @Body() body: CreateWebhookEndpointDto) {
    return this.webhooks.create(principal.institutionId, principal.environmentId, body);
  }

  @Get('endpoints')
  @RequireInstitutionScopes('webhooks:read')
  list(@CurrentInstitution() principal: InstitutionPrincipal) {
    return this.webhooks.list(principal.institutionId, principal.environmentId);
  }

  @Delete('endpoints/:endpointId')
  @RequireInstitutionScopes('webhooks:write')
  disable(@CurrentInstitution() principal: InstitutionPrincipal, @Param('endpointId', new ParseUUIDPipe()) endpointId: string) {
    return this.webhooks.disable(principal.institutionId, principal.environmentId, endpointId);
  }

  @Get('deliveries')
  @RequireInstitutionScopes('webhooks:read')
  listDeliveries(@CurrentInstitution() principal: InstitutionPrincipal, @Query('limit') limit?: string) {
    const parsed = limit === undefined ? 50 : Number(limit);
    if (limit !== undefined && (!/^\d+$/.test(limit) || !Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100)) {
      throw new BadRequestException('limit must be an integer from 1 to 100');
    }
    return this.webhooks.listDeliveries(principal.institutionId, principal.environmentId, parsed);
  }
}
